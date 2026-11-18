// Scopus Serial Title API, STANDARD view (accessible with a plain API key). It returns
// CiteScore, SJR, SNIP, subject areas and Scopus coverage years. It does NOT return quartiles
// (those need the ENHANCED view or the SCImago file import).
import { env } from '../config/env.js';
import { createClient, ProviderError } from '../utils/http.js';
import { normIssn, uniq } from '../utils/normalize.js';

const client = () => {
  if (!env.elsevierKey) throw new ProviderError('scopus', 401, 'auth', 'ELSEVIER_API_KEY is not configured');
  return createClient({
    provider: 'scopus-serial', baseURL: env.scopusBase, minIntervalMs: 500,
    headers: { Accept: 'application/json', 'X-ELS-APIKey': env.elsevierKey, ...(env.elsevierInstToken ? { 'X-ELS-Insttoken': env.elsevierInstToken } : {}) },
  });
};

const list = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const numOrNull = (v) => { const x = Number(v); return v === null || v === undefined || v === '' || Number.isNaN(x) ? null : x; };

export function normalizeSerial(e) {
  const retrievedAt = new Date();
  const metrics = [];
  const src = 'Scopus Serial Title API';
  for (const s of list(e.SJRList?.SJR)) { const v = numOrNull(s.$); if (v != null) metrics.push({ metric: 'SJR', value: v, reportingYear: Number(s['@year']), source: src, retrievedAt }); }
  for (const s of list(e.SNIPList?.SNIP)) { const v = numOrNull(s.$); if (v != null) metrics.push({ metric: 'SNIP', value: v, reportingYear: Number(s['@year']), source: src, retrievedAt }); }
  const cs = e.citeScoreYearInfoList || {};
  const cur = numOrNull(cs.citeScoreCurrentMetric);
  if (cur != null && cs.citeScoreCurrentMetricYear) metrics.push({ metric: 'CiteScore', value: cur, reportingYear: Number(cs.citeScoreCurrentMetricYear), source: src, retrievedAt });
  const trk = numOrNull(cs.citeScoreTracker);
  if (trk != null && cs.citeScoreTrackerYear) metrics.push({ metric: 'CiteScore Tracker', value: trk, reportingYear: Number(cs.citeScoreTrackerYear), source: src, retrievedAt });
  return {
    journal: {
      title: e['dc:title'], publisher: e['dc:publisher'] || null,
      issn: uniq([normIssn(e['prism:issn']), normIssn(e['prism:eIssn'])]),
      aggregationType: e['prism:aggregationType'] || null,
      scopusSourceId: e['source-id'] ? String(e['source-id']) : null,
      scopusCoverage: { start: numOrNull(e.coverageStartYear), end: numOrNull(e.coverageEndYear) },
      subjectAreas: list(e['subject-area']).map((a) => ({ code: a['@code'], name: a.$ })),
      scopusUrl: list(e.link).find((l) => l['@ref'] === 'scopus-source')?.['@href'] || null,
    },
    metrics,
  };
}

/** @returns normalized {journal, metrics}, or null when Scopus has no source for this ISSN. */
export async function lookupByIssn(issn) {
  const http = client();
  try {
    const { data } = await http.get(`/content/serial/title/issn/${issn.replace('-', '')}`, { view: 'STANDARD' });
    const entry = data?.['serial-metadata-response']?.entry?.[0];
    if (!entry || entry.error) return null;
    return normalizeSerial(entry);
  } catch (e) {
    if (e instanceof ProviderError && e.kind === 'not_found') return null;
    throw e;
  }
}
