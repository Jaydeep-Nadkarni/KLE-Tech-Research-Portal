// OpenAlex adapter. Authors are resolved only through ORCID (OpenAlex carries no Scopus IDs).
import { env } from '../config/env.js';
import { createClient } from '../utils/http.js';
import { normDoi, normIssn, normOrcid, uniq } from '../utils/normalize.js';

const http = createClient({
  provider: 'openalex',
  baseURL: 'https://api.openalex.org',
  minIntervalMs: 150,
  headers: { Accept: 'application/json' },
});
const auth = () => ({ ...(env.openAlexKey ? { api_key: env.openAlexKey } : {}), ...(env.contactMailto ? { mailto: env.contactMailto } : {}) });

const WORK_FIELDS = 'id,doi,title,publication_year,publication_date,type,cited_by_count,authorships,primary_location,open_access,keywords,topics,biblio,abstract_inverted_index,ids,counts_by_year';

export const abstractFromIndex = (inv) => {
  if (!inv) return null;
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.filter(Boolean).join(' ') || null;
};

const venueTypeOf = (t) => ({ journal: 'journal', conference: 'conference', 'book series': 'book', 'ebook platform': 'book', repository: 'other' }[t] || 'unknown');

export function normalizeWork(w) {
  const src = w.primary_location?.source;
  const bib = w.biblio || {};
  return {
    provider: 'openalex',
    externalId: String(w.id).replace('https://openalex.org/', ''),
    doi: normDoi(w.doi),
    eid: null,
    title: w.title,
    abstract: abstractFromIndex(w.abstract_inverted_index),
    authors: (w.authorships || []).map((a) => ({ name: a.author?.display_name, orcid: normOrcid(a.author?.orcid), openalexId: a.author?.id })),
    authorsComplete: true,
    countries: uniq((w.authorships || []).flatMap((a) => (a.countries || a.institutions?.map((i) => i.country_code) || []))),
    year: w.publication_year,
    date: w.publication_date,
    venue: src?.display_name,
    venueType: venueTypeOf(src?.type),
    publisher: src?.host_organization_name,
    issn: uniq((src?.issn || []).map(normIssn)),
    type: w.type,
    volume: bib.volume || null, issue: bib.issue || null,
    pages: bib.first_page ? [bib.first_page, bib.last_page].filter(Boolean).join('-') : null,
    keywords: (w.keywords || []).map((k) => k.display_name),
    fields: uniq((w.topics || []).map((t) => t.field?.display_name)),
    url: w.primary_location?.landing_page_url || w.doi,
    pdfUrl: w.open_access?.oa_url || w.primary_location?.pdf_url || null,
    openAccess: w.open_access?.is_oa === true ? 'yes' : w.open_access?.is_oa === false ? 'no' : 'unknown',
    citations: { count: w.cited_by_count ?? null },
    countsByYear: w.counts_by_year,
    raw: w,
  };
}

/** Look up one work by DOI (used to fill gaps for papers found through other sources). null when OpenAlex has no record. */
export async function lookupByDoi(doi) {
  try {
    const { data } = await http.get(`/works/https://doi.org/${doi}`, { ...auth(), select: WORK_FIELDS });
    return normalizeWork(data);
  } catch (e) {
    if (e.kind === 'not_found') return null;
    throw e;
  }
}

/** Candidate OpenAlex authors for a name, for administrator review (never linked automatically). */
export async function searchAuthors(name) {
  const { data } = await http.get('/authors', { ...auth(), search: name, 'per-page': 8, select: 'id,display_name,ids,works_count,cited_by_count,last_known_institutions' });
  return (data.results || []).map((a) => ({
    openalexId: a.id.replace('https://openalex.org/', ''), name: a.display_name, orcid: normOrcid(a.ids?.orcid),
    worksCount: a.works_count, citedByCount: a.cited_by_count, institutions: (a.last_known_institutions || []).map((i) => i.display_name),
  }));
}

export async function resolveAuthor(orcid) {
  const { data } = await http.get(`/authors/orcid:${orcid}`, { ...auth(), select: 'id,display_name,ids,works_count,cited_by_count,summary_stats,last_known_institutions,topics' });
  return data;
}

// Accepts an ORCID or an OpenAlex author id (A123...). The latter is used once an admin has approved a candidate.
export async function fetchWorks(idOrOrcid) {
  const orcid = idOrOrcid;
  const a = /^A\d+$/.test(idOrOrcid) ? (await http.get(`/authors/${idOrOrcid}`, { ...auth(), select: 'id,display_name,ids,works_count,cited_by_count,summary_stats,last_known_institutions,topics' })).data : await resolveAuthor(orcid);
  const authorId = a.id.replace('https://openalex.org/', '');
  const works = [];
  let cursor = '*';
  while (cursor) {
    const { data } = await http.get('/works', { ...auth(), filter: `author.id:${authorId}`, 'per-page': 200, cursor, select: WORK_FIELDS });
    works.push(...data.results.map(normalizeWork));
    cursor = data.meta?.next_cursor && data.results.length ? data.meta.next_cursor : null;
  }
  const profile = {
    source: 'openalex',
    openalexId: authorId,
    name: a.display_name,
    worksCount: a.works_count,
    citedByCount: a.cited_by_count, // OpenAlex-specific figure
    hIndex: a.summary_stats?.h_index ?? null, // computed by OpenAlex from its own data
    i10Index: a.summary_stats?.i10_index ?? null,
    institutions: (a.last_known_institutions || []).map((i) => i.display_name),
    retrievedAt: new Date(),
  };
  return { works, profile, matchedBy: 'openalex_orcid', totalReported: a.works_count };
}
