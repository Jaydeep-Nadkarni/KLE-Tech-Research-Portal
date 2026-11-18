import { JournalMetric } from '../models/index.js';

/**
 * Map publicationId -> {quartile, reportingYear, source} for JOURNAL papers only (never conferences).
 * Quartiles come exclusively from imported SCImago data (metric "SJR Best Quartile"); the reporting year
 * closest to the publication year is used, because a journal's quartile changes between years.
 */
export async function loadQuartileMap(pubs) {
  const journalIds = [...new Set(pubs.filter((p) => p.venueType === 'journal' && p.journal).map((p) => String(p.journal)))];
  const map = new Map();
  if (!journalIds.length) return map;
  const rows = await JournalMetric.find({ journal: { $in: journalIds }, metric: 'SJR Best Quartile' }).lean();
  const byJournal = new Map();
  for (const r of rows) byJournal.set(String(r.journal), [...(byJournal.get(String(r.journal)) || []), r]);
  for (const p of pubs) {
    if (p.venueType !== 'journal' || !p.journal) continue;
    const cands = byJournal.get(String(p.journal));
    if (!cands?.length) continue;
    const target = p.year || new Date().getFullYear();
    const best = cands.reduce((a, b) => (Math.abs(b.reportingYear - target) < Math.abs(a.reportingYear - target) ? b : a));
    if (/^Q[1-4]$/.test(best.value)) map.set(String(p._id), { quartile: best.value, reportingYear: best.reportingYear, source: best.source });
  }
  return map;
}

export function quartileSummary(pubs, qmap) {
  const journalPapers = pubs.filter((p) => p.venueType === 'journal');
  if (!qmap.size) {
    return { available: false, note: 'Quartiles need SCImago data, which has not been imported yet (see Journals page). Scopus does not provide quartiles at this API access level.', Q1: null, Q2: null, Q3: null, Q4: null, journalPapersTotal: journalPapers.length };
  }
  const count = (q) => journalPapers.filter((p) => qmap.get(String(p._id))?.quartile === q).length;
  const covered = journalPapers.filter((p) => qmap.has(String(p._id))).length;
  return {
    available: true,
    Q1: count('Q1'), Q2: count('Q2'), Q3: count('Q3'), Q4: count('Q4'),
    journalPapersTotal: journalPapers.length, journalPapersWithQuartile: covered,
    note: `Quartile = SCImago best quartile for the reporting year nearest each paper's publication year. ${covered} of ${journalPapers.length} journal papers have a quartile; conference papers are excluded.`,
  };
}
