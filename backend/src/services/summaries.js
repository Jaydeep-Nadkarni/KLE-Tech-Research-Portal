import { Faculty } from '../models/index.js';
import { loadPubs, computeMetrics, openalexYearCountsFor, hIndex, i10, SOURCE_LABEL, wosCount } from './metrics.js';
import { loadQuartileMap, quartileSummary } from './quartiles.js';

/** One row per faculty for the comparison table. `source` selects which provider's citations to show. */
export async function facultyRows(source = 'scopus', opts = {}, facultyFilter = { active: true }) {
  const faculty = await Faculty.find(facultyFilter).sort({ name: 1 }).lean();
  const rows = [];
  for (const f of faculty) {
    const pubs = await loadPubs([f._id], opts);
    const counts = pubs.map((p) => p.citations?.[source]?.count).filter((c) => c != null);
    // Google Scholar has no complete per-paper dataset here: use the author's own profile figures (provider-reported)
    const gs = source === 'googlescholar' ? f.profiles?.googlescholar : null;
    const reported = source === 'googlescholar';
    const qs = quartileSummary(pubs, await loadQuartileMap(pubs));
    const lastSuccess = Object.values(f.sync || {}).map((s) => s.lastSuccessAt).filter(Boolean).sort().at(-1) || null;
    rows.push({
      id: f._id, name: f.name, designation: f.designation, email: f.email, department: f.department, active: f.active,
      profileVerification: f.profileVerification,
      totalPapers: pubs.length,
      scopusPapers: pubs.filter((p) => p.indexing?.scopus?.status === 'indexed').length,
      webOfSciencePapers: wosCount(pubs), // N/A until checked
      citations: reported ? gs?.totalCitations?.all ?? null : counts.length ? counts.reduce((a, b) => a + b, 0) : null,
      citationSource: SOURCE_LABEL[source],
      indicesReported: reported, // true: h/i10 are Google Scholar's own figures, otherwise portal-calculated
      scholarVerification: f.profiles?.googlescholar?.verification || null,
      hIndex: reported ? gs?.hIndex?.all ?? null : counts.length ? hIndex(counts) : null,
      i10Index: reported ? gs?.i10Index?.all ?? null : counts.length ? i10(counts) : null,
      q1: qs.Q1, q2: qs.Q2, q3: qs.Q3, q4: qs.Q4,
      lastSynchronized: lastSuccess,
      syncStatus: Object.fromEntries(Object.entries(f.sync || {}).map(([k, v]) => [k, v.status])),
    });
  }
  return rows;
}

export async function departmentMetrics(opts = {}) {
  const faculty = await Faculty.find({ active: true }).select('_id profiles').lean();
  const ids = faculty.map((f) => f._id);
  const pubs = await loadPubs(ids, opts);
  const yc = await openalexYearCountsFor(ids, pubs.map((p) => p._id));
  return { metrics: computeMetrics(pubs, { openalexYearCounts: yc, quartileMap: await loadQuartileMap(pubs) }), facultyCount: faculty.length, uniquePublications: pubs.length };
}

export const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
