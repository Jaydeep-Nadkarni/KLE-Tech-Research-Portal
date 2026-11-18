// Co-author index. Source of truth per author entry: OpenAlex authorships (author id, ORCID, institutions, countries);
// papers without an OpenAlex record fall back to name-only entries. Nothing here claims someone is a student: that
// can only come from a manual tag. Classes derived from data describe the AFFILIATION on that paper.
import { Faculty, FacultyPublication, Publication, ProviderRecord, ResearcherIdentifier, PersonTag } from '../models/index.js';
import { normTitle, normOrcid } from '../utils/normalize.js';
import { ieeeAuthor } from './ieee.js';

export const CLASS_LABEL = {
  department: 'Department faculty', kle_tech: 'KLE Tech (not in department list)', kle_other: 'Other KLE institution', external: 'External institution',
  unknown: 'Affiliation unknown', student: 'Student', research_scholar: 'Research scholar', faculty_other_dept: 'Faculty, other department',
};
export const TAG_CATEGORIES = ['student', 'research_scholar', 'faculty_other_dept', 'external'];

const KLE_TECH = (i) => i?.id === 'https://openalex.org/I3132975163' || /^KLE Tech/i.test(i?.display_name || '');
const KLE_ANY = (i) => /\bKLE\b|K\.?\s?L\.?\s?E\.?\s/i.test(i?.display_name || '') || KLE_TECH(i);

const nameTokens = (n) => normTitle(n).split(' ').filter(Boolean);
// "Surname Initials", "Given Surname" and "G. Surname" all reduce to the same key: surname + first initial
const surInitial = (n) => { const t = nameTokens(ieeeAuthor(n) || n); return t.length ? { sur: t.at(-1), ini: t[0]?.[0] || '' } : null; };
export const nameKey = (n) => { const s = surInitial(n); return s ? `name:${s.sur} ${s.ini}` : null; };

function matchesFaculty(authorName, f) {
  const t = nameTokens(authorName), ft = nameTokens(f.name);
  if (!t.length) return false;
  const sur = ft.at(-1), ini = ft[0]?.[0];
  return t.includes(sur) && t.some((x) => x !== sur && x[0] === ini);
}

