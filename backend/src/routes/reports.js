import { Router } from 'express';
import * as XLSX from 'xlsx';
import { Faculty } from '../models/index.js';
import { requireRole, READ_ALL, audit, asyncH } from '../middleware/auth.js';
import { loadPubs, SOURCE_LABEL } from '../services/metrics.js';
import { facultyRows } from '../services/summaries.js';
import { sortPubs, toTxt, toBibtex, toDocx } from '../services/ieee.js';
import { buildTablePdf, buildIeeePdf } from '../services/pdfReport.js';

const r = Router();
// All signed-in roles may reach reports; each handler restricts faculty to their own data.

const TYPES = {
  faculty: 'Individual faculty publications',
  department: 'Department faculty summary',
  comparison: 'Faculty comparison',
  scopus: 'Scopus-indexed publications',
  wos: 'Web of Science-indexed publications',
  citations: 'Citation report (per provider)',
  annual: 'Annual (calendar-year) publication report',
};
r.get('/types', (req, res) => res.json({ types: TYPES }));

const pubRow = (p, facultyNames) => ({
  Title: p.title, Authors: (p.authors || []).map((a) => a.name).join('; ') || 'N/A', Faculty: facultyNames, Year: p.year ?? 'N/A',
  Venue: p.venue || 'N/A', 'Venue type': p.venueType, Publisher: p.publisher || 'N/A', DOI: p.doi || 'N/A', 'Scopus EID': p.eid || 'N/A',
  'Scopus status': p.indexing?.scopus?.status, 'Open access': p.openAccess,
  'Citations (Scopus)': p.citations?.scopus?.count ?? 'N/A', 'Citations (OpenAlex)': p.citations?.openalex?.count ?? 'N/A',
  'Citations (Semantic Scholar)': p.citations?.semanticscholar?.count ?? 'N/A', 'Citations (Crossref)': p.citations?.crossref?.count ?? 'N/A',
  'Citations (Google Scholar)': p.citations?.googlescholar?.count ?? 'N/A', 'Citations (Web of Science)': p.citations?.webofscience?.count ?? 'N/A', 'Web of Science status': p.indexing?.webOfScience?.status,
  Sources: (p.providers || []).join(', '),
});

