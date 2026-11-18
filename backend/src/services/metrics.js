// All metrics are computed from stored records. Every citation figure is per provider and
// is never combined across providers. Missing data is null (shown as N/A), never 0.
import { FacultyPublication, ProviderRecord, Faculty } from '../models/index.js';
import { loadQuartileMap, quartileSummary } from './quartiles.js';

const SOURCES = ['scopus', 'openalex', 'semanticscholar', 'crossref', 'googlescholar', 'webofscience'];
const SOURCE_LABEL = { scopus: 'Scopus', openalex: 'OpenAlex', semanticscholar: 'Semantic Scholar', crossref: 'Crossref', googlescholar: 'Google Scholar', webofscience: 'Web of Science' };

/** N/A (null) until at least one paper has actually been checked against Web of Science; then the count of indexed papers. */
export function wosCount(pubs) {
  const checked = pubs.filter((p) => !['not_checked', 'pending', undefined].includes(p.indexing?.webOfScience?.status));
  return checked.length ? pubs.filter((p) => p.indexing?.webOfScience?.status === 'indexed').length : null;
}
export const wosCoverage = (pubs) => ({
  checked: pubs.filter((p) => !['not_checked', 'pending', undefined].includes(p.indexing?.webOfScience?.status)).length,
  indexed: pubs.filter((p) => p.indexing?.webOfScience?.status === 'indexed').length,
  notFound: pubs.filter((p) => p.indexing?.webOfScience?.status === 'not_found').length,
  total: pubs.length,
});

export const hIndex = (counts) => { const s = [...counts].sort((a, b) => b - a); let h = 0; while (h < s.length && s[h] >= h + 1) h++; return h; };
export const i10 = (counts) => counts.filter((c) => c >= 10).length;
const tally = (arr, keyFn) => { const m = new Map(); for (const x of arr) { const k = keyFn(x); if (k == null || k === '') continue; m.set(k, (m.get(k) || 0) + 1); } return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value); };

export async function loadPubs(facultyIds, { yearFrom, yearTo } = {}) {
  const links = await FacultyPublication.find({ faculty: { $in: facultyIds }, verificationStatus: { $ne: 'rejected' } }).populate('publication').lean();
  const seen = new Map();
  for (const l of links) {
    const p = l.publication;
    if (!p) continue;
    if (yearFrom && (!p.year || p.year < yearFrom)) continue;
    if (yearTo && (!p.year || p.year > yearTo)) continue;
    if (!seen.has(String(p._id))) seen.set(String(p._id), { ...p, _links: [] });
    seen.get(String(p._id))._links.push(l);
  }
  return [...seen.values()];
}

const cite = (p, src) => p.citations?.[src]?.count ?? null;

