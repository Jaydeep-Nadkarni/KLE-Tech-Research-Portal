// Manually supplied Google Scholar data: author metrics and publication lists (CSV/BibTeX export).
// Manual data is always labelled mode "manual" with who entered it and whether an admin approved it.
import { parse } from 'csv-parse/sync';
import { Faculty, ResearcherMetricSnapshot } from '../models/index.js';
import { makeWork } from '../providers/googleScholar.js';
import { upsertWork, flushFuzzyTasks } from './ingest.js';

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** Google Scholar profile export: Authors,Title,Publication,Volume,Number,Pages,Year,Publisher (+ optional citation column). */
export function parseScholarCsv(text) {
  const rows = parse(text, { columns: (h) => h.map((x) => String(x).trim().toLowerCase()), bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  return rows.filter((r) => r.title).map((r) => makeWork({
    title: r.title, authors: r.authors, venue: r.publication || r.journal || r.venue || r['book title'], year: r.year,
    volume: r.volume, issue: r.number || r.issue, pages: r.pages, publisher: r.publisher,
    citations: num(r['cited by'] ?? r.citations ?? r['total citations']), via: 'manual', raw: r,
  }));
}

const BIB_TYPE = { article: 'journal', inproceedings: 'conference', conference: 'conference', incollection: 'book', inbook: 'book', book: 'book' };
export function parseBibtex(text) {
  const out = [];
  const entryRe = /@(\w+)\s*\{\s*([^,]*),([\s\S]*?)\n\}/g;
  let m;
  while ((m = entryRe.exec(text + '\n'))) {
    const type = m[1].toLowerCase();
    const f = {};
    const fieldRe = /(\w+)\s*=\s*(\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g;
    let fm;
    while ((fm = fieldRe.exec(m[3]))) f[fm[1].toLowerCase()] = (fm[3] ?? fm[4] ?? fm[5] ?? '').replace(/\s+/g, ' ').trim();
    if (!f.title) continue;
    out.push(makeWork({
      title: f.title.replace(/[{}]/g, ''), authors: f.author, venue: f.journal || f.booktitle || f.publisher, year: f.year,
      volume: f.volume, issue: f.number, pages: f.pages, publisher: f.publisher, venueType: BIB_TYPE[type], via: 'manual', raw: { bibtexType: type, ...f },
    }));
  }
  return out;
}

export function parseScholarFile(name, text) {
  return /\.bib(tex)?$/i.test(name) || /^\s*@\w+\s*\{/.test(text) ? parseBibtex(text) : parseScholarCsv(text);
}

const pair = (all, since, sinceYear) => (all == null ? null : { all, since: since ?? null, sinceYear: sinceYear ?? null });

/** Store manually entered author metrics. Admin entries are verified; faculty entries wait for approval. */
export async function saveManualProfile(faculty, input, user, isAdmin) {
  const prev = faculty.profiles?.get?.('googlescholar') || {};
  const verified = isAdmin;
  const profile = {
    ...prev,
    source: 'googlescholar', mode: 'manual', scholarId: prev.scholarId,
    profileUrl: faculty.scholarProfileUrl || prev.profileUrl,
    verification: verified ? 'verified' : 'pending_approval',
    enteredBy: user.email, enteredAt: new Date(),
    verifiedBy: verified ? user.email : null, lastVerifiedAt: verified ? new Date() : null,
    name: input.name ?? prev.name ?? faculty.name,
    affiliation: input.affiliation ?? prev.affiliation ?? null,
    interests: input.interests ?? prev.interests ?? [],
    totalCitations: pair(input.totalCitations, input.totalCitationsSince, input.sinceYear),
    hIndex: pair(input.hIndex, input.hIndexSince, input.sinceYear),
    i10Index: pair(input.i10Index, input.i10IndexSince, input.sinceYear),
    citationsByYear: input.citationsByYear ?? prev.citationsByYear ?? [],
    coAuthors: input.coAuthors ?? prev.coAuthors ?? [],
    retrievedAt: new Date(), // when the numbers were read off the profile, entered by a person
    asOfDate: input.asOfDate || new Date().toISOString().slice(0, 10),
  };
  faculty.profiles.set('googlescholar', profile);
  faculty.markModified('profiles');
  await faculty.save();
  await ResearcherMetricSnapshot.create({ faculty: faculty._id, provider: 'googlescholar', mode: 'manual', metrics: profile, recordedBy: user.email });
  return profile;
}

export async function approveManualProfile(faculty, user) {
  const p = faculty.profiles.get('googlescholar');
  if (!p || p.mode !== 'manual') return null;
  faculty.profiles.set('googlescholar', { ...p, verification: 'verified', verifiedBy: user.email, lastVerifiedAt: new Date() });
  faculty.markModified('profiles');
  await faculty.save();
  return faculty.profiles.get('googlescholar');
}

/** Import a parsed Scholar publication list for one faculty member (admin action). */
export async function importScholarWorks(faculty, works) {
  const stats = {};
  const out = { total: works.length, created: 0, matchedExisting: 0, skipped: 0 };
  for (const w of works) {
    const r = await upsertWork(faculty, w, { stats, matchedBy: 'scholar_import', confidence: 0.9 });
    if (r.skipped) out.skipped++; else r.created ? out.created++ : out.matchedExisting++;
  }
  await flushFuzzyTasks(faculty, stats);
  const f = await Faculty.findById(faculty._id);
  const p = f.profiles.get('googlescholar') || { source: 'googlescholar', mode: 'manual', verification: 'pending_approval' };
  f.profiles.set('googlescholar', { ...p, publicationsImportedAt: new Date(), publicationsImported: works.length });
  f.markModified('profiles');
  await f.save();
  return out;
}
