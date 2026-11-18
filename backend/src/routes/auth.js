import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User, Faculty, AuditLog } from '../models/index.js';
import { authenticate, signToken, asyncH } from '../middleware/auth.js';
import { env } from '../config/env.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, message: { error: 'Too many login attempts. Try again later.' } });
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: env.nodeEnv === 'production', maxAge: 8 * 3600 * 1000 };
const publicUser = (u) => ({ id: u._id, email: u.email, name: u.name, role: u.role, faculty: u.faculty || null });

r.post('/login', limiter, asyncH(async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Email and password are required' });
  const user = await User.findOne({ email: body.data.email.toLowerCase() });
  const ok = user?.active && (await bcrypt.compare(body.data.password, user.passwordHash));
  if (!ok) {
    await AuditLog.create({ userEmail: body.data.email, action: 'login_failed' });
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  user.lastLoginAt = new Date();
  await user.save();
  await AuditLog.create({ user: user._id, userEmail: user.email, action: 'login' });
  res.cookie('token', signToken(user), cookieOpts).json({ user: publicUser(user) });
}));

r.post('/change-password', authenticate, limiter, asyncH(async (req, res) => {
  const b = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(100) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const user = await User.findById(req.user._id);
  if (!(await bcrypt.compare(b.data.currentPassword, user.passwordHash))) return res.status(400).json({ error: 'Current password is incorrect' });
  if (b.data.currentPassword === b.data.newPassword) return res.status(400).json({ error: 'Choose a password different from the current one' });
  user.passwordHash = await bcrypt.hash(b.data.newPassword, 10);
  await user.save();
  await AuditLog.create({ user: user._id, userEmail: user.email, action: 'password_change' });
  res.json({ ok: true });
}));

r.post('/logout', (req, res) => res.clearCookie('token').json({ ok: true }));

r.get('/me', authenticate, asyncH(async (req, res) => {
  const f = req.user.faculty ? await Faculty.findById(req.user.faculty).select('name designation').lean() : null;
  res.json({ user: { ...publicUser(req.user), facultyName: f?.name } });
}));

export default r;