/** pubs: unique publications. openalexYearCounts: [{year,count}] from OpenAlex counts_by_year. */
export function computeMetrics(pubs, { openalexYearCounts = [], openalexProfiles = [], quartileMap = new Map() } = {}) {
  const total = pubs.length;
  const scopusPubs = pubs.filter((p) => p.indexing?.scopus?.status === 'indexed');
  const citations = {};
  for (const s of SOURCES) {
    const withData = pubs.filter((p) => cite(p, s) != null);
    const counts = withData.map((p) => cite(p, s));
    citations[s] = withData.length
      ? { source: SOURCE_LABEL[s], total: counts.reduce((a, b) => a + b, 0), papersWithData: withData.length, perPaper: +(counts.reduce((a, b) => a + b, 0) / withData.length).toFixed(2) }
      : null;
  }
  // Portal-calculated indices: only meaningful where the source covers the stored papers
  const indices = {};
  for (const s of ['scopus', 'openalex']) {
    const counts = pubs.map((p) => cite(p, s)).filter((c) => c != null);
    indices[s] = counts.length ? { source: `Portal-calculated from ${SOURCE_LABEL[s]} citation counts of ${counts.length} stored papers`, h: hIndex(counts), i10: i10(counts) } : null;
  }
  const reported = openalexProfiles.length === 1 ? openalexProfiles[0] : null;

  const pubsByYear = tally(pubs, (p) => p.year).map((x) => ({ year: x.name, count: x.value })).sort((a, b) => a.year - b.year);
  const yc = new Map();
  for (const r of openalexYearCounts) yc.set(r.year, (yc.get(r.year) || 0) + r.count);
  let run = 0;
  const citationsByYear = [...yc].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count, cumulative: (run += count) }));

  const intl = pubs.filter((p) => (p.countries || []).some((c) => c !== 'IN'));
  const withCountry = pubs.filter((p) => (p.countries || []).length);
  const countryTally = tally(pubs.flatMap((p) => [...new Set(p.countries || [])].filter((c) => c !== 'IN')), (c) => c);
  const journal = pubs.filter((p) => p.venueType === 'journal');

  return {
    totalPublications: total,
    scopusPublications: scopusPubs.length,
    webOfSciencePublications: wosCount(pubs), // null (N/A) until papers have been checked against Web of Science
    webOfScienceCoverage: wosCoverage(pubs),
    citations, indices,
    providerReported: reported,
    quartiles: quartileSummary(pubs, quartileMap),
    openAccess: { yes: pubs.filter((p) => p.openAccess === 'yes').length, known: pubs.filter((p) => p.openAccess !== 'unknown').length, source: 'OpenAlex / Semantic Scholar / Scopus flags' },
    internationalCollaboration: { papers: withCountry.length ? intl.length : null, papersWithCountryData: withCountry.length, topCountries: countryTally.slice(0, 10), source: 'OpenAlex author institutions' },
    pubsByYear, citationsByYear,
    citationsByYearSource: 'OpenAlex counts_by_year (citations received per year)',
    publicationTypes: tally(pubs, (p) => p.venueType === 'unknown' ? p.type : p.venueType),
    publishers: tally(pubs, (p) => p.publisher).slice(0, 12),
    venues: tally(pubs, (p) => p.venue).slice(0, 12),
    researchAreas: tally(pubs.flatMap((p) => p.fields || []), (f) => f).slice(0, 12),
    indexingDistribution: [
      { name: 'Scopus indexed', value: scopusPubs.length },
      { name: 'Not in Scopus (checked)', value: pubs.filter((p) => p.indexing?.scopus?.status === 'not_found').length },
      { name: 'Scopus pending', value: pubs.filter((p) => p.indexing?.scopus?.status === 'pending').length },
    ],
    thisYear: pubs.filter((p) => p.year === new Date().getFullYear()).length,
  };
}

export async function openalexYearCountsFor(facultyIds, pubIds) {
  const recs = await ProviderRecord.find({ provider: 'openalex', faculty: { $in: facultyIds }, publication: { $in: pubIds } }).select('publication normalized.countsByYear').lean();
  const byPub = new Map(); // one entry per unique publication, even if linked to several faculty
  for (const r of recs) if (!byPub.has(String(r.publication))) byPub.set(String(r.publication), r.normalized?.countsByYear || []);
  return [...byPub.values()].flat().map((c) => ({ year: c.year, count: c.cited_by_count }));
}

export async function facultyMetrics(facultyId, opts) {
  const pubs = await loadPubs([facultyId], opts);
  const f = await Faculty.findById(facultyId).lean();
  const oa = f?.profiles?.openalex;
  const yc = await openalexYearCountsFor([facultyId], pubs.map((p) => p._id));
  return computeMetrics(pubs, { quartileMap: await loadQuartileMap(pubs), openalexYearCounts: yc, openalexProfiles: oa ? [{ source: 'OpenAlex (provider-reported, all years)', hIndex: oa.hIndex, i10Index: oa.i10Index, citedByCount: oa.citedByCount, worksCount: oa.worksCount, retrievedAt: oa.retrievedAt }] : [] });
}

export { SOURCES, SOURCE_LABEL };
