// ORCID Public API adapter (works summaries + person + employments). ORCID is an identity
// registry: a work being listed here is "linked", never evidence of any index.
import { createClient } from '../utils/http.js';
import { normDoi, normEid, normIssn, uniq, yearOf } from '../utils/normalize.js';

const http = createClient({
  provider: 'orcid',
  baseURL: 'https://pub.orcid.org/v3.0',
  minIntervalMs: 250,
  headers: { Accept: 'application/json' },
});

const typeMap = { 'journal-article': 'article', 'conference-paper': 'conference paper', 'book-chapter': 'book chapter', 'conference-abstract': 'conference abstract' };
const venueTypeOf = (t) => (t === 'journal-article' ? 'journal' : t === 'conference-paper' || t === 'conference-abstract' ? 'conference' : t?.startsWith('book') ? 'book' : 'unknown');

export function normalizeGroup(g) {
  const s = g['work-summary']?.[0];
  if (!s) return null;
  const ids = (g['external-ids']?.['external-id'] || []).concat(s['external-ids']?.['external-id'] || []);
  const pick = (t) => ids.filter((i) => i['external-id-type'] === t).map((i) => i['external-id-value']);
  const y = s['publication-date']?.year?.value;
  return {
    provider: 'orcid',
    externalId: String(s['put-code']),
    doi: normDoi(pick('doi')[0]),
    eid: normEid(pick('eid')[0]), // used only to link duplicates; does NOT prove Scopus indexing
    wosUid: pick('wosuid')[0] || null, // a claim by the ORCID record holder, not verification
    title: s.title?.title?.value,
    authors: [],
    authorsComplete: false,
    year: y ? Number(y) : null,
    venue: s['journal-title']?.value || null,
    venueType: venueTypeOf(s.type),
    type: typeMap[s.type] || s.type?.toLowerCase().replace(/_/g, ' ') || null,
    issn: uniq(pick('issn').map(normIssn)),
    isbn: pick('isbn'),
    url: s.url?.value || null,
    citations: null, // ORCID has no citation data
    raw: g,
  };
}

export async function fetchProfile(orcid) {
  const [person, emp] = await Promise.all([
    http.get(`/${orcid}/person`).then((r) => r.data),
    http.get(`/${orcid}/employments`).then((r) => r.data).catch(() => null),
  ]);
  const employments = (emp?.['affiliation-group'] || []).flatMap((g) => g.summaries || []).map((x) => x['employment-summary']).filter(Boolean);
  return {
    source: 'orcid',
    orcid,
    name: [person.name?.['given-names']?.value, person.name?.['family-name']?.value].filter(Boolean).join(' ') || null,
    otherNames: (person['other-names']?.['other-name'] || []).map((n) => n.content),
    externalIdentifiers: (person['external-identifiers']?.['external-identifier'] || []).map((i) => ({ type: i['external-id-type'], value: i['external-id-value'] })),
    employments: employments.map((e) => ({ organization: e.organization?.name, role: e['role-title'], startYear: yearOf(e['start-date']?.year?.value), endYear: e['end-date'] ? Number(e['end-date'].year?.value) : null })),
    retrievedAt: new Date(),
  };
}

export async function fetchWorks(orcid) {
  const [{ data }, profile] = await Promise.all([http.get(`/${orcid}/works`), fetchProfile(orcid).catch(() => null)]);
  const works = (data.group || []).map(normalizeGroup).filter((w) => w?.title);
  return { works, profile, matchedBy: 'orcid_works', totalReported: works.length };
}
