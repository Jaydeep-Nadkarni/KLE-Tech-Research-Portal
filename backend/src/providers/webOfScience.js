// Web of Science via the Clarivate "Web of Science Starter API" (developer.clarivate.com). Needs a licensed or
// trial API key in CLARIVATE_API_KEY. Without it, Web of Science data comes only from file imports.
// Indexing is established only by a real WoS record found by DOI; absence from the Starter API is "not found",
// which depends on the key's entitlement and is not proof a paper is outside Web of Science.
import { env } from '../config/env.js';
import { createClient, ProviderError } from '../utils/http.js';
import { normDoi, normIssn, uniq } from '../utils/normalize.js';

export const configured = () => !!env.clarivateKey;

const client = () => createClient({ provider: 'webofscience', baseURL: 'https://api.clarivate.com/apis/wos-starter/v1', minIntervalMs: 350, maxRetries: 2, headers: { Accept: 'application/json', 'X-ApiKey': env.clarivateKey } });

const wosCitations = (h) => {
  const c = (h.citations || []).find((x) => /^(WOS|WOSCC)$/i.test(x.db)) || (h.citations || [])[0];
  return c && c.count != null ? { count: Number(c.count) } : null;
};

export function normalizeHit(h, via = 'api') {
  const src = h.source || {};
  const ids = h.identifiers || {};
  return {
    provider: 'webofscience', via,
    externalId: h.uid, // e.g. WOS:000123456700001
    doi: normDoi(ids.doi),
    title: h.title,
    authors: (h.names?.authors || []).map((a) => ({ name: a.displayName || a.wosStandard })).filter((a) => a.name),
    authorsComplete: true,
    year: src.publishYear ? Number(src.publishYear) : null,
    venue: src.sourceTitle || null,
    venueType: /proceeding|conference/i.test((h.sourceTypes || []).join(' ')) ? 'conference' : /journal/i.test((h.sourceTypes || []).join(' ')) ? 'journal' : 'unknown',
    volume: src.volume || null, issue: src.issue || null, pages: src.pages?.range || null,
    issn: uniq([normIssn(ids.issn), normIssn(ids.eissn)]),
    keywords: h.keywords?.authorKeywords || [],
    type: (h.types || [])[0]?.toLowerCase() || null,
    url: h.links?.record || null,
    citations: wosCitations(h), // Web of Science Core Collection "times cited"
    raw: h,
  };
}

/** @returns normalized WoS record, or null when the DOI is not found in the key's Web of Science coverage. */
export async function lookupByDoi(doi) {
  if (!configured()) throw new ProviderError('webofscience', 401, 'auth', 'CLARIVATE_API_KEY is not configured');
  const { data } = await client().get('/documents', { q: `DO=(${doi})`, limit: 1, db: 'WOS' });
  const hit = data?.hits?.[0];
  return hit ? normalizeHit(hit) : null;
}
