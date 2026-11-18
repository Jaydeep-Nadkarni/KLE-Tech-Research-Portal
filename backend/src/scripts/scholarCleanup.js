// Cleans up Google Scholar-only records. Preview by default; pass --apply to change data.
// Usage: node src/scripts/scholarCleanup.js [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { Publication, FacultyPublication, ProviderRecord } from '../models/index.js';
import { normTitle } from '../utils/normalize.js';
import { mergePublications, rejectPublication } from '../services/merge.js';

const APPLY = process.argv.includes('--apply');
// Entries on the faculty members' own Scholar profiles that are not papers (reviewed with the user).
const JUNK = [/^year of publication:\s*\d{4}$/i, /^kles dr msscet india$/i, /^international journal of medical, medicine and health sciences$/i];

const tok = (t) => new Set(normTitle(t).split(' ').filter((w) => w.length > 2));
const jac = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
const contain = (a, b) => { const [s, l] = a.size <= b.size ? [a, b] : [b, a]; if (!s.size) return 0; let i = 0; for (const x of s) if (l.has(x)) i++; return i / s.size; };

await connectDb();
const scholarOnly = await Publication.find({ providers: { $size: 1, $in: ['googlescholar'] }, verificationStatus: { $ne: 'rejected' } });
const others = (await Publication.find({ providers: { $ne: 'googlescholar' } }).select('title year doi providers')).map((o) => ({ o, t: tok(o.title) }));

const junk = scholarOnly.filter((p) => JUNK.some((re) => re.test(p.title.trim())));
const junkIds = new Set(junk.map((p) => String(p._id)));
const merges = [];
for (const p of scholarOnly) {
  if (junkIds.has(String(p._id))) continue;
  const t = tok(p.title);
  let best = null;
  for (const { o, t: ot } of others) {
    const score = Math.max(jac(t, ot), contain(t, ot) >= 0.9 && Math.min(t.size, ot.size) >= 4 ? 0.9 : 0);
    if (!best || score > best.score) best = { score, o };
  }
  const gap = best?.o.year && p.year ? Math.abs(best.o.year - p.year) : 0;
  if (best && best.score >= 0.8 && gap <= 2) merges.push({ drop: p, keep: best.o, score: best.score, gap });
}

console.log(`${APPLY ? 'APPLYING' : 'PREVIEW (no changes)'}: ${junk.length} junk entries to reject, ${merges.length} duplicates to merge\n`);
console.log('Reject:'); junk.forEach((p) => console.log(`  - "${p.title}" (${p.year ?? 'no year'})`));
console.log('Merge (Scholar record -> existing record):');
merges.forEach((m) => console.log(`  - "${m.drop.title.slice(0, 70)}" (${m.drop.year ?? '-'}) -> "${m.keep.title.slice(0, 70)}" (${m.keep.year ?? '-'}) [${m.keep.providers.join(',')}] score ${m.score.toFixed(2)}${m.gap ? ` YEAR GAP ${m.gap}` : ''}`));

if (APPLY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(env.root, 'reports', `scholar-cleanup-backup-${stamp}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ids = [...junk.map((p) => p._id), ...merges.flatMap((m) => [m.drop._id, m.keep._id])];
  fs.writeFileSync(file, JSON.stringify({
    publications: await Publication.find({ _id: { $in: ids } }).lean(),
    facultyPublications: await FacultyPublication.find({ publication: { $in: ids } }).lean(),
    providerRecords: await ProviderRecord.find({ publication: { $in: ids } }).select('-raw').lean(),
  }, null, 1));
  console.log(`\nBackup written: ${file}`);
  for (const p of junk) await rejectPublication(p._id, null, { userEmail: 'system:scholar-cleanup', reason: 'Not a publication (Scholar profile artefact)' });
  for (const m of merges) await mergePublications(m.keep._id, m.drop._id, { userEmail: 'system:scholar-cleanup', reason: `Duplicate of existing record (title similarity ${m.score.toFixed(2)})` });
  console.log(`Done: ${junk.length} rejected, ${merges.length} merged.`);
}
await disconnectDb();
