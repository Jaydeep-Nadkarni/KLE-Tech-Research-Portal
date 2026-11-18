// Manual synchronization. Jobs run in-process and are tracked in the SyncJob collection.
// TODO(phase 7): move execution to BullMQ workers once Redis is available.
import { Router } from 'express';
import { Faculty, SyncJob, SyncLog } from '../models/index.js';
import { requireRole, ADMIN, READ_ALL, audit, asyncH } from '../middleware/auth.js';
import { syncFaculty } from '../services/syncService.js';
import { syncJournals } from '../services/journalSync.js';
import { logger } from '../utils/logger.js';
import { isId } from '../services/publicationQuery.js';

const r = Router();

async function runJob(job, facultyList) {
  job.status = 'running'; job.startedAt = new Date(); job.progress.total = facultyList.length;
  await job.save();
  try {
    for (const f of facultyList) {
      job.progress.current = f.name; await job.save();
      const result = await syncFaculty(f);
      job.results.push(result); job.progress.done += 1;
      await job.save();
    }
    // New papers may belong to journals we have not looked up yet (fresh ones are skipped)
    job.results.push({ journals: await syncJournals().catch((e) => ({ error: e.message })) });
    job.status = 'completed';
  } catch (e) {
    logger.error({ err: e.message }, 'sync job failed');
    job.status = 'failed'; job.error = e.message;
  }
  job.progress.current = undefined; job.finishedAt = new Date();
  await job.save();
}

async function start(req, res, scope, facultyList, facultyId) {
  if (await SyncJob.exists({ status: { $in: ['queued', 'running'] } })) return res.status(409).json({ error: 'A synchronization job is already running' });
  const job = await SyncJob.create({ scope, faculty: facultyId, triggeredBy: req.user.email, progress: { total: facultyList.length, done: 0 } });
  await audit(req, `sync_${scope}`, String(job._id), { faculty: facultyList.map((f) => f.name) });
  setImmediate(() => runJob(job, facultyList).catch((e) => logger.error({ err: e.message }, 'job runner crashed')));
  res.status(202).json({ job });
}

r.post('/researcher/:id', requireRole(...ADMIN), asyncH(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const f = await Faculty.findById(req.params.id);
  if (!f) return res.status(404).json({ error: 'Faculty not found' });
  await start(req, res, 'faculty', [f], f._id);
}));

r.post('/all', requireRole(...ADMIN), asyncH(async (req, res) => start(req, res, 'all', await Faculty.find({ active: true }))));

r.post('/journals', requireRole(...ADMIN), asyncH(async (req, res) => {
  if (await SyncJob.exists({ status: { $in: ['queued', 'running'] } })) return res.status(409).json({ error: 'A synchronization job is already running' });
  const job = await SyncJob.create({ scope: 'journals', triggeredBy: req.user.email, status: 'running', startedAt: new Date() });
  await audit(req, 'sync_journals', String(job._id), {});
  setImmediate(async () => {
    try {
      const result = await syncJournals({ force: req.body?.force === true, onProgress: (done, total, current) => { job.progress = { done, total, current }; job.save().catch(() => {}); } });
      job.results.push(result); job.status = 'completed';
    } catch (e) { job.status = 'failed'; job.error = e.message; }
    job.progress.current = undefined; job.finishedAt = new Date();
    await job.save();
  });
  res.status(202).json({ job });
}));

r.get('/jobs', requireRole(...READ_ALL), asyncH(async (req, res) => {
  const jobs = await SyncJob.find().sort({ createdAt: -1 }).limit(Number(req.query.limit) || 20).select('-results').populate('faculty', 'name').lean();
  res.json({ items: jobs });
}));
r.get('/jobs/:id', requireRole(...READ_ALL), asyncH(async (req, res) => {
  const job = isId(req.params.id) ? await SyncJob.findById(req.params.id).lean() : null;
  job ? res.json({ job }) : res.status(404).json({ error: 'Job not found' });
}));

r.get('/history', requireRole(...READ_ALL), asyncH(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Number(req.query.limit) || 30);
  const f = {}; if (req.query.status) f.status = req.query.status; if (req.query.provider) f.provider = req.query.provider;
  const [items, total] = await Promise.all([
    SyncLog.find(f).sort({ finishedAt: -1 }).skip((page - 1) * limit).limit(limit).populate('faculty', 'name').lean(),
    SyncLog.countDocuments(f),
  ]);
  res.json({ items: items.map((l) => ({ ...l, faculty: l.faculty?.name })), total, page, limit });
}));

export default r;
