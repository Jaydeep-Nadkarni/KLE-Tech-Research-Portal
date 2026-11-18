import { Router } from 'express';
import { Faculty, VerificationTask, SyncLog, SyncJob, AuditLog, ResearcherIdentifier, Journal, JournalMetric, Publication } from '../models/index.js';
import { requireRole, READ_ALL, ADMIN, audit, asyncH } from '../middleware/auth.js';
import { facultyRows, departmentMetrics, median } from '../services/summaries.js';
import { loadPubs, SOURCE_LABEL, wosCoverage } from '../services/metrics.js';
import multer from 'multer';
import { z } from 'zod';
import { PersonTag } from '../models/index.js';
import { buildCoauthors, CLASS_LABEL, TAG_CATEGORIES } from '../services/coauthors.js';
import { importWosExport } from '../services/wosImport.js';
import { configured as wosConfigured } from '../providers/webOfScience.js';

const r = Router();
r.use(requireRole(...READ_ALL));
const num = (v) => (v ? Number(v) : undefined);
const optsFrom = (q) => ({ yearFrom: num(q.yearFrom), yearTo: num(q.yearTo) });
const srcOf = (q) => (SOURCE_LABEL[q.source] ? q.source : 'scopus');

r.get('/overview', asyncH(async (req, res) => {
  const source = srcOf(req.query), opts = optsFrom(req.query);
  const [dept, rows] = await Promise.all([departmentMetrics(opts), facultyRows(source, opts)]);
  const hs = rows.map((x) => x.hIndex).filter((h) => h != null);
  const m = dept.metrics;
  const fac = await Faculty.find({ active: true }).select('profiles').lean();
  const gsWithData = fac.map((x) => x.profiles?.googlescholar).filter((p) => p?.totalCitations?.all != null);
  const gsCard = {
    facultyWithData: gsWithData.length, facultyTotal: fac.length,
    totalCitations: gsWithData.length ? gsWithData.reduce((a, p) => a + p.totalCitations.all, 0) : null,
    unverified: gsWithData.filter((p) => p.verification === 'pending_approval').length,
    note: 'Sum of individual profile totals; a paper shared by several faculty is counted once per profile.',
  };
  // Average citations per faculty = total citations (the same figure shown on the citation card for this source)
  // divided by the number of ALL active faculty, including those with no citations or no data.
  const totalCitations = source === 'googlescholar' ? gsCard.totalCitations : m.citations?.[source]?.total ?? null;
  res.json({
    asOf: new Date(), source: SOURCE_LABEL[source], filter: opts,
    cards: {
      totalFaculty: dept.facultyCount,
      totalPublicationLinks: rows.reduce((a, x) => a + x.totalPapers, 0), // counts shared papers once per faculty
      uniquePublications: dept.uniquePublications,
      scopusPublications: m.scopusPublications,
      webOfSciencePublications: m.webOfSciencePublications, // null (N/A) until papers are checked or imported
      webOfScienceCoverage: m.webOfScienceCoverage,
      citationsBySource: m.citations,
      averageHIndex: hs.length ? +(hs.reduce((a, b) => a + b, 0) / hs.length).toFixed(2) : null,
      medianHIndex: median(hs),
      hIndexNote: source === 'googlescholar' ? 'Reported by Google Scholar profiles (API or manually entered)' : `Portal-calculated per faculty from stored ${SOURCE_LABEL[source]} citation counts`,
      googleScholar: gsCard,
      averageCitationsPerFaculty: totalCitations != null && dept.facultyCount ? +(totalCitations / dept.facultyCount).toFixed(1) : null,
      averageCitationsBasis: { totalCitations, faculty: dept.facultyCount, source: SOURCE_LABEL[source] },
      quartiles: m.quartiles,
      publicationsThisYear: m.thisYear,
    },
  });
}));

