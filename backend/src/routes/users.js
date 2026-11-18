// User management for HOD / super admin. Passwords are bcrypt-hashed; a generated password is returned ONCE in the response.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { User, Faculty } from '../models/index.js';
import { audit, asyncH } from '../middleware/auth.js';
import { isId } from '../services/publicationQuery.js';

const r = Router();
const ROLES = ['super_admin', 'hod', 'faculty', 'viewer'];
const isAdminRole = (role) => role === 'hod' || role === 'super_admin';
const genPassword = () => crypto.randomBytes(9).toString('base64url');
const pub = (u, f) => ({ id: u._id, email: u.email, name: u.name, role: u.role, active: u.active, faculty: u.faculty || null, facultyName: f?.name || null, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt });

// Only a super admin may create, change or remove super admin accounts
const canTouch = (actor, targetRole) => actor.role === 'super_admin' || targetRole !== 'super_admin';
const activeAdmins = (excludeId) => User.countDocuments({ active: true, role: { $in: ['hod', 'super_admin'] }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });

const createSchema = z.object({
  email: z.string().email(), name: z.string().min(2).max(120), role: z.enum(ROLES),
  facultyId: z.string().optional(), password: z.string().min(8).max(100).optional(),
});

r.get('/', asyncH(async (req, res) => {
  const users = await User.find().sort({ role: 1, name: 1 }).lean();
  const fac = new Map((await Faculty.find({ _id: { $in: users.map((u) => u.faculty).filter(Boolean) } }).select('name').lean()).map((f) => [String(f._id), f]));
  res.json({ items: users.map((u) => pub(u, fac.get(String(u.faculty)))), roles: ROLES });
}));

r.post('/', asyncH(async (req, res) => {
  const b = createSchema.parse(req.body);
  if (!canTouch(req.user, b.role)) return res.status(403).json({ error: 'Only a super admin can create super admin accounts' });
  if (b.role === 'faculty') {
    if (!b.facultyId || !isId(b.facultyId) || !(await Faculty.exists({ _id: b.facultyId }))) return res.status(400).json({ error: 'A faculty account must be linked to a faculty member' });
  }
  if (await User.exists({ email: b.email.toLowerCase() })) return res.status(409).json({ error: 'A user with this email already exists' });
  const password = b.password || genPassword();
  const u = await User.create({ email: b.email.toLowerCase(), name: b.name, role: b.role, faculty: b.role === 'faculty' ? b.facultyId : undefined, passwordHash: await bcrypt.hash(password, 10) });
  await audit(req, 'user_create', String(u._id), { email: u.email, role: u.role });
  res.status(201).json({ user: pub(u), generatedPassword: b.password ? undefined : password });
}));

r.put('/:id', asyncH(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const u = await User.findById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const b = z.object({ name: z.string().min(2).max(120), role: z.enum(ROLES), active: z.boolean(), facultyId: z.string().nullable() }).partial().parse(req.body);
  if (!canTouch(req.user, u.role) || (b.role && !canTouch(req.user, b.role))) return res.status(403).json({ error: 'Only a super admin can change super admin accounts' });
  const self = String(u._id) === String(req.user._id);
  const losesAdmin = isAdminRole(u.role) && u.active && ((b.active === false) || (b.role && !isAdminRole(b.role)));
  if (self && (b.active === false || (b.role && b.role !== u.role))) return res.status(400).json({ error: 'You cannot deactivate or change the role of your own account' });
  if (losesAdmin && (await activeAdmins(u._id)) === 0) return res.status(400).json({ error: 'This is the last active admin account. Create another admin first.' });
  if (b.name !== undefined) u.name = b.name;
  if (b.role !== undefined) u.role = b.role;
  if (b.active !== undefined) u.active = b.active;
  if (b.facultyId !== undefined) u.faculty = b.facultyId && isId(b.facultyId) ? b.facultyId : undefined;
  if (u.role === 'faculty' && !u.faculty) return res.status(400).json({ error: 'A faculty account must be linked to a faculty member' });
  await u.save();
  await audit(req, 'user_update', String(u._id), b);
  res.json({ user: pub(u) });
}));

r.post('/:id/reset-password', asyncH(async (req, res) => {
  const u = isId(req.params.id) ? await User.findById(req.params.id) : null;
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!canTouch(req.user, u.role)) return res.status(403).json({ error: 'Only a super admin can reset a super admin password' });
  const given = z.object({ password: z.string().min(8).max(100).optional() }).parse(req.body || {}).password;
  const password = given || genPassword();
  u.passwordHash = await bcrypt.hash(password, 10);
  await u.save();
  await audit(req, 'user_reset_password', String(u._id), { email: u.email });
  res.json({ ok: true, generatedPassword: given ? undefined : password });
}));

r.delete('/:id', asyncH(async (req, res) => {
  const u = isId(req.params.id) ? await User.findById(req.params.id) : null;
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (String(u._id) === String(req.user._id)) return res.status(400).json({ error: 'You cannot delete your own account' });
  if (!canTouch(req.user, u.role)) return res.status(403).json({ error: 'Only a super admin can delete super admin accounts' });
  if (isAdminRole(u.role) && u.active && (await activeAdmins(u._id)) === 0) return res.status(400).json({ error: 'This is the last active admin account' });
  await u.deleteOne();
  await audit(req, 'user_delete', String(u._id), { email: u.email });
  res.json({ ok: true });
}));

export default r;
