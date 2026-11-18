import { Faculty, Publication, FacultyPublication, ProviderRecord, SyncLog, ResearcherIdentifier } from '../models/index.js';
import { usableIdentifier } from './identifierValidation.js';
import { upsertWork, flushFuzzyTasks } from './ingest.js';
import * as scopus from '../providers/scopus.js';
import * as openalex from '../providers/openalex.js';
import * as orcid from '../providers/orcid.js';
import * as crossref from '../providers/crossref.js';
import * as s2 from '../providers/semanticScholar.js';
import * as gscholar from '../providers/googleScholar.js';
import * as wos from '../providers/webOfScience.js';
import { ResearcherMetricSnapshot } from '../models/index.js';
import { ProviderError } from '../utils/http.js';
import { logger } from '../utils/logger.js';

// Discovery providers: each resolves a faculty member through one identifier type.
const DISCOVERY = [
  { name: 'scopus', idType: 'scopus', mod: scopus, strong: 0.97 },
  { name: 'orcid', idType: 'orcid', mod: orcid, strong: 0.95 },
  { name: 'openalex', idType: 'orcid', mod: openalex, strong: 0.85 }, // OpenAlex disambiguation can be wrong
  { name: 'googlescholar', idType: 'scholar', mod: gscholar, strong: 0.9 },
];

async function setSync(faculty, provider, patch) {
  const cur = faculty.sync.get(provider)?.toObject?.() || faculty.sync.get(provider) || {};
  faculty.sync.set(provider, { ...cur, ...patch });
  await faculty.save();
}

async function log(faculty, provider, base) {
  await SyncLog.create({ faculty: faculty._id, provider, ...base, finishedAt: new Date() });
}

async function runDiscovery(faculty, d, stats) {
  const startedAt = new Date();
  if (d.name === 'googlescholar' && !gscholar.configured()) {
    // Not an error: Scholar simply has no free official API. Manual entry remains available.
    await log(faculty, d.name, { status: 'skipped', startedAt, message: 'SERPAPI_API_KEY not configured; Google Scholar data is manual-entry only' });
    await setSync(faculty, d.name, { lastAttemptAt: startedAt, status: 'unavailable', error: 'no API provider configured' });
    return { name: d.name, status: 'unavailable' };
  }
  // An administrator-approved OpenAlex author id takes priority over ORCID resolution
  const idValue = (d.name === 'openalex' && (await usableIdentifier(faculty._id, 'openalex'))) || (await usableIdentifier(faculty._id, d.idType));
  if (!idValue) {
    await log(faculty, d.name, { status: 'skipped', startedAt, message: `No usable ${d.idType} identifier (missing, conflicting or rejected); admin verification required` });
    await setSync(faculty, d.name, { lastAttemptAt: startedAt, status: 'skipped', error: `no usable ${d.idType} id` });
    return { name: d.name, status: 'skipped' };
  }
  await setSync(faculty, d.name, { lastAttemptAt: startedAt });
  try {
    const verified = (await ResearcherIdentifier.exists({ faculty: faculty._id, type: d.idType, value: idValue, status: 'verified' })) != null;
    const { works, profile, matchedBy, totalReported } = await d.mod.fetchWorks(idValue);
    let created = 0, updated = 0;
    for (const w of works) {
      const r = await upsertWork(faculty, w, { stats, matchedBy, confidence: verified ? Math.min(0.99, d.strong + 0.02) : d.strong, orcid: await usableIdentifier(faculty._id, 'orcid') });
      if (r.skipped) continue;
      r.created ? created++ : updated++;
    }
    await flushFuzzyTasks(faculty, stats);
    if (profile) {
      faculty.profiles.set(d.name, profile);
      await ResearcherMetricSnapshot.create({ faculty: faculty._id, provider: d.name, mode: 'api', metrics: profile });
    }
    faculty.markModified('profiles');
    await faculty.save();
    await log(faculty, d.name, { status: 'success', fetched: works.length, created, updated, startedAt, message: totalReported != null ? `provider reported ${totalReported}` : undefined });
    await setSync(faculty, d.name, { lastSuccessAt: new Date(), status: 'success', error: null, count: works.length });
    return { name: d.name, status: 'success', fetched: works.length, created, updated, reported: totalReported };
  } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : 'unexpected';
    logger.error({ provider: d.name, faculty: faculty.name, err: e.message }, 'discovery failed');
    await log(faculty, d.name, { status: 'failed', errorKind: kind, message: e.message, startedAt });
    await setSync(faculty, d.name, { status: 'failed', error: `${kind}: ${e.message}`.slice(0, 300) });
    return { name: d.name, status: 'failed', error: e.message };
  }
}

const STALE_MS = 7 * 864e5;
const stale = (st) => !st?.checkedAt || Date.now() - new Date(st.checkedAt) > STALE_MS;

