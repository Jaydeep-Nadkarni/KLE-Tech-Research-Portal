import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User, AuditLog } from '../models/index.js';

export const signToken = (user) => jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, { expiresIn: '8h' });

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    const token = req.cookies?.token || (header?.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.sub).lean();
    if (!user || !user.active) return res.status(401).json({ error: 'Account unavailable' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission for this action' });

export const ADMIN = ['super_admin', 'hod'];
export const READ_ALL = ['super_admin', 'hod', 'viewer'];

/** Faculty users may only read their own researcher data; admins/viewers may read anyone's. */
export function canViewFaculty(req, res, next) {
  const id = req.params.id;
  if (READ_ALL.includes(req.user.role)) return next();
  if (req.user.faculty && String(req.user.faculty) === id) return next();
  res.status(403).json({ error: 'You can only view your own research profile' });
}

export const audit = (req, action, target, meta) =>
  AuditLog.create({ user: req.user?._id, userEmail: req.user?.email, action, target, meta }).catch(() => {});

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
