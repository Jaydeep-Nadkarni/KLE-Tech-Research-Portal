import { Router } from 'express';
import { Faculty, ResearcherIdentifier, Publication, FacultyPublication, ProviderRecord, CitationSnapshot, Journal, JournalMetric } from '../models/index.js';
import { READ_ALL, canViewFaculty, asyncH, requireRole } from '../middleware/auth.js';
import { facultyMetrics, loadPubs } from '../services/metrics.js';
import { queryPublications, publicationFacets, isId } from '../services/publicationQuery.js';

import multer from 'multer';
import { z } from 'zod';
import { ADMIN, audit } from '../middleware/auth.js';
import { ResearcherMetricSnapshot } from '../models/index.js';
import { buildCoauthors, CLASS_LABEL } from '../services/coauthors.js';
import { saveManualProfile, approveManualProfile, importScholarWorks, parseScholarFile } from '../services/scholar.js';
import { configured as scholarApiConfigured } from '../providers/googleScholar.js';

export const researchers = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const isAdminUser = (u) => ADMIN.includes(u.role);
const isSelf = (req) => req.user.faculty && String(req.user.faculty) === req.params.id;

const nn = z.number().int().min(0).max(10_000_000);
const profileSchema = z.object({
  totalCitations: nn, totalCitationsSince: nn.optional(), hIndex: nn.max(1000), hIndexSince: nn.max(1000).optional(),
  i10Index: nn, i10IndexSince: nn.optional(), sinceYear: z.number().int().min(1990).max(2100).optional(),
  affiliation: z.string().max(300).optional(), interests: z.array(z.string().max(80)).max(20).optional(),
  citationsByYear: z.array(z.object({ year: z.number().int().min(1990).max(2100), citations: nn })).max(40).optional(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((v) => v.hIndex <= v.totalCitations || v.totalCitations === 0, { message: 'h-index cannot exceed total citations' });

researchers.get('/:id/scholar', canViewFaculty, asyncH(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const f = await Faculty.findById(req.params.id).lean();
  if (!f) return res.status(404).json({ error: 'Faculty not found' });
  const profile = f.profiles?.googlescholar || null;
  const pubs = await queryPublications({ limit: 100, sort: 'citations', citeSource: 'googlescholar' }, { facultyIds: [req.params.id] });
  const listed = pubs.items.filter((p) => p.indexing?.googleScholar?.status === 'listed');
  const history = await ResearcherMetricSnapshot.find({ faculty: req.params.id, provider: 'googlescholar' }).sort({ retrievedAt: -1 }).limit(20).select('mode retrievedAt recordedBy metrics.totalCitations metrics.hIndex metrics.i10Index').lean();
  res.json({
    profileUrl: f.scholarProfileUrl, apiConfigured: scholarApiConfigured(), profile,
    status: !profile ? 'unavailable' : profile.mode === 'api' ? 'api' : profile.verification === 'verified' ? 'manual_verified' : 'manual_pending',
    publications: listed, publicationsListed: listed.length, history,
  });
}));

researchers.post('/:id/scholar/profile', asyncH(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  if (!isAdminUser(req.user) && !isSelf(req)) return res.status(403).json({ error: 'You can only submit your own Scholar figures' });
  const f = await Faculty.findById(req.params.id);
  if (!f) return res.status(404).json({ error: 'Faculty not found' });
  const input = profileSchema.parse(req.body);
  const profile = await saveManualProfile(f, input, req.user, isAdminUser(req.user));
  await audit(req, 'scholar_profile_manual', String(f._id), { verified: profile.verification });
  res.status(201).json({ profile });
}));

researchers.post('/:id/scholar/approve', requireRole(...ADMIN), asyncH(async (req, res) => {
  const f = isId(req.params.id) ? await Faculty.findById(req.params.id) : null;
  const p = f && (await approveManualProfile(f, req.user));
  if (!p) return res.status(404).json({ error: 'No manually entered Scholar profile to approve' });
  await audit(req, 'scholar_profile_approve', String(f._id), {});
  res.json({ profile: p });
}));

researchers.post('/:id/scholar/import', requireRole(...ADMIN), upload.single('file'), asyncH(async (req, res) => {
  const f = isId(req.params.id) ? await Faculty.findById(req.params.id) : null;
  if (!f) return res.status(404).json({ error: 'Faculty not found' });
  if (!req.file) return res.status(400).json({ error: 'Attach a Scholar export (.csv or .bib) in the "file" field' });
  let works;
  try { works = parseScholarFile(req.file.originalname, req.file.buffer.toString('utf8')); } catch (e) { return res.status(400).json({ error: `Could not read file: ${e.message}` }); }
  if (!works.length) return res.status(400).json({ error: 'No publications found. Expect a Google Scholar CSV (Authors, Title, Publication, Year...) or BibTeX export.' });
  const result = await importScholarWorks(f, works);
  await audit(req, 'scholar_import', String(f._id), { file: req.file.originalname, ...result });
  res.json(result);
}));
export const publications = Router();
const num = (v) => (v ? Number(v) : undefined);
const optsFrom = (q) => ({ yearFrom: num(q.yearFrom), yearTo: num(q.yearTo) });

researchers.get('/:id/profile', canViewFaculty, asyncH(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const faculty = await Faculty.findById(req.params.id).lean();
  if (!faculty) return res.status(404).json({ error: 'Faculty not found' });
  const identifiers = await ResearcherIdentifier.find({ faculty: faculty._id }).lean();
  res.json({ faculty, identifiers });
}));

