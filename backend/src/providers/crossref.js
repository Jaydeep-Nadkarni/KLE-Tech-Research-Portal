// Crossref enrichment by DOI. Crossref registers DOIs; it says nothing about Scopus indexing.
import { env } from '../config/env.js';
import { createClient, ProviderError } from '../utils/http.js';
import { normDoi, normIssn, uniq } from '../utils/normalize.js';

const http = createClient({
  provider: 'crossref',
  baseURL: 'https://api.crossref.org',
  minIntervalMs: 120,
  headers: { Accept: 'application/json' },
});

const typeMap = { 'journal-article': 'article', 'proceedings-article': 'conference paper', 'book-chapter': 'book chapter' };
const venueTypeOf = (t) => (t === 'journal-article' ? 'journal' : t === 'proceedings-article' ? 'conference' : t?.startsWith('book') ? 'book' : 'other');
const stripJats = (s) => (s ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/^\s*Abstract\s*/i, '').trim() : null);

/**
 * Find a DOI for a paper that has none, by bibliographic search. Accepts only a near-identical title within
 * one year of the known publication year; anything weaker returns null (no guessing).
 */
export async function findDoiByTitle(title, year) {
  const { data } = await http.get('/works', { 'query.bibliographic': title, rows: 3, select: 'DOI,title,issued,type', ...(env.contactMailto ? { mailto: env.contactMailto } : {}) });
  const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
  const want = norm(title);
  for (const it of data?.message?.items || []) {
    const got = norm(it.title?.[0]);
    const y = it.issued?.['date-parts']?.[0]?.[0];
    if (got && got === want && (!year || !y || Math.abs(y - year) <= 1)) return { doi: normDoi(it.DOI), year: y || null };
  }
  return null;
}

/** @returns normalized enrichment, or null if the DOI is not registered with Crossref (404). */
export async function lookupDoi(doi) {
  let m;
  try {
    const { data } = await http.get(`/works/${encodeURIComponent(doi)}`, env.contactMailto ? { mailto: env.contactMailto } : undefined);
    m = data.message;
  } catch (e) {
    if (e instanceof ProviderError && e.kind === 'not_found') return null;
    throw e;
  }
  const d = m.issued?.['date-parts']?.[0] || [];
  return {
    provider: 'crossref',
    externalId: m.DOI,
    doi: normDoi(m.DOI),
    title: m.title?.[0],
    abstract: stripJats(m.abstract),
    authors: (m.author || []).map((a) => ({ name: [a.given, a.family].filter(Boolean).join(' ') || a.name, orcid: a.ORCID ? a.ORCID.split('/').pop() : null })),
    authorsComplete: true,
    year: d[0] || null,
    date: d.length === 3 ? d.map((x, i) => (i ? String(x).padStart(2, '0') : x)).join('-') : null,
    venue: m['container-title']?.[0],
    venueType: venueTypeOf(m.type),
    publisher: m.publisher,
    issn: uniq((m.ISSN || []).map(normIssn)),
    isbn: m.ISBN || [],
    volume: m.volume || null, issue: m.issue || null, pages: m.page || null, articleNumber: m['article-number'] || null,
    type: typeMap[m.type] || m.type,
    url: m.URL,
    citations: m['is-referenced-by-count'] === undefined ? null : { count: m['is-referenced-by-count'] },
    raw: m,
  };
}
