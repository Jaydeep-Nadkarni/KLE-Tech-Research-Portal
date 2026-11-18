import { Publication, ProviderRecord, FacultyPublication, CitationSnapshot, VerificationTask } from '../models/index.js';
import { normTitle, uniq } from '../utils/normalize.js';

const tokens = (t) => new Set(normTitle(t).split(' ').filter((w) => w.length > 2));
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};

// Evidence labels per provider: what each source is *allowed* to assert about a paper.
const INDEX_RULES = {
  scopus: (w) => ({ path: 'scopus', status: 'indexed', evidence: `Scopus record ${w.eid || w.externalId}` }),
  orcid: () => ({ path: 'orcid', status: 'linked', evidence: 'Listed on researcher ORCID record (identity registry, not an index)' }),
  openalex: (w) => ({ path: 'openalex', status: 'listed', evidence: `OpenAlex ${w.externalId}` }),
  semanticscholar: (w) => ({ path: 'semanticScholar', status: 'listed', evidence: `Semantic Scholar ${w.externalId}` }),
  webofscience: (w) => ({ path: 'webOfScience', status: 'indexed', evidence: w.via === 'manual' ? `Web of Science record ${w.externalId || ''} (from an administrator-imported WoS export)` : `Web of Science record ${w.externalId} (Clarivate API)` }),
  googlescholar: (w) => ({ path: 'googleScholar', status: 'listed', evidence: w.via === 'manual' ? 'Listed on Google Scholar profile (manually imported by an administrator)' : 'Listed on Google Scholar profile (retrieved via SerpApi)' }),
  crossref: (w) => ({ path: 'crossref', status: 'doi_registered', evidence: `Crossref DOI ${w.doi}` }),
};

/** DOI -> EID -> normalized title (+/-1 year). Fuzzy matches are never merged, only queued for review. */
async function findExisting(work, stats) {
  if (work.doi) {
    const p = await Publication.findOne({ doi: work.doi });
    if (p) return { pub: p, by: 'doi' };
  }
  if (work.eid) {
    const p = await Publication.findOne({ eid: work.eid });
    if (p) return { pub: p, by: 'eid' };
  }
  const key = normTitle(work.title);
  if (!key) return { pub: null };
  const yearOk = (y) => !work.year || !y || Math.abs(y - work.year) <= 1;
  const same = (await Publication.find({ titleKey: key })).filter((p) => yearOk(p.year));
  for (const p of same) {
    if (work.doi && p.doi && work.doi !== p.doi) continue; // different DOIs: distinct records (e.g. preprint vs final)
    return { pub: p, by: 'title' };
  }
  // Fuzzy: candidate only
  if (work.year) {
    const cands = await Publication.find({ year: { $gte: work.year - 1, $lte: work.year + 1 } }).select('title doi');
    const mine = tokens(work.title);
    const near = cands.filter((c) => jaccard(mine, tokens(c.title)) >= 0.85);
    if (near.length) stats.fuzzy = [...(stats.fuzzy || []), { work, candidates: near }];
  }
  return { pub: null };
}

/** Existing publication that a work corresponds to (DOI, EID, then identical title +/-1 year), or null. */
export async function matchExisting(work) {
  const { pub } = await findExisting(work, {});
  return pub;
}

const setIfEmpty = (pub, f, v) => {
  const cur = pub[f];
  const empty = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && !cur.length);
  const has = !(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length));
  if (empty && has) pub[f] = v;
};