// IEEE-style publication list. HOD/admin/viewer: any faculty or the whole department. Faculty: own list only.
r.get('/ieee', asyncH(async (req, res) => {
  const { format = 'docx', facultyId, scopusOnly, venueType, sort = 'year' } = req.query;
  if (!['docx', 'txt', 'bib', 'pdf'].includes(format)) return res.status(400).json({ error: 'Format must be pdf, docx, txt or bib' });
  const privileged = ['super_admin', 'hod', 'viewer'].includes(req.user.role);
  if (!privileged && String(facultyId || req.user.faculty) !== String(req.user.faculty)) return res.status(403).json({ error: 'You can only export your own publication list' });
  const opts = { yearFrom: req.query.yearFrom ? Number(req.query.yearFrom) : undefined, yearTo: req.query.yearTo ? Number(req.query.yearTo) : undefined };
  const ids = facultyId || !privileged ? [facultyId || req.user.faculty] : (await Faculty.find({ active: true }).select('_id')).map((f) => f._id);
  const scope = ids.length === 1 && (facultyId || !privileged) ? (await Faculty.findById(ids[0]).select('name').lean())?.name || 'Faculty' : 'All active faculty';
  let pubs = await loadPubs(ids, opts);
  if (scopusOnly === 'true') pubs = pubs.filter((p) => p.indexing?.scopus?.status === 'indexed');
  if (['journal', 'conference', 'book'].includes(venueType)) pubs = pubs.filter((p) => p.venueType === venueType);
  pubs = sortPubs(pubs, sort);
  const header = [
    `Scope: ${scope}`, `Generated: ${new Date().toISOString().slice(0, 10)} (KLE Technological University Research Portal)`,
    `Filters: ${[opts.yearFrom || opts.yearTo ? `calendar years ${opts.yearFrom ?? 'start'}-${opts.yearTo ?? 'present'}` : 'all years', scopusOnly === 'true' ? 'Scopus-indexed only' : null, ['journal', 'conference', 'book'].includes(venueType) ? `${venueType} papers` : null].filter(Boolean).join('; ')}`,
    `${pubs.length} unique publications, ordered by ${sort === 'author' ? 'first author' : 'year (newest first)'}. Sources: Scopus, OpenAlex, ORCID, Crossref, Semantic Scholar, Google Scholar. Fields not held by any source are omitted. "et al." marks author lists that are incomplete or longer than six.`,
  ];
  const stamp = new Date().toISOString().slice(0, 10), base = `publications-ieee-${stamp}`;
  await audit(req, 'report_ieee', scope, { format, count: pubs.length });
  if (format === 'pdf') return res.setHeader('Content-Type', 'application/pdf').setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`).send(await buildIeeePdf({ title: `Publications: ${scope}`, info: header, pubs }));
  if (format === 'txt') return res.setHeader('Content-Type', 'text/plain; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="${base}.txt"`).send('﻿' + toTxt(pubs, header));
  if (format === 'bib') return res.setHeader('Content-Type', 'application/x-bibtex; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="${base}.bib"`).send(toBibtex(pubs));
  const buf = await toDocx(pubs, header, `Publications: ${scope}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').setHeader('Content-Disposition', `attachment; filename="${base}.docx"`).send(buf);
}));

r.get('/export', asyncH(async (req, res) => {
  const { type = 'department', format = 'xlsx', facultyId } = req.query;
  if (!TYPES[type]) return res.status(400).json({ error: 'Unknown report type' });
  if (!['xlsx', 'csv', 'pdf'].includes(format)) return res.status(400).json({ error: 'Format must be xlsx, csv or pdf' });
  const own = !['super_admin', 'hod', 'viewer'].includes(req.user.role);
  if (own && (type !== 'faculty' || String(facultyId || req.user.faculty) !== String(req.user.faculty))) return res.status(403).json({ error: 'You can only export your own report' });
  const opts = { yearFrom: req.query.yearFrom ? Number(req.query.yearFrom) : undefined, yearTo: req.query.yearTo ? Number(req.query.yearTo) : undefined };
  const source = SOURCE_LABEL[req.query.source] ? req.query.source : 'scopus';

  let rows;
  let scope = 'All active faculty';
  if (['faculty', 'scopus', 'wos', 'citations', 'annual'].includes(type)) {
    const ids = facultyId || own ? [facultyId || req.user.faculty] : (await Faculty.find({ active: true }).select('_id')).map((f) => f._id);
    if (facultyId || own) scope = (await Faculty.findById(ids[0]).select('name').lean())?.name || scope;
    const names = new Map((await Faculty.find({ _id: { $in: ids } }).select('name').lean()).map((f) => [String(f._id), f.name]));
    let pubs = await loadPubs(ids, opts);
    if (type === 'scopus') pubs = pubs.filter((p) => p.indexing?.scopus?.status === 'indexed');
    if (type === 'wos') pubs = pubs.filter((p) => p.indexing?.webOfScience?.status === 'indexed');
    pubs.sort((a, b) => (b.year || 0) - (a.year || 0));
    rows = pubs.map((p) => pubRow(p, p._links.map((l) => names.get(String(l.faculty))).filter(Boolean).join('; ')));
  } else {
    rows = (await facultyRows(source, opts)).map((x) => ({
      Faculty: x.name, Designation: x.designation, 'Total papers': x.totalPapers, 'Scopus papers': x.scopusPapers, 'Web of Science papers': x.webOfSciencePapers ?? 'N/A',
      [`Citations (${x.citationSource})`]: x.citations ?? 'N/A', 'h-index (portal-calculated)': x.hIndex ?? 'N/A', 'i10-index (portal-calculated)': x.i10Index ?? 'N/A',
      'Q1 papers': x.q1 ?? 'N/A', 'Q2 papers': x.q2 ?? 'N/A', 'Q3 papers': x.q3 ?? 'N/A', 'Q4 papers': x.q4 ?? 'N/A', 'Last synchronized': x.lastSynchronized ? new Date(x.lastSynchronized).toISOString().slice(0, 10) : 'N/A',
    }));
  }

  const info = [
    ['Report', TYPES[type]], ['Scope', scope], ['Generated', new Date().toISOString()],
    ['Year filter', opts.yearFrom || opts.yearTo ? `Calendar years ${opts.yearFrom ?? 'start'} to ${opts.yearTo ?? 'present'} (not academic years)` : 'All years'],
    ['Data sources', 'Scopus (STANDARD view), OpenAlex, ORCID, Crossref, Semantic Scholar, Google Scholar, Web of Science (where loaded), SCImago Journal Rank (quartiles); stored in the KLE Research Portal database'],
    ['Notes', 'Citation counts are per provider and are never summed across providers. N/A means not available, not zero. h-index/i10 are portal-calculated from stored citation counts unless the source is Google Scholar (reported). Web of Science counts are N/A until papers are checked or imported. Quartiles are SCImago best quartiles for journal papers only.'],
  ];
  if (format === 'pdf') {
    const stamp = new Date().toISOString().slice(0, 10);
    const sources = { Faculty: 12 };
    const PUB_COLS = {
      citations: [['Title', 30], ['Faculty', 12], ['Year', 5], ['Citations (Scopus)', 7], ['Citations (OpenAlex)', 7], ['Citations (Semantic Scholar)', 8], ['Citations (Crossref)', 7], ['Citations (Google Scholar)', 8], ['Citations (Web of Science)', 8]],
      pubs: [['Title', 30], ['Faculty', 12], ['Year', 5], ['Venue', 17], ['DOI', 15], ['Scopus status', 8], ['Citations (Scopus)', 7], ['Citations (OpenAlex)', 7]],
    };
    const isPub = rows[0] && 'Title' in rows[0];
    const spec = isPub ? (type === 'citations' ? PUB_COLS.citations : PUB_COLS.pubs) : Object.keys(rows[0] || {}).map((k) => [k, k === 'Faculty' ? 16 : k === 'Designation' ? 12 : k === 'Last synchronized' ? 11 : 7]);
    const numbered = rows.map((r, i) => ({ '#': i + 1, ...r }));
    const columns = [{ key: '#', label: '#', w: 3, align: 'right' }, ...spec.map(([k, w]) => ({ key: k, label: k.replace(/^Citations \((.*)\)$/, 'Cited by $1').replace('(portal-calculated)', '(calc.)'), w, align: /^(Total|Scopus papers|Web of|Citations|Cited|h-index|i10|Q\d|Year$)/.test(k) ? 'right' : 'left' }))];
    const pdf = await buildTablePdf({ title: TYPES[type], info: info.filter(([k]) => k !== 'Notes').map(([k, v]) => `${k}: ${v}`), columns, rows: numbered, note: info.find(([k]) => k === 'Notes')[1], orientation: 'landscape' });
    await audit(req, 'report_export', type, { format, rows: rows.length });
    return res.setHeader('Content-Type', 'application/pdf').setHeader('Content-Disposition', `attachment; filename="${type}-report-${stamp}.pdf"`).send(pdf);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Report info');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No records for this selection' }]), 'Data');
  const stamp = new Date().toISOString().slice(0, 10);
  await audit(req, 'report_export', type, { format, rows: rows.length });

  if (format === 'csv') {
    const csv = info.map((i) => i.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n\n' + XLSX.utils.sheet_to_csv(wb.Sheets.Data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="${type}-report-${stamp}.csv"`).send('﻿' + csv);
  } else {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setHeader('Content-Disposition', `attachment; filename="${type}-report-${stamp}.xlsx"`).send(buf);
  }
}));

export default r;
