import { ResearcherIdentifier, VerificationTask, Faculty } from '../models/index.js';
import { normOrcid } from '../utils/normalize.js';

// ISO 7064 mod 11-2 checksum used by ORCID
export function orcidChecksumOk(orcid) {
  const id = normOrcid(orcid);
  if (!id) return false;
  const digits = id.replace(/-/g, '');
  let total = 0;
  for (const ch of digits.slice(0, 15)) total = (total + Number(ch)) * 2;
  const check = (12 - (total % 11)) % 11;
  return digits[15] === (check === 10 ? 'X' : String(check));
}

export const formatCheck = {
  scopus: (v) => /^\d{10,11}$/.test(v),
  orcid: (v) => orcidChecksumOk(v),
  scholar: (v) => /^[A-Za-z0-9_-]{12}$/.test(v),
};

/**
 * Re-evaluate every identifier: format problems and cross-faculty duplicates are
 * marked 'conflict' and an admin verification task is opened. Verified or rejected
 * identifiers are never overwritten (an admin decision wins).
 */
export async function validateIdentifiers() {
  const report = { invalidFormat: [], conflicts: [] };
  const all = await ResearcherIdentifier.find({ type: { $in: ['scopus', 'orcid', 'scholar'] } }).populate('faculty', 'name');

  for (const id of all) {
    if (id.status === 'verified' || id.status === 'rejected') continue;
    if (!formatCheck[id.type](id.value)) {
      id.status = 'conflict';
      id.note = `Invalid ${id.type} format${id.type === 'orcid' ? ' or checksum' : ''}`;
      await id.save();
      report.invalidFormat.push({ faculty: id.faculty.name, type: id.type, value: id.value });
    }
  }

  const groups = new Map();
  for (const id of all) {
    const k = `${id.type}:${id.value}`;
    groups.set(k, [...(groups.get(k) || []), id]);
  }
  for (const [key, members] of groups) {
    const facultyIds = [...new Set(members.map((m) => String(m.faculty._id)))];
    if (facultyIds.length < 2) continue;
    for (const m of members) {
      if (m.status === 'verified') continue;
      m.status = 'conflict';
      m.conflictWith = facultyIds.filter((f) => f !== String(m.faculty._id));
      m.note = `Same ${m.type} supplied for ${facultyIds.length} different faculty; administrator must verify the correct owner`;
      await m.save();
    }
    const names = members.map((m) => m.faculty.name);
    await VerificationTask.updateOne(
      { dedupeKey: `idconflict:${key}` },
      { $setOnInsert: { type: 'identifier_conflict', faculty: facultyIds, payload: { identifierType: members[0].type, value: members[0].value, faculty: names }, dedupeKey: `idconflict:${key}` } },
      { upsert: true }
    );
    report.conflicts.push({ type: members[0].type, value: members[0].value, faculty: names });
  }
  return report;
}

/** Identifier safe to use for automated retrieval (not conflicting / rejected). */
export async function usableIdentifier(facultyId, type) {
  const id = await ResearcherIdentifier.findOne({ faculty: facultyId, type, status: { $in: ['unverified', 'verified'] } });
  return id?.value || null;
}

export async function importFacultyRecords(records) {
  const out = [];
  for (const r of records) {
    const email = r.email?.toLowerCase().trim();
    const f = await Faculty.findOneAndUpdate(
      { email },
      { $set: { name: r.name, designation: r.designation, ...(r.scholar ? { scholarProfileUrl: `https://scholar.google.com/citations?user=${r.scholar}` } : {}) } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    const ids = [['scopus', r.scopus], ['orcid', normOrcid(r.orcid) || r.orcid], ['scholar', r.scholar], ['email', email]];
    for (const [type, value] of ids) {
      if (!value) continue;
      await ResearcherIdentifier.updateOne({ faculty: f._id, type, value: String(value).trim() }, { $setOnInsert: { status: type === 'email' ? 'verified' : 'unverified' } }, { upsert: true });
    }
    out.push(f);
  }
  return out;
}
