// Import of a Web of Science export (Excel, or tab-delimited "Plain text file"). Matching only: each row is
// matched to a paper the portal already holds (DOI, then identical title +/-1 year). A WoS export holds many
// authors, so unmatched rows are reported, never auto-created. A row in a WoS export is itself evidence of indexing.
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import { FacultyPublication, Faculty } from '../models/index.js';
import { normDoi, normIssn, uniq } from '../utils/normalize.js';
import { matchExisting, upsertWork } from './ingest.js';

// Column names differ between the Excel export (long names) and the tab-delimited export (two-letter field tags).
const COLS = {
  title: ['article title', 'ti', 'title'], authors: ['authors', 'au', 'author full names', 'af'], venue: ['source title', 'so'],
  year: ['publication year', 'py'], doi: ['doi', 'di'], ut: ['ut (unique wos id)', 'ut', 'accession number', 'unique wos id'],
  cites: ['times cited, wos core', 'tc', 'times cited, all databases', 'z9', 'times cited'], issn: ['issn', 'sn'], eissn: ['eissn', 'ei', 'e-issn'],
  volume: ['volume', 'vl'], issue: ['issue', 'is'], start: ['start page', 'bp'], end: ['end page', 'ep'], type: ['document type', 'dt'],
  publisher: ['publisher', 'pu'], keywords: ['author keywords', 'de'], abstract: ['abstract', 'ab'],
};

export function readRows(name, buffer) {
  let rows;
  if (/\.(xlsx|xls)$/i.test(name)) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } else {
    rows = parse(buffer.toString('utf8'), { delimiter: '\t', columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, quote: false, trim: true });
  }
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim().toLowerCase(), v])));
}

const pick = (row, key) => { for (const c of COLS[key]) if (row[c] !== undefined && String(row[c]).trim() !== '') return String(row[c]).trim(); return null; };

export function rowToWork(row) {
  const title = pick(row, 'title');
  if (!title) return null;
  const ut = pick(row, 'ut');
  const cites = pick(row, 'cites');
  const start = pick(row, 'start'), end = pick(row, 'end');
  const type = (pick(row, 'type') || '').toLowerCase();
  return {
    provider: 'webofscience', via: 'manual', externalId: ut || `import:${normDoi(pick(row, 'doi')) || title.slice(0, 40)}`,
    doi: normDoi(pick(row, 'doi')), title, year: Number(pick(row, 'year')) || null, venue: pick(row, 'venue'),
    authors: (pick(row, 'authors') || '').split(/;\s*/).filter(Boolean).map((name) => ({ name })), authorsComplete: true,
    issn: uniq([normIssn(pick(row, 'issn')), normIssn(pick(row, 'eissn'))]), volume: pick(row, 'volume'), issue: pick(row, 'issue'),
    pages: start ? [start, end].filter(Boolean).join('-') : null, publisher: pick(row, 'publisher'),
    venueType: /proceedings/.test(type) ? 'conference' : /article|review/.test(type) ? 'journal' : /book/.test(type) ? 'book' : 'unknown',
    keywords: (pick(row, 'keywords') || '').split(/;\s*/).filter(Boolean),
    citations: cites != null && !Number.isNaN(Number(cites)) ? { count: Number(cites) } : null, raw: row,
  };
}

export async function importWosExport(name, buffer) {
  const rows = readRows(name, buffer);
  const out = { rows: rows.length, matched: 0, alreadyIndexed: 0, unmatched: [], noTitle: 0 };
  for (const row of rows) {
    const w = rowToWork(row);
    if (!w) { out.noTitle++; continue; }
    const pub = await matchExisting(w);
    if (!pub) { out.unmatched.push({ title: w.title, year: w.year, doi: w.doi }); continue; }
    if (pub.indexing?.webOfScience?.status === 'indexed') out.alreadyIndexed++;
    const link = await FacultyPublication.findOne({ publication: pub._id, verificationStatus: { $ne: 'rejected' } });
    const fac = link && (await Faculty.findById(link.faculty));
    if (!fac) { out.unmatched.push({ title: w.title, year: w.year, doi: w.doi, reason: 'paper has no active faculty link' }); continue; }
    await upsertWork(fac, w, { stats: {}, matchedBy: 'wos_import', confidence: link.matchConfidence ?? 0.8 });
    out.matched++;
  }
  out.unmatchedCount = out.unmatched.length;
  out.unmatched = out.unmatched.slice(0, 50);
  return out;
}
