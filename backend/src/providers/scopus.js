// Scopus adapter. Works with a plain API key (STANDARD search view only); see
// backend/reports/scopus-diagnostic.md for what the key can and cannot access.
import { env } from '../config/env.js';
import { createClient, ProviderError } from '../utils/http.js';
import { normDoi, normEid, normIssn, uniq } from '../utils/normalize.js';

const PAGE = 25; // maximum page size for this entitlement level (verified by diagnostic)

const client = () => {
  if (!env.elsevierKey) throw new ProviderError('scopus', 401, 'auth', 'ELSEVIER_API_KEY is not configured');
  return createClient({
    provider: 'scopus',
    baseURL: env.scopusBase,
    minIntervalMs: 500,
    headers: { Accept: 'application/json', 'X-ELS-APIKey': env.elsevierKey, ...(env.elsevierInstToken ? { 'X-ELS-Insttoken': env.elsevierInstToken } : {}) },
  });
};

// The document subtype is more reliable than the source type: a conference paper published in a
// book series (e.g. Lecture Notes) has aggregationType "Book Series" but is still a conference paper.
export const venueTypeOf = (agg, subtype) => {
  if (/conference/i.test(subtype || '')) return 'conference';
  if (/book chapter|^book$/i.test(subtype || '')) return 'book';
  if (/^(article|review|letter|note|editorial|short survey|erratum)$/i.test(subtype || '') && (agg === 'Journal' || agg === 'Trade Journal')) return 'journal';
  return { Journal: 'journal', 'Conference Proceeding': 'conference', 'Book Series': 'book', Book: 'book', 'Trade Journal': 'journal' }[agg] || 'unknown';
};

export function normalizeEntry(e) {
  const eid = normEid(e.eid) || normEid(String(e['dc:identifier'] || '').replace('SCOPUS_ID:', '2-s2.0-'));
  const scopusId = String(e['dc:identifier'] || '').replace('SCOPUS_ID:', '');
  const cited = e['citedby-count'];
  return {
    provider: 'scopus',
    externalId: eid || scopusId,
    doi: normDoi(e['prism:doi']),
    eid,
    title: e['dc:title'],
    // STANDARD view exposes only the first author. Full author list needs the COMPLETE view (not entitled).
    authors: e['dc:creator'] ? [{ name: e['dc:creator'] }] : [],
    authorsComplete: false,
    year: e['prism:coverDate'] ? Number(String(e['prism:coverDate']).slice(0, 4)) : null,
    date: e['prism:coverDate'] || null,
    venue: e['prism:publicationName'],
    venueType: venueTypeOf(e['prism:aggregationType'], e.subtypeDescription),
    type: (e.subtypeDescription || '').toLowerCase() || null,
    issn: uniq([normIssn(e['prism:issn']), normIssn(e['prism:eIssn'])]),
    isbn: e['prism:isbn'] ? uniq([].concat(e['prism:isbn']).map((i) => i.$ || i)) : [],
    volume: e['prism:volume'] || null,
    issue: e['prism:issueIdentifier'] || null,
    pages: e['prism:pageRange'] || null,
    articleNumber: e['article-number'] || null,
    openAccess: e.openaccessFlag === true || e.openaccess === '1' ? 'yes' : e.openaccess === '0' || e.openaccessFlag === false ? 'no' : 'unknown',
    url: scopusId ? `https://www.scopus.com/pages/publications/${scopusId}` : null,
    citations: cited === undefined || cited === '' ? null : { count: Number(cited) },
    raw: e,
  };
}

/** All documents for a Scopus Author ID, paginated with offset paging (cursor is not entitled). */
export async function fetchWorks(scopusAuthorId, { onPage } = {}) {
  const http = client();
  const works = [];
  let start = 0;
  let total = Infinity;
  while (start < total) {
    const { data } = await http.get('/content/search/scopus', { query: `AU-ID(${scopusAuthorId})`, view: 'STANDARD', count: PAGE, start });
    const sr = data?.['search-results'];
    total = Number(sr?.['opensearch:totalResults'] ?? 0);
    const entries = (sr?.entry || []).filter((e) => e['dc:identifier']); // an error-only entry has no identifier
    works.push(...entries.map(normalizeEntry));
    if (onPage) onPage(works.length, total);
    if (!entries.length) break;
    start += PAGE;
  }
  return { works, profile: null, matchedBy: 'scopus_au_id', totalReported: Number.isFinite(total) ? total : works.length };
}

/** Evidence-based Scopus indexing check for one DOI. Returns normalized record or null if Scopus has none. */
export async function lookupByDoi(doi) {
  const http = client();
  const { data } = await http.get('/content/search/scopus', { query: `DOI(${doi})`, view: 'STANDARD', count: 1 });
  const e = (data?.['search-results']?.entry || []).find((x) => x['dc:identifier']);
  return e ? normalizeEntry(e) : null;
}
