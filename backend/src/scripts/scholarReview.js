// Review of publications found only on Google Scholar: likely duplicates of other records vs genuinely new.
// Read-only. Usage: node src/scripts/scholarReview.js [--json]
import { connectDb, disconnectDb } from '../config/db.js';
import { Publication, FacultyPublication } from '../models/index.js';
import { normTitle } from '../utils/normalize.js';

const tok = (t) => new Set(normTitle(t).split(' ').filter((w) => w.length > 2));
const jac = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
// containment catches Scholar's truncated titles ("... deep learning for ...")
const contain = (a, b) => { const [s, l] = a.size <= b.size ? [a, b] : [b, a]; if (!s.size) return 0; let i = 0; for (const x of s) if (l.has(x)) i++; return i / s.size; };

await connectDb();
const only = await Publication.find({ providers: { $size: 1, $in: ['googlescholar'] } }).lean();
const others = await Publication.find({ providers: { $ne: 'googlescholar' } }).select('title year doi venue providers').lean();
const otherTok = others.map((o) => ({ ...o, t: tok(o.title) }));

const rows = [];
for (const p of only) {
  const t = tok(p.title);
  let best = null;
  for (const o of otherTok) {
    const j = jac(t, o.t), c = contain(t, o.t);
    const score = Math.max(j, c >= 0.9 && Math.min(t.size, o.t.size) >= 4 ? 0.9 : 0);
    if (!best || score > best.score) best = { score, o, j };
  }
  const yearGap = best?.o.year && p.year ? Math.abs(best.o.year - p.year) : null;
  const verdict = best && best.score >= 0.8 && (yearGap == null || yearGap <= 2) ? 'likely_duplicate' : best && best.score >= 0.6 ? 'possible_duplicate' : 'distinct';
  const link = await FacultyPublication.findOne({ publication: p._id }).populate('faculty', 'name').lean();
  rows.push({ id: p._id, title: p.title, year: p.year, venue: p.venue, faculty: link?.faculty?.name, verdict, score: best ? +best.score.toFixed(2) : 0, match: best && best.score >= 0.6 ? { title: best.o.title, year: best.o.year, doi: best.o.doi, providers: best.o.providers } : null });
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
else {
  const by = (v) => rows.filter((r) => r.verdict === v);
  console.log(`Scholar-only papers: ${rows.length}`);
  console.log(`  likely duplicates: ${by('likely_duplicate').length} | possible: ${by('possible_duplicate').length} | distinct: ${by('distinct').length}`);
  const perFaculty = {}; for (const r of rows) perFaculty[r.faculty] = (perFaculty[r.faculty] || 0) + 1;
  console.log('  per faculty:', JSON.stringify(perFaculty));
  for (const v of ['likely_duplicate', 'possible_duplicate']) {
    console.log(`\n== ${v} ==`);
    for (const r of by(v)) console.log(`- [${r.score}] (${r.year}) ${r.title.slice(0, 90)}\n     ~ (${r.match.year}) ${r.match.title.slice(0, 90)}  ${r.match.doi || 'no DOI'}  [${r.match.providers.join(',')}]`);
  }
  console.log('\n== distinct (sample of 12) ==');
  for (const r of by('distinct').slice(0, 12)) console.log(`- (${r.year}) ${r.title.slice(0, 80)} | ${(r.venue || 'no venue').slice(0, 40)} | ${r.faculty}`);
  const noVenue = rows.filter((r) => !r.venue).length, noYear = rows.filter((r) => !r.year).length;
  console.log(`\nMissing venue: ${noVenue}, missing year: ${noYear}`);
}
await disconnectDb();