researchers.get('/:id/publications', canViewFaculty, asyncH(async (req, res) => {
  res.json(await queryPublications(req.query, { facultyIds: [req.params.id] }));
}));
researchers.get('/:id/publications/facets', canViewFaculty, asyncH(async (req, res) => res.json(await publicationFacets([req.params.id]))));

researchers.get('/:id/metrics', canViewFaculty, asyncH(async (req, res) => {
  res.json({ asOf: new Date(), calendarYearFilter: optsFrom(req.query), metrics: await facultyMetrics(req.params.id, optsFrom(req.query)) });
}));

researchers.get('/:id/citations', canViewFaculty, asyncH(async (req, res) => {
  const m = await facultyMetrics(req.params.id, optsFrom(req.query));
  res.json({ citations: m.citations, citationsByYear: m.citationsByYear, source: m.citationsByYearSource, providerReported: m.providerReported });
}));

researchers.get('/:id/coauthors', canViewFaculty, asyncH(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { items, summary, totals } = await buildCoauthors({ facultyId: req.params.id });
  const limit = Math.min(200, Number(req.query.limit) || 30);
  res.json({ total: items.length, items: items.slice(0, limit), summary, totals, labels: CLASS_LABEL, note: 'Classes describe the affiliation recorded on the paper (OpenAlex). Students cannot be detected automatically; an administrator can tag them on the Co-authors page.' });
}));

researchers.get('/:id/collaborations', canViewFaculty, asyncH(async (req, res) => {
  const f = await Faculty.findById(req.params.id).lean();
  const pubs = await loadPubs([req.params.id]);
  const self = f.name.toLowerCase().split(/\s+/).at(-1);
  const co = new Map();
  for (const p of pubs) for (const a of p.authors || []) {
    if (!a.name || a.name.toLowerCase().includes(self)) continue;
    co.set(a.name, (co.get(a.name) || 0) + 1);
  }
  const m = await facultyMetrics(req.params.id, {});
  res.json({
    coAuthors: [...co].map(([name, papers]) => ({ name, papers })).sort((a, b) => b.papers - a.papers).slice(0, 25),
    coAuthorsNote: 'Co-author names come from OpenAlex/Crossref author lists; Scopus lists only the first author at this access level.',
    international: m.internationalCollaboration,
  });
}));

