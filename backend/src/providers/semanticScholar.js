// Semantic Scholar enrichment by DOI (batch). Anonymous use is heavily rate limited:
// the client backs off on 429; set SEMANTIC_SCHOLAR_API_KEY for higher limits.
import { env } from '../config/env.js';
import { createClient } from '../utils/http.js';
import { normDoi, uniq } from '../utils/normalize.js';

const http = createClient({
  provider: 'semanticscholar',
  baseURL: 'https://api.semanticscholar.org/graph/v1',
  minIntervalMs: env.semanticScholarKey ? 1100 : 3500,
  maxRetries: 5,
  headers: { 'Content-Type': 'application/json', ...(env.semanticScholarKey ? { 'x-api-key': env.semanticScholarKey } : {}) },
});

const FIELDS = 'title,abstract,year,venue,citationCount,influentialCitationCount,fieldsOfStudy,openAccessPdf,isOpenAccess,publicationTypes,externalIds,paperId';

/** @returns Map<doi, normalized|null>; null means S2 does not have the paper. */
export async function lookupDois(dois) {
  const out = new Map();
  for (let i = 0; i < dois.length; i += 100) {
    const chunk = dois.slice(i, i + 100);
    const { data } = await http.post('/paper/batch', { ids: chunk.map((d) => `DOI:${d}`) }, { fields: FIELDS });
    chunk.forEach((doi, idx) => {
      const p = data[idx];
      out.set(doi, !p ? null : {
        provider: 'semanticscholar',
        externalId: p.paperId,
        doi: normDoi(p.externalIds?.DOI) || doi,
        title: p.title,
        abstract: p.abstract || null,
        year: p.year,
        venue: p.venue || null,
        fields: uniq(p.fieldsOfStudy || []),
        openAccess: p.isOpenAccess === true ? 'yes' : p.isOpenAccess === false ? 'no' : 'unknown',
        pdfUrl: p.openAccessPdf?.url || null,
        url: `https://www.semanticscholar.org/paper/${p.paperId}`,
        citations: { count: p.citationCount ?? null, influential: p.influentialCitationCount ?? null },
        raw: p,
      });
    });
  }
  return out;
}
