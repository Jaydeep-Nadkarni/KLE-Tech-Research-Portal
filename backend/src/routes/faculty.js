import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { Faculty, ResearcherIdentifier, VerificationTask } from '../models/index.js';
import { requireRole, ADMIN, READ_ALL, canViewFaculty, audit, asyncH } from '../middleware/auth.js';
import { importFacultyRecords, validateIdentifiers } from '../services/identifierValidation.js';
import { facultyRows } from '../services/summaries.js';
import { normOrcid } from '../utils/normalize.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const recordSchema = z.object({
  name: z.string().min(2), designation: z.string().optional(), email: z.string().email(),
  scholar: z.string().optional(), orcid: z.string().optional(), scopus: z.string().optional(),
});

const num = (v) => (v ? Number(v) : undefined);
const optsFrom = (q) => ({ yearFrom: num(q.yearFrom), yearTo: num(q.yearTo) });

r.get('/', asyncH(async (req, res) => {
  const source = req.query.source || 'scopus';
  const filter = READ_ALL.includes(req.user.role) ? (req.query.includeInactive === 'true' ? {} : { active: true }) : { _id: req.user.faculty };
  res.json({ items: await facultyRows(source, optsFrom(req.query), filter) });
}));

r.post('/', requireRole(...ADMIN), asyncH(async (req, res) => {
  const parsed = recordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid faculty data', details: parsed.error.flatten().fieldErrors });
  const [f] = await importFacultyRecords([parsed.data]);
  const validation = await validateIdentifiers();
  await audit(req, 'faculty_create', String(f._id), { name: f.name });
  res.status(201).json({ faculty: f, validation });
}));

const HEADERS = { name: 'name', 'full name': 'name', designation: 'designation', email: 'email', 'official email': 'email', 'google scholar id': 'scholar', scholar: 'scholar', 'scholar id': 'scholar', orcid: 'orcid', 'scopus author id': 'scopus', scopus: 'scopus', 'scopus id': 'scopus' };
r.post('/import', requireRole(...ADMIN), upload.single('file'), asyncH(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a .csv or .xlsx file in the "file" field' });
  let rows;
  try {
    if (/\.csv$/i.test(req.file.originalname)) rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    else {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    }
  } catch (e) { return res.status(400).json({ error: `Could not read file: ${e.message}` }); }
  const valid = [], errors = [];
  rows.forEach((row, i) => {
    const rec = {};
    for (const [k, v] of Object.entries(row)) { const key = HEADERS[k.toLowerCase().trim()]; if (key && String(v).trim()) rec[key] = String(v).trim(); }
    const p = recordSchema.safeParse(rec);
    p.success ? valid.push(p.data) : errors.push({ row: i + 2, problems: Object.keys(p.error.flatten().fieldErrors) });
  });
  const imported = valid.length ? await importFacultyRecords(valid) : [];
  const validation = await validateIdentifiers();
  await audit(req, 'faculty_import', req.file.originalname, { imported: imported.length, rejectedRows: errors.length });
  res.json({ imported: imported.length, rejected: errors, validation });
}));

r.post('/identifiers/:identId/resolve', requireRole(...ADMIN), asyncH(async (req, res) => {
  const { action } = z.object({ action: z.enum(['verify', 'reject']) }).parse(req.body);
  const id = await ResearcherIdentifier.findById(req.params.identId);
  if (!id) return res.status(404).json({ error: 'Identifier not found' });
  if (action === 'reject') {
    id.status = 'rejected'; id.note = `Rejected by ${req.user.email}`;
  } else {
    id.status = 'verified'; id.verifiedAt = new Date(); id.verifiedBy = req.user.email; id.note = undefined; id.conflictWith = [];
    // Verifying an owner separates everyone else who was claiming the same identifier
    await ResearcherIdentifier.updateMany({ type: id.type, value: id.value, _id: { $ne: id._id } }, { $set: { status: 'rejected', note: `Identifier verified for another faculty by ${req.user.email}` } });
    await VerificationTask.updateMany({ dedupeKey: `idconflict:${id.type}:${id.value}` }, { $set: { status: 'resolved', resolution: `verified for ${id.faculty}`, resolvedBy: req.user.email, resolvedAt: new Date() } });
  }
  await id.save();
  await audit(req, `identifier_${action}`, String(id._id), { type: id.type, value: id.value, faculty: String(id.faculty) });
  res.json({ identifier: id });
}));

r.get('/:id', canViewFaculty, asyncH(async (req, res) => {
  const faculty = await Faculty.findById(req.params.id).lean();
  if (!faculty) return res.status(404).json({ error: 'Faculty not found' });
  const identifiers = await ResearcherIdentifier.find({ faculty: faculty._id }).lean();
  res.json({ faculty, identifiers });
}));

r.put('/:id', asyncH(async (req, res) => {
  const isAdmin = ADMIN.includes(req.user.role);
  const isSelf = req.user.faculty && String(req.user.faculty) === req.params.id;
  if (!isAdmin && !isSelf) return res.status(403).json({ error: 'You can only edit your own profile' });
  const adminSchema = z.object({ name: z.string().min(2), designation: z.string(), department: z.string(), email: z.string().email(), active: z.boolean(), scholarProfileUrl: z.string().url().or(z.literal('')) }).partial();
  const data = isAdmin ? adminSchema.parse(req.body) : z.object({ scholarProfileUrl: z.string().url().or(z.literal('')) }).partial().parse(req.body); // faculty: limited fields
  const f = await Faculty.findByIdAndUpdate(req.params.id, { $set: data }, { returnDocument: 'after' });
  if (!f) return res.status(404).json({ error: 'Faculty not found' });
  await audit(req, 'faculty_update', String(f._id), data);
  res.json({ faculty: f });
}));

r.delete('/:id', requireRole(...ADMIN), asyncH(async (req, res) => {
  const f = await Faculty.findByIdAndUpdate(req.params.id, { $set: { active: false } }, { returnDocument: 'after' });
  if (!f) return res.status(404).json({ error: 'Faculty not found' });
  await audit(req, 'faculty_deactivate', String(f._id), { name: f.name });
  res.json({ faculty: f }); // deactivated, not deleted: publication history is preserved
}));

r.post('/:id/identifiers', requireRole(...ADMIN), asyncH(async (req, res) => {
  const { type, value } = z.object({ type: z.enum(['scopus', 'orcid', 'scholar', 'openalex']), value: z.string().min(3) }).parse(req.body);
  if (type === 'openalex' && !/^A\d+$/.test(value.trim())) return res.status(400).json({ error: 'OpenAlex author ids look like A5012345678' });
  const v = type === 'orcid' ? normOrcid(value) || value : value.trim();
  await ResearcherIdentifier.updateMany({ faculty: req.params.id, type, status: { $in: ['unverified', 'conflict'] } }, { $set: { status: 'rejected', note: 'Replaced by administrator' } });
  const id = await ResearcherIdentifier.findOneAndUpdate({ faculty: req.params.id, type, value: v }, { $set: { status: 'unverified', note: undefined, source: 'admin' } }, { upsert: true, returnDocument: 'after' });
  const validation = await validateIdentifiers();
  await audit(req, 'identifier_add', String(id._id), { type, value: v });
  res.status(201).json({ identifier: await ResearcherIdentifier.findById(id._id), validation });
}));

export default r;