async function mergeInto(pub, w) {
  for (const f of ['doi', 'eid', 'abstract', 'date', 'venue', 'publisher', 'volume', 'issue', 'pages', 'articleNumber', 'type', 'url', 'pdfUrl', 'year']) setIfEmpty(pub, f, w[f]);
  for (const f of ['issn', 'isbn', 'keywords', 'fields', 'countries']) if (w[f]?.length) pub[f] = uniq([...(pub[f] || []), ...w[f]]);
  // Scopus classifies document subtype authoritatively, so it overrides other providers' guess
  if (w.venueType && w.venueType !== 'unknown' && (pub.venueType === 'unknown' || w.provider === 'scopus')) pub.venueType = w.venueType;
  if (w.abstract && (!pub.abstract || w.abstract.length > pub.abstract.length)) pub.abstract = w.abstract;
  if (w.authors?.length && (w.authorsComplete || !pub.authors?.length)) {
    if (w.authorsComplete || w.authors.length > (pub.authors?.length || 0)) pub.authors = w.authors.map(({ name, orcid }) => ({ name, orcid }));
  }
  if (w.openAccess === 'yes' || (w.openAccess === 'no' && pub.openAccess === 'unknown')) pub.openAccess = w.openAccess;
  pub.providers = uniq([...(pub.providers || []), w.provider]);

  const rule = INDEX_RULES[w.provider]?.(w);
  if (rule) pub.indexing[rule.path] = { status: rule.status, checkedAt: new Date(), evidence: rule.evidence };

  if (w.citations && w.citations.count != null) {
    const prev = pub.citations.get(w.provider);
    pub.citations.set(w.provider, { count: w.citations.count, influential: w.citations.influential, via: w.via, retrievedAt: new Date() });
    if (!prev || prev.count !== w.citations.count) {
      await CitationSnapshot.create({ publication: pub._id, provider: w.provider, count: w.citations.count, influential: w.citations.influential });
    }
  }
}

const nameTokens = (n) => normTitle(n).split(' ').filter(Boolean);
export function authorPosition(authors, faculty, orcid) {
  if (!authors?.length) return null;
  if (orcid) {
    const i = authors.findIndex((a) => a.orcid === orcid);
    if (i >= 0) return i + 1;
  }
  const t = nameTokens(faculty.name);
  const surname = t.at(-1), initial = t[0]?.[0];
  const i = authors.findIndex((a) => {
    const at = nameTokens(a.name);
    return at.includes(surname) && at.some((x) => x !== surname && x[0] === initial);
  });
  return i >= 0 ? i + 1 : null;
}

// Known Scholar profile artefacts that are not papers; skipped on ingestion so they never reappear after cleanup.
const NOT_A_PAPER = [/^year of publication:\s*\d{4}$/i, /^kles dr msscet india$/i, /^international journal of medical, medicine and health sciences$/i];

/** Upsert one provider work for one faculty member. */
export async function upsertWork(faculty, work, ctx) {
  if (!work.title) return { skipped: true };
  if (work.provider === 'googlescholar' && NOT_A_PAPER.some((re) => re.test(work.title.trim()))) return { skipped: true };
  const stats = ctx.stats;
  const { pub: found, by } = await findExisting(work, stats);
  let pub = found, created = false;
  if (!pub) {
    pub = new Publication({ title: work.title, titleKey: normTitle(work.title), year: work.year });
    created = true;
  }
  await mergeInto(pub, work);
  pub.titleKey = normTitle(pub.title);
  await pub.save();

  await ProviderRecord.updateOne(
    { provider: work.provider, externalId: String(work.externalId), faculty: faculty._id },
    { $set: { publication: pub._id, normalized: { ...work, raw: undefined }, raw: work.raw, fetchedAt: new Date() } },
    { upsert: true }
  );

  const confidence = ctx.confidence ?? 0.8;
  const existing = await FacultyPublication.findOne({ faculty: faculty._id, publication: pub._id });
  const position = authorPosition(pub.authors, faculty, ctx.orcid);
  if (existing) {
    existing.matchedBy = uniq([...existing.matchedBy, work.provider + ':' + ctx.matchedBy]);
    existing.matchConfidence = Math.max(existing.matchConfidence || 0, confidence);
    if (position) existing.authorPosition = position;
    await existing.save();
  } else {
    await FacultyPublication.create({ faculty: faculty._id, publication: pub._id, authorPosition: position, matchConfidence: confidence, matchedBy: [work.provider + ':' + ctx.matchedBy] });
  }
  return { created, matchedExistingBy: by, pub };
}

export async function flushFuzzyTasks(faculty, stats) {
  for (const f of stats.fuzzy || []) {
    const ids = f.candidates.map((c) => String(c._id)).sort().join(',');
    await VerificationTask.updateOne(
      { dedupeKey: `dup:${normTitle(f.work.title)}:${ids}` },
      { $setOnInsert: { type: 'uncertain_duplicate', faculty: [faculty._id], payload: { incoming: { title: f.work.title, doi: f.work.doi, year: f.work.year, provider: f.work.provider }, candidates: f.candidates.map((c) => ({ id: c._id, title: c.title, doi: c.doi })) }, dedupeKey: `dup:${normTitle(f.work.title)}:${ids}` } },
      { upsert: true }
    );
  }
  stats.fuzzy = [];
}