/** Evidence-based Scopus check for papers found elsewhere: query Scopus by DOI. */
async function verifyScopusByDoi(faculty, links, stats) {
  const out = { checked: 0, indexed: 0, notFound: 0, error: null };
  for (const l of links) {
    const pub = await Publication.findById(l.publication);
    if (!pub.doi || pub.indexing.scopus.status !== 'pending' || !stale(pub.indexing.scopus)) continue;
    try {
      const rec = await scopus.lookupByDoi(pub.doi);
      out.checked++;
      if (rec) {
        await upsertWork(faculty, rec, { stats, matchedBy: 'doi_lookup', confidence: l.matchConfidence ?? 0.8 });
        out.indexed++;
      } else {
        pub.indexing.scopus = { status: 'not_found', checkedAt: new Date(), evidence: 'Scopus DOI search returned no document' };
        await pub.save();
        out.notFound++;
      }
    } catch (e) {
      out.error = e.message;
      break; // quota/auth problem: stop spending calls, leave statuses as 'pending'
    }
  }
  return out;
}

/** Web of Science check by DOI (needs CLARIVATE_API_KEY). Stops at the first quota/auth error to protect the allowance. */
async function verifyWosByDoi(faculty, links, stats) {
  const out = { configured: wos.configured(), checked: 0, indexed: 0, notFound: 0, error: null };
  if (!out.configured) return out;
  for (const l of links) {
    const pub = await Publication.findById(l.publication);
    if (!pub.doi || !['not_checked', 'pending'].includes(pub.indexing.webOfScience.status) || !stale(pub.indexing.webOfScience)) continue;
    try {
      const rec = await wos.lookupByDoi(pub.doi);
      out.checked++;
      if (rec) { await upsertWork(faculty, rec, { stats, matchedBy: 'doi_lookup', confidence: l.matchConfidence ?? 0.8 }); out.indexed++; }
      else { pub.indexing.webOfScience = { status: 'not_found', checkedAt: new Date(), evidence: 'No Web of Science Starter API record for this DOI' }; await pub.save(); out.notFound++; }
    } catch (e) { out.error = e.message; break; }
  }
  return out;
}

async function enrichCrossref(faculty, links, stats) {
  const out = { checked: 0, registered: 0, notFound: 0, error: null };
  for (const l of links) {
    const pub = await Publication.findById(l.publication);
    if (!pub.doi || !stale(pub.indexing.crossref)) continue;
    try {
      const rec = await crossref.lookupDoi(pub.doi);
      out.checked++;
      if (rec) { await upsertWork(faculty, rec, { stats, matchedBy: 'doi', confidence: l.matchConfidence ?? 0.8 }); out.registered++; }
      else { pub.indexing.crossref = { status: 'doi_not_found', checkedAt: new Date(), evidence: 'Crossref 404' }; await pub.save(); out.notFound++; }
    } catch (e) { out.error = e.message; logger.warn({ doi: pub.doi, err: e.message }, 'crossref enrich failed'); }
  }
  return out;
}

async function enrichSemanticScholar(faculty, links, stats) {
  const out = { checked: 0, found: 0, notFound: 0, error: null };
  const pubs = [];
  for (const l of links) {
    const pub = await Publication.findById(l.publication);
    if (pub.doi && stale(pub.indexing.semanticScholar)) pubs.push({ pub, l });
  }
  if (!pubs.length) return out;
  try {
    const res = await s2.lookupDois(pubs.map((p) => p.pub.doi));
    for (const { pub, l } of pubs) {
      const rec = res.get(pub.doi);
      out.checked++;
      if (rec) { await upsertWork(faculty, rec, { stats, matchedBy: 'doi', confidence: l.matchConfidence ?? 0.8 }); out.found++; }
      else { pub.indexing.semanticScholar = { status: 'not_found', checkedAt: new Date(), evidence: 'Semantic Scholar batch lookup returned null' }; await pub.save(); out.notFound++; }
    }
  } catch (e) { out.error = e.message; }
  return out;
}

export async function syncFaculty(faculty, { enrich = true, providers } = {}) {
  const stats = {};
  const result = { faculty: faculty.name, discovery: [] };
  for (const d of DISCOVERY.filter((x) => !providers || providers.includes(x.name))) result.discovery.push(await runDiscovery(faculty, d, stats));
  if (enrich) {
    const links = await FacultyPublication.find({ faculty: faculty._id });
    result.scopusDoiCheck = await verifyScopusByDoi(faculty, links, stats);
    result.webOfScience = await verifyWosByDoi(faculty, links, stats);
    result.crossref = await enrichCrossref(faculty, links, stats);
    result.semanticScholar = await enrichSemanticScholar(faculty, links, stats);
  }
  result.uniquePublications = await FacultyPublication.countDocuments({ faculty: faculty._id });
  return result;
}

export const findFaculty = (q) => Faculty.find(q ? { $or: [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }] } : { active: true });
