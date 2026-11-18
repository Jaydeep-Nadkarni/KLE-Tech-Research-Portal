// Fills empty fields from other real sources. Anything no source can supply stays empty (shown as N/A):
// values are never guessed or invented. Every step is idempotent.
import { Publication, FacultyPublication, Faculty, VerificationTask } from '../models/index.js';
import { findDoiByTitle } from '../providers/crossref.js';
import * as openalex from '../providers/openalex.js';
import { upsertWork } from './ingest.js';
import { mergePublications } from './merge.js';
import { syncFaculty } from './syncService.js';
import { syncJournals } from './journalSync.js';
import { logger } from '../utils/logger.js';

const live = async () => Publication.find({ _id: { $in: await FacultyPublication.find({ verificationStatus: { $ne: 'rejected' } }).distinct('publication') } });
const firstLink = (pubId) => FacultyPublication.findOne({ publication: pubId, verificationStatus: { $ne: 'rejected' } });

/** Step A: find DOIs for papers that have none (Scholar-only papers especially). Duplicates revealed by a DOI are merged. */
export async function discoverDois(onProgress) {
  const out = { tried: 0, found: 0, mergedDuplicates: 0, none: 0 };
  const pubs = (await live()).filter((p) => !p.doi && p.title && p.title.length > 20);
  let i = 0;
  for (const p of pubs) {
    onProgress?.('doi', ++i, pubs.length);
    out.tried++;
    try {
      const hit = await findDoiByTitle(p.title, p.year);
      if (!hit?.doi) { out.none++; continue; }
      const existing = await Publication.findOne({ doi: hit.doi, _id: { $ne: p._id } });
      if (existing) { await mergePublications(existing._id, p._id, { userEmail: 'system:gap-fill', reason: 'DOI found by Crossref title match revealed a duplicate' }); out.mergedDuplicates++; continue; }
      p.doi = hit.doi; if (!p.year && hit.year) p.year = hit.year;
      await p.save();
      out.found++;
    } catch (e) { logger.warn({ title: p.title.slice(0, 60), err: e.message }, 'doi discovery failed'); }
  }
  return out;
}

/** Step B: OpenAlex record by DOI for papers missing abstract / fields / keywords / countries / full authors / OA status. */
export async function enrichFromOpenAlex(onProgress) {
  const out = { tried: 0, matched: 0, notInOpenAlex: 0, errors: 0 };
  const need = (p) => p.doi && (!p.abstract || !p.fields?.length || !p.keywords?.length || !p.countries?.length || (p.authors || []).length <= 1 || p.openAccess === 'unknown' || !p.citations?.get('openalex') || !p.publisher);
  const pubs = (await live()).filter(need);
  let i = 0;
  for (const p of pubs) {
    onProgress?.('openalex', ++i, pubs.length);
    out.tried++;
    try {
      const w = await openalex.lookupByDoi(p.doi);
      if (!w) { out.notInOpenAlex++; continue; }
      const link = await firstLink(p._id);
      if (!link) continue;
      const fac = await Faculty.findById(link.faculty);
      await upsertWork(fac, w, { stats: {}, matchedBy: 'doi_gapfill', confidence: link.matchConfidence ?? 0.8 });
      out.matched++;
    } catch (e) { out.errors++; logger.warn({ doi: p.doi, err: e.message }, 'openalex gap-fill failed'); }
  }
  return out;
}

const CONF = /\b(proceedings|conference|symposium|workshop|congress|colloquium|convention)\b/i;
/** Step C: classify unknown venue types. Only the safe direction is inferred: a venue named "Proceedings/Conference/…" is a conference. */
export async function inferVenueTypes() {
  let n = 0;
  for (const p of (await live()).filter((x) => x.venueType === 'unknown' && x.venue)) {
    if (CONF.test(p.venue)) { p.venueType = 'conference'; await p.save(); n++; }
  }
  return { inferredConference: n };
}

/** Step D: ask OpenAlex/ORCID for author candidates for faculty without an OpenAlex profile; queue for admin review. */
export async function proposeAuthorCandidates() {
  const out = { faculty: 0, tasks: 0 };
  for (const f of await Faculty.find({ active: true })) {
    if (f.profiles?.get?.('openalex')) continue;
    out.faculty++;
    let candidates = [];
    try { candidates = await openalex.searchAuthors(f.name); } catch (e) { logger.warn({ faculty: f.name, err: e.message }, 'author candidate search failed'); continue; }
    // Keep only plausible ones: an institution mentioning KLE, or a surname match with some works
    const surname = f.name.split(/\s+/).at(-1).toLowerCase();
    const ranked = candidates.filter((c) => c.name.toLowerCase().includes(surname)).map((c) => ({ ...c, kleAffiliation: c.institutions.some((i) => /\bKLE\b|K\.? ?L\.? ?E\.?/i.test(i)) })).sort((a, b) => Number(b.kleAffiliation) - Number(a.kleAffiliation) || b.worksCount - a.worksCount).slice(0, 4);
    if (!ranked.length) continue;
    const r = await VerificationTask.updateOne({ dedupeKey: `authormatch:${f._id}` }, { $setOnInsert: { type: 'uncertain_author_match', faculty: [f._id], payload: { faculty: f.name, source: 'openalex', candidates: ranked, note: 'Name search only. Verify against the researcher before linking.' }, dedupeKey: `authormatch:${f._id}` } }, { upsert: true });
    if (r.upsertedCount) out.tasks++;
  }
  return out;
}

export async function fillGaps(onProgress) {
  const result = {};
  result.dois = await discoverDois(onProgress);
  result.enrichment = [];
  for (const f of await Faculty.find({ active: true })) result.enrichment.push({ faculty: f.name, ...(await syncFaculty(f, { providers: [] })) }); // Scopus-by-DOI, Crossref, Semantic Scholar
  result.openalex = await enrichFromOpenAlex(onProgress);
  result.venueTypes = await inferVenueTypes();
  result.journals = await syncJournals();
  result.authorCandidates = await proposeAuthorCandidates();
  return result;
}
