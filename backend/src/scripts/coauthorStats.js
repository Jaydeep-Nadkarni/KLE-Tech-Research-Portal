// What do we actually know about co-authors? Usage: node src/scripts/coauthorStats.js
import { connectDb, disconnectDb } from '../config/db.js';
import { Publication, ProviderRecord } from '../models/index.js';

await connectDb();
const pubs = await Publication.find({ verificationStatus: { $ne: 'rejected' } }).select('authors providers').lean();
console.log('publications:', pubs.length);
const lens = pubs.map((p) => (p.authors || []).length);
console.log('papers with a full-looking author list (>=2 authors):', lens.filter((n) => n >= 2).length, '| only first author:', lens.filter((n) => n === 1).length, '| none:', lens.filter((n) => n === 0).length);
const names = new Set(); for (const p of pubs) for (const a of p.authors || []) if (a.name) names.add(a.name.toLowerCase());
console.log('distinct author names (raw, not deduplicated):', names.size);

const oa = await ProviderRecord.find({ provider: 'openalex' }).select('publication raw.authorships').lean();
const seenPub = new Set(); let authorships = 0, withInst = 0, withId = 0, kle = 0, withCountry = 0;
const instNames = new Map();
for (const r of oa) {
  if (seenPub.has(String(r.publication))) continue; seenPub.add(String(r.publication));
  for (const a of r.raw?.authorships || []) {
    authorships++;
    if (a.author?.id) withId++;
    const insts = a.institutions || [];
    if (insts.length) withInst++;
    if (a.countries?.length) withCountry++;
    if (insts.some((i) => /\bKLE\b|K\.?L\.?E\.?\b/i.test(i.display_name || '') || i.id === 'https://openalex.org/I3132975163')) kle++;
    for (const i of insts) instNames.set(i.display_name, (instNames.get(i.display_name) || 0) + 1);
  }
}
console.log(`OpenAlex papers: ${seenPub.size} | authorships: ${authorships} | with author id: ${withId} | with institution: ${withInst} | KLE-affiliated: ${kle} | with country: ${withCountry}`);
console.log('top institutions:', [...instNames].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n} (${c})`).join('; '));
const kleNames = [...instNames].filter(([n]) => /KLE|K\.L\.E|Sheshgiri|Belgaum|Belagavi/i.test(n));
console.log('KLE-like institution names seen:', kleNames.map(([n, c]) => `${n} (${c})`).join('; '));
await disconnectDb();