export async function buildCoauthors({ facultyId } = {}) {
  const faculty = await Faculty.find({ active: true }).lean();
  const fById = new Map(faculty.map((f) => [String(f._id), f]));
  const orcidToFaculty = new Map((await ResearcherIdentifier.find({ type: 'orcid', status: { $in: ['unverified', 'verified'] } }).lean()).map((i) => [i.value, String(i.faculty)]));
  const oaToFaculty = new Map(faculty.filter((f) => f.profiles?.openalex?.openalexId).map((f) => [f.profiles.openalex.openalexId, String(f._id)]));

  const links = await FacultyPublication.find({ verificationStatus: { $ne: 'rejected' } }).lean();
  const owners = new Map(); // pubId -> [facultyId]
  for (const l of links) owners.set(String(l.publication), [...(owners.get(String(l.publication)) || []), String(l.faculty)]);
  const scoped = facultyId ? [...owners].filter(([, fs]) => fs.includes(String(facultyId))).map(([p]) => p) : [...owners.keys()];

  const pubs = await Publication.find({ _id: { $in: scoped } }).select('title year authors').lean();
  const oaAuthorships = new Map();
  for (const r of await ProviderRecord.find({ provider: 'openalex', publication: { $in: scoped } }).select('publication raw.authorships').lean()) {
    if (!oaAuthorships.has(String(r.publication))) oaAuthorships.set(String(r.publication), r.raw?.authorships || []);
  }

  const people = new Map();
  let multiDept = 0, papersWithCoauthors = 0;
  for (const p of pubs) {
    const pid = String(p._id), own = owners.get(pid) || [];
    if (new Set(own).size > 1) multiDept++;
    const entries = oaAuthorships.has(pid)
      ? oaAuthorships.get(pid).map((a) => ({ name: a.author?.display_name, oa: a.author?.id?.replace('https://openalex.org/', ''), orcid: normOrcid(a.author?.orcid), insts: a.institutions || [], countries: a.countries || (a.institutions || []).map((i) => i.country_code).filter(Boolean) }))
      : (p.authors || []).map((a) => ({ name: a.name, oa: null, orcid: normOrcid(a.orcid), insts: [], countries: [] }));
    let any = false;
    for (const e of entries) {
      if (!e.name) continue;
      const hasKle = e.insts.some(KLE_ANY);
      let deptId = (e.oa && oaToFaculty.get(e.oa)) || (e.orcid && orcidToFaculty.get(e.orcid)) || null;
      // A name matching a faculty member who OWNS this paper is that person (papers are fetched by their own IDs), even when
      // OpenAlex shows an older institution. A match to a non-owner needs a KLE affiliation (or none) to count.
      if (!deptId) deptId = own.find((id) => matchesFaculty(e.name, fById.get(id))) || null;
      if (!deptId && (hasKle || !e.insts.length)) deptId = faculty.find((f) => matchesFaculty(e.name, f))?._id?.toString() || null;
      if (deptId && (!facultyId || deptId === String(facultyId))) continue; // the owner themself
      const key = deptId ? `dept:${deptId}` : e.oa ? `oa:${e.oa}` : nameKey(e.name);
      if (!key) continue;
      any = true;
      if (!people.has(key)) people.set(key, { key, name: deptId ? fById.get(deptId).name : e.name, orcid: e.orcid, openalexId: e.oa, deptFacultyId: deptId, institutions: new Map(), countries: new Set(), papers: new Set(), years: new Set(), faculty: new Map(), nameOnly: !e.oa && !deptId });
      const x = people.get(key);
      x.orcid ||= e.orcid;
      for (const i of e.insts) x.institutions.set(i.display_name, { name: i.display_name, kle: KLE_ANY(i), kleTech: KLE_TECH(i) });
      e.countries.forEach((c) => x.countries.add(c));
      x.papers.add(pid); if (p.year) x.years.add(p.year);
      for (const f of own) x.faculty.set(f, (x.faculty.get(f) || 0) + 1);
    }
    if (any) papersWithCoauthors++;
  }

  // Fold a name-only entry (paper without an OpenAlex record) into an OpenAlex person when exactly ONE person shares its
  // surname + first initial. Two or more candidates means we cannot tell, so it stays separate rather than guessing.
  const byInitial = new Map();
  for (const x of people.values()) if (!x.nameOnly && !x.deptFacultyId) { const k = nameKey(x.name); byInitial.set(k, [...(byInitial.get(k) || []), x]); }
  for (const [key, x] of [...people]) {
    if (!x.nameOnly) continue;
    const cands = byInitial.get(nameKey(x.name)) || [];
    if (cands.length !== 1) continue;
    const t = cands[0];
    x.papers.forEach((p) => t.papers.add(p)); x.years.forEach((y) => t.years.add(y));
    for (const [f, n] of x.faculty) t.faculty.set(f, Math.max(t.faculty.get(f) || 0, n));
    people.delete(key);
  }

  const tags = new Map((await PersonTag.find().lean()).map((t) => [t.key, t]));
  const items = [...people.values()].map((x) => {
    const insts = [...x.institutions.values()];
    const tag = tags.get(x.key) || (x.nameOnly ? null : null);
    let cls, source;
    if (x.deptFacultyId) { cls = 'department'; source = 'department list'; }
    else if (tag) { cls = tag.category; source = 'manual tag'; }
    else if (insts.some((i) => i.kleTech)) { cls = 'kle_tech'; source = 'institution on paper'; }
    else if (insts.some((i) => i.kle)) { cls = 'kle_other'; source = 'institution on paper'; }
    else if (insts.length) { cls = 'external'; source = 'institution on paper'; }
    else { cls = 'unknown'; source = 'no affiliation data'; }
    return {
      key: x.key, name: x.name, orcid: x.orcid, openalexId: x.openalexId, class: cls, classLabel: CLASS_LABEL[cls], classSource: source, tag: tag ? { category: tag.category, note: tag.note, setBy: tag.setBy } : null,
      institutions: insts.map((i) => i.name), countries: [...x.countries], papers: x.papers.size, years: [...x.years].sort(),
      faculty: [...x.faculty].map(([id, n]) => ({ id, name: fById.get(id)?.name, papers: n })).sort((a, b) => b.papers - a.papers),
    };
  }).sort((a, b) => b.papers - a.papers || a.name.localeCompare(b.name));

  const summary = Object.fromEntries(Object.keys(CLASS_LABEL).map((c) => [c, items.filter((i) => i.class === c).length]));
  return { items, summary, totals: { people: items.length, papersAnalysed: pubs.length, papersWithCoauthors, papersWithSeveralDepartmentFaculty: multiDept, papersWithAffiliationData: [...oaAuthorships.keys()].length } };
}