r.get('/analytics', asyncH(async (req, res) => {
  const source = srcOf(req.query), opts = optsFrom(req.query);
  const [dept, rows] = await Promise.all([departmentMetrics(opts), facultyRows(source, opts)]);
  const m = dept.metrics;
  res.json({
    source: SOURCE_LABEL[source],
    pubsByYear: m.pubsByYear, citationsByYear: m.citationsByYear, citationsByYearSource: m.citationsByYearSource,
    facultyPublications: rows.map((x) => ({ name: x.name, papers: x.totalPapers, scopus: x.scopusPapers })).sort((a, b) => b.papers - a.papers),
    facultyCitations: rows.map((x) => ({ name: x.name, citations: x.citations })).sort((a, b) => (b.citations ?? -1) - (a.citations ?? -1)),
    facultyHIndex: rows.map((x) => ({ name: x.name, hIndex: x.hIndex })).sort((a, b) => (b.hIndex ?? -1) - (a.hIndex ?? -1)),
    indexingDistribution: m.indexingDistribution, quartiles: m.quartiles,
    publicationTypes: m.publicationTypes, publishers: m.publishers, researchAreas: m.researchAreas,
    internationalCollaboration: m.internationalCollaboration, openAccess: m.openAccess,
    productivity: { facultyCount: dept.facultyCount, uniquePublications: dept.uniquePublications, papersPerFaculty: dept.facultyCount ? +(dept.uniquePublications / dept.facultyCount).toFixed(1) : null },
  });
}));

r.get('/faculty-comparison', asyncH(async (req, res) => {
  const source = srcOf(req.query), opts = optsFrom(req.query);
  let rows = await facultyRows(source, opts);
  if (req.query.designation) rows = rows.filter((x) => x.designation === req.query.designation);
  if (req.query.ids) { const ids = req.query.ids.split(','); rows = rows.filter((x) => ids.includes(String(x.id))); }
  if (req.query.q) rows = rows.filter((x) => x.name.toLowerCase().includes(req.query.q.toLowerCase()));
  const dir = req.query.order === 'asc' ? 1 : -1;
  const key = req.query.sort || 'totalPapers';
  rows.sort((a, b) => ((a[key] ?? -1) > (b[key] ?? -1) ? 1 : (a[key] ?? -1) < (b[key] ?? -1) ? -1 : 0) * (typeof a[key] === 'string' ? -dir : dir));
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Number(req.query.limit) || 25);
  // Per-year series for the faculty on this page of results (used by comparison charts)
  const series = [];
  for (const row of rows.slice((page - 1) * limit, page * limit)) {
    const pubs = await loadPubs([row.id], opts);
    const by = {};
    for (const p of pubs) if (p.year) by[p.year] = (by[p.year] || 0) + 1;
    series.push({ id: row.id, name: row.name, byYear: by });
  }
  res.json({ source: SOURCE_LABEL[source], total: rows.length, page, limit, items: rows.slice((page - 1) * limit, page * limit), series, designations: [...new Set(rows.map((x) => x.designation))] });
}));

r.get('/publication-trends', asyncH(async (req, res) => {
  const opts = optsFrom(req.query);
  const faculty = await Faculty.find({ active: true }).select('name').lean();
  const years = new Set(); const data = {};
  for (const f of faculty) {
    for (const p of await loadPubs([f._id], opts)) if (p.year) { years.add(p.year); (data[p.year] ||= {})[f.name] = (data[p.year][f.name] || 0) + 1; }
  }
  res.json({ faculty: faculty.map((f) => f.name), series: [...years].sort().map((y) => ({ year: y, ...data[y] })) });
}));

const latest = (rows, metric) => rows.filter((x) => x.metric === metric).sort((a, b) => b.reportingYear - a.reportingYear)[0];