publications.get('/', asyncH(async (req, res) => {
  const scope = READ_ALL.includes(req.user.role) ? undefined : [String(req.user.faculty)];
  res.json(await queryPublications(req.query, { facultyIds: scope && req.query.facultyId ? scope : scope }));
}));
publications.get('/facets', asyncH(async (req, res) => res.json(await publicationFacets(READ_ALL.includes(req.user.role) ? null : [req.user.faculty]))));

async function loadDetail(req, res) {
  if (!isId(req.params.id)) { res.status(404).json({ error: 'Not found' }); return null; }
  const pub = await Publication.findById(req.params.id).lean();
  if (!pub) { res.status(404).json({ error: 'Publication not found' }); return null; }
  const links = await FacultyPublication.find({ publication: pub._id }).populate('faculty', 'name designation').lean();
  if (!READ_ALL.includes(req.user.role) && !links.some((l) => String(l.faculty?._id) === String(req.user.faculty))) {
    res.status(403).json({ error: 'You can only view your own publications' }); return null;
  }
  return { pub, links };
}

async function journalRanking(pub) {
  if (pub.venueType === 'conference') return { applicable: false, note: 'Journal quartiles and rankings do not apply to conference papers.' };
  if (pub.venueType !== 'journal') return { applicable: false, note: 'Journal metrics apply to journal articles only.' };
  const j = pub.journal ? await Journal.findById(pub.journal).lean() : null;
  if (!j) return { applicable: true, available: false, note: 'Journal not yet matched (no ISSN, or journal metrics not synchronized).' };
  const metrics = await JournalMetric.find({ journal: j._id }).sort({ reportingYear: -1 }).lean();
  return {
    applicable: true, available: metrics.length > 0,
    journal: { id: j._id, title: j.title, publisher: j.publisher, issn: j.issn, scopusStatus: j.scopusStatus, coverage: j.scopusCoverage, subjectAreas: (j.subjectAreas || []).map((a) => a.name), scopusUrl: j.scopusUrl, lastFetchedAt: j.lastFetchedAt },
    metrics: metrics.map((m) => ({ metric: m.metric, value: m.value, year: m.reportingYear, category: m.subjectCategory || null, source: m.source, retrievedAt: m.retrievedAt })),
    publicationYearCoveredByScopus: j.scopusCoverage?.start && pub.year ? pub.year >= j.scopusCoverage.start && pub.year <= (j.scopusCoverage.end || 9999) : null,
    note: j.scopusStatus === 'not_found' ? 'Scopus returned no source record for this journal\'s ISSN; this is not proof the journal is outside Scopus.' : undefined,
  };
}

publications.get('/:id', asyncH(async (req, res) => {
  const d = await loadDetail(req, res); if (!d) return;
  const records = await ProviderRecord.find({ publication: d.pub._id }).select('provider externalId fetchedAt normalized.url normalized.citations faculty').lean();
  const snapshots = await CitationSnapshot.find({ publication: d.pub._id }).sort({ retrievedAt: 1 }).lean();
  res.json({
    publication: d.pub,
    faculty: d.links.map((l) => ({ id: l.faculty?._id, name: l.faculty?.name, designation: l.faculty?.designation, authorPosition: l.authorPosition, matchConfidence: l.matchConfidence, matchedBy: l.matchedBy, verificationStatus: l.verificationStatus })),
    sources: records.map((r) => ({ provider: r.provider, externalId: r.externalId, fetchedAt: r.fetchedAt, url: r.normalized?.url })),
    citationHistory: snapshots.map((s) => ({ provider: s.provider, count: s.count, influential: s.influential, retrievedAt: s.retrievedAt })),
    journalRanking: await journalRanking(d.pub),
  });
}));
publications.get('/:id/indexing', asyncH(async (req, res) => { const d = await loadDetail(req, res); if (d) res.json({ indexing: d.pub.indexing, venueType: d.pub.venueType }); }));
publications.get('/:id/metrics', asyncH(async (req, res) => { const d = await loadDetail(req, res); if (d) res.json({ citations: d.pub.citations, journalRanking: await journalRanking(d.pub) }); }));
