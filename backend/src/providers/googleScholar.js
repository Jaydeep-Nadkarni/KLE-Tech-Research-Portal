// Google Scholar has no public API and Google forbids automated access, so the portal never scrapes it.
// This adapter uses SerpApi's Google Scholar Author API, a third-party provider the university must have
// agreed to use (needs SERPAPI_API_KEY). Without a key, Scholar data comes only from manual entry.
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { createClient, ProviderError } from '../utils/http.js';
import { normTitle, uniq } from '../utils/normalize.js';

export const configured = () => !!env.serpApiKey;

const http = () => createClient({ provider: 'googlescholar', baseURL: 'https://serpapi.com', minIntervalMs: 1000, maxRetries: 2, headers: { Accept: 'application/json' } });

// SerpApi reports many failures as HTTP 200 with an "error" field
function mapError(msg) {
  if (/invalid api key|api key/i.test(msg)) return new ProviderError('googlescholar', 401, 'auth', `SerpApi: ${msg}`);
  if (/run out of searches|plan|limit/i.test(msg)) return new ProviderError('googlescholar', 429, 'rate_limited', `SerpApi: ${msg}`);
  if (/hasn't returned any results|no results|not found/i.test(msg)) return new ProviderError('googlescholar', 404, 'not_found', `SerpApi: ${msg}`);
  return new ProviderError('googlescholar', 400, 'bad_request', `SerpApi: ${msg}`);
}

export const splitAuthors = (s) => String(s || '').split(/,| and /).map((x) => x.trim()).filter((x) => x && x !== '...' && x !== '…');

/** Shared by the API adapter and the manual importer so both produce identical normalized works. */
export function makeWork({ title, authors, venue, year, citations, id, url, via, venueType, volume, issue, pages, publisher, raw }) {
  const y = Number(year) || null;
  return {
    provider: 'googlescholar', via,
    externalId: id || crypto.createHash('sha1').update(`${normTitle(title)}|${y || ''}`).digest('hex').slice(0, 16),
    title: String(title || '').trim(), doi: null, eid: null,
    authors: splitAuthors(authors).map((name) => ({ name })), authorsComplete: false,
    year: y, venue: venue || null, venueType: venueType || 'unknown',
    volume: volume || null, issue: issue || null, pages: pages || null, publisher: publisher || null,
    url: url || null,
    citations: citations == null || citations === '' || Number.isNaN(Number(citations)) ? null : { count: Number(citations) },
    raw,
  };
}

const metricPair = (obj) => {
  if (!obj) return null;
  const sinceKey = Object.keys(obj).find((k) => /^since_\d{4}$/.test(k));
  return { all: obj.all ?? null, since: sinceKey ? obj[sinceKey] ?? null : null, sinceYear: sinceKey ? Number(sinceKey.slice(6)) : null };
};

export function normalizeProfile(data, scholarId) {
  const a = data.author || {};
  const table = {};
  for (const row of data.cited_by?.table || []) for (const [k, v] of Object.entries(row)) table[k] = metricPair(v);
  return {
    source: 'googlescholar', mode: 'api', scholarId, verification: 'api',
    profileUrl: `https://scholar.google.com/citations?user=${scholarId}`,
    name: a.name || null, affiliation: a.affiliations || null, emailNote: a.email || null,
    interests: (a.interests || []).map((i) => i.title).filter(Boolean),
    totalCitations: table.citations || null, hIndex: table.h_index || null, i10Index: table.i10_index || null,
    citationsByYear: (data.cited_by?.graph || []).map((g) => ({ year: g.year, citations: g.citations })),
    coAuthors: (data.co_authors || []).map((c) => ({ name: c.name, affiliation: c.affiliations || null })),
    retrievedAt: new Date(),
  };
}

export async function fetchWorks(scholarId) {
  if (!configured()) throw new ProviderError('googlescholar', 401, 'auth', 'SERPAPI_API_KEY is not configured');
  const client = http();
  const call = async (start) => {
    const { data } = await client.get('/search.json', { engine: 'google_scholar_author', author_id: scholarId, hl: 'en', sort: 'pubdate', num: 100, start, api_key: env.serpApiKey });
    if (data?.error) throw mapError(String(data.error));
    return data;
  };
  let first = await call(0);
  const articles = [...(first.articles || [])];
  let page = first;
  for (let start = 100; page.serpapi_pagination?.next && (page.articles || []).length === 100 && start < 2000; start += 100) {
    page = await call(start);
    articles.push(...(page.articles || []));
  }
  const works = articles.map((a) => makeWork({
    title: a.title, authors: a.authors, venue: a.publication, year: a.year, citations: a.cited_by?.value ?? null,
    id: a.citation_id, url: a.link, via: 'api', raw: a,
  }));
  return { works, profile: normalizeProfile(first, scholarId), matchedBy: 'scholar_serpapi', totalReported: works.length };
}

export { uniq };