r.get('/journal-analytics', asyncH(async (req, res) => {
  const dept = await departmentMetrics(optsFrom(req.query));
  const m = dept.metrics;
  const counts = await Publication.aggregate([{ $match: { journal: { $ne: null } } }, { $group: { _id: '$journal', papers: { $sum: 1 }, scopusPapers: { $sum: { $cond: [{ $eq: ['$indexing.scopus.status', 'indexed'] }, 1, 0] } } } }]);
  const journals = await Journal.find({ _id: { $in: counts.map((c) => c._id) } }).lean();
  const metrics = await JournalMetric.find({ journal: { $in: journals.map((j) => j._id) } }).lean();
  const byJ = new Map(); for (const x of metrics) byJ.set(String(x.journal), [...(byJ.get(String(x.journal)) || []), x]);
  const cmap = new Map(counts.map((c) => [String(c._id), c]));
  const items = journals.map((j) => {
    const ms = byJ.get(String(j._id)) || [];
    const pick = (name) => { const x = latest(ms, name); return x ? { value: x.value, year: x.reportingYear, source: x.source } : null; };
    return {
      id: j._id, title: j.title, publisher: j.publisher, issn: j.issn, scopusStatus: j.scopusStatus, coverage: j.scopusCoverage, scopusUrl: j.scopusUrl,
      subjectAreas: (j.subjectAreas || []).map((a) => a.name), papers: cmap.get(String(j._id))?.papers || 0, scopusPapers: cmap.get(String(j._id))?.scopusPapers || 0,
      citeScore: pick('CiteScore'), sjr: pick('SJR'), snip: pick('SNIP'), quartile: pick('SJR Best Quartile'), hIndex: pick('H index'),
    };
  }).sort((a, b) => b.papers - a.papers);
  const band = (v) => (v < 1 ? 'Below 1' : v < 3 ? '1 to under 3' : v < 5 ? '3 to under 5' : '5 or more');
  const bandCounts = {};
  for (const i of items) if (i.citeScore) bandCounts[band(i.citeScore.value)] = (bandCounts[band(i.citeScore.value)] || 0) + i.papers;
  const order = ['Below 1', '1 to under 3', '3 to under 5', '5 or more'];
  res.json({
    publishers: m.publishers, venues: m.venues, publicationTypes: m.publicationTypes, quartiles: m.quartiles,
    summary: { journals: items.length, foundInScopus: items.filter((i) => i.scopusStatus === 'found').length, notFoundByIssn: items.filter((i) => i.scopusStatus === 'not_found').length, withQuartile: items.filter((i) => i.quartile).length, journalPapersWithoutIssn: await Publication.countDocuments({ venueType: 'journal', $or: [{ issn: { $exists: false } }, { issn: { $size: 0 } }] }) },
    items,
    citeScoreBands: order.filter((o) => bandCounts[o]).map((name) => ({ name, value: bandCounts[name] })),
    metricsAvailability: {
      citeScore: items.some((i) => i.citeScore), sjr: items.some((i) => i.sjr), snip: items.some((i) => i.snip), quartile: items.some((i) => i.quartile), impactFactor: false,
      reason: 'CiteScore, SJR and SNIP come from the Scopus Serial Title API. Quartiles require a SCImago import. Journal Impact Factor and Journal Citation Indicator need a Clarivate licence and are not available.',
    },
  });
}));

r.get('/sync-status', asyncH(async (req, res) => {
  const faculty = await Faculty.find({ active: true }).select('name sync').lean();
  const logs = await SyncLog.find().sort({ finishedAt: -1 }).limit(15).populate('faculty', 'name').lean();
  const running = await SyncJob.findOne({ status: { $in: ['queued', 'running'] } }).lean();
  res.json({
    running,
    faculty: faculty.map((f) => ({ id: f._id, name: f.name, providers: Object.fromEntries(Object.entries(f.sync || {}).map(([k, v]) => [k, v])) })),
    recent: logs.map((l) => ({ id: l._id, faculty: l.faculty?.name, provider: l.provider, status: l.status, fetched: l.fetched, created: l.created, message: l.message, errorKind: l.errorKind, finishedAt: l.finishedAt })),
    openTasks: await VerificationTask.countDocuments({ status: 'open' }),
  });
}));

r.get('/tasks', asyncH(async (req, res) => {
  const status = req.query.status || 'open';
  const tasks = await VerificationTask.find({ status }).sort({ createdAt: -1 }).populate('faculty', 'name').lean();
  const out = [];
  for (const t of tasks) {
    const item = { ...t, faculty: t.faculty.map((f) => ({ id: f._id, name: f.name })) };
    if (t.type === 'identifier_conflict') {
      item.identifiers = await ResearcherIdentifier.find({ type: t.payload.identifierType, value: t.payload.value }).populate('faculty', 'name').lean();
    }
    out.push(item);
  }
  res.json({ items: out });
}));

r.post('/tasks/:id/dismiss', requireRole(...ADMIN), asyncH(async (req, res) => {
  const t = await VerificationTask.findByIdAndUpdate(req.params.id, { $set: { status: 'dismissed', resolvedBy: req.user.email, resolvedAt: new Date(), resolution: req.body?.note || 'Dismissed' } }, { returnDocument: 'after' });
  if (!t) return res.status(404).json({ error: 'Task not found' });
  await audit(req, 'task_dismiss', String(t._id), { type: t.type });
  res.json({ task: t });
}));

const wosUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

r.get('/wos/status', asyncH(async (req, res) => {
  const pubs = await loadPubs((await Faculty.find({ active: true }).select('_id')).map((f) => f._id));
  res.json({ apiConfigured: wosConfigured(), coverage: wosCoverage(pubs), withDoi: pubs.filter((p) => p.doi).length });
}));

r.post('/wos/import', requireRole(...ADMIN), wosUpload.single('file'), asyncH(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a Web of Science export (.xls, .xlsx or tab-delimited .txt) in the "file" field' });
  let result;
  try { result = await importWosExport(req.file.originalname, req.file.buffer); } catch (e) { return res.status(400).json({ error: `Could not read file: ${e.message}` }); }
  if (!result.rows) return res.status(400).json({ error: 'The file has no rows.' });
  if (result.noTitle === result.rows) return res.status(400).json({ error: 'No title column found. Export from Web of Science as Excel or "Plain text file" with Full Record.' });
  await audit(req, 'wos_import', req.file.originalname, { rows: result.rows, matched: result.matched, unmatched: result.unmatchedCount });
  res.json(result);
}));

r.get('/coauthors', asyncH(async (req, res) => {
  const { items, summary, totals } = await buildCoauthors({ facultyId: req.query.facultyId || undefined });
  let rows = items;
  if (req.query.class) rows = rows.filter((i) => i.class === req.query.class);
  if (req.query.q) { const q = req.query.q.toLowerCase(); rows = rows.filter((i) => i.name.toLowerCase().includes(q) || i.institutions.some((n) => n.toLowerCase().includes(q))); }
  if (req.query.minPapers) rows = rows.filter((i) => i.papers >= Number(req.query.minPapers));
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Number(req.query.limit) || 25);
  res.json({ total: rows.length, page, limit, pages: Math.ceil(rows.length / limit), items: rows.slice((page - 1) * limit, page * limit), summary, totals, labels: CLASS_LABEL, tagCategories: TAG_CATEGORIES });
}));

r.post('/coauthors/tag', requireRole(...ADMIN), asyncH(async (req, res) => {
  const body = z.object({ key: z.string().min(3).max(120), name: z.string().max(200).optional(), category: z.enum(TAG_CATEGORIES), note: z.string().max(300).optional() }).parse(req.body);
  if (body.key.startsWith('dept:')) return res.status(400).json({ error: 'Department faculty are identified automatically and cannot be re-tagged' });
  const tag = await PersonTag.findOneAndUpdate({ key: body.key }, { $set: { ...body, setBy: req.user.email } }, { upsert: true, returnDocument: 'after' });
  await audit(req, 'coauthor_tag', body.key, { category: body.category });
  res.json({ tag });
}));

r.delete('/coauthors/tag', requireRole(...ADMIN), asyncH(async (req, res) => {
  const key = String(req.query.key || '');
  const r1 = await PersonTag.deleteOne({ key });
  if (!r1.deletedCount) return res.status(404).json({ error: 'No tag for that person' });
  await audit(req, 'coauthor_untag', key, {});
  res.json({ ok: true });
}));

r.get('/audit', requireRole(...ADMIN), asyncH(async (req, res) => {
  res.json({ items: await AuditLog.find().sort({ at: -1 }).limit(100).lean() });
}));

export default r;
