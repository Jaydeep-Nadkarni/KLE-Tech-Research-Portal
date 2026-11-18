// Shows what Google Scholar data is stored per faculty. Usage: node src/scripts/scholarReport.js
import { connectDb, disconnectDb } from '../config/db.js';
import { Faculty, Publication } from '../models/index.js';

await connectDb();
for (const f of await Faculty.find().sort({ name: 1 })) {
  const p = f.profiles.get('googlescholar');
  console.log(p
    ? `${f.name.padEnd(22)} ${p.mode}/${p.verification}  citations ${p.totalCitations?.all ?? 'N/A'} (since ${p.totalCitations?.sinceYear}: ${p.totalCitations?.since ?? 'N/A'})  h ${p.hIndex?.all ?? 'N/A'}  i10 ${p.i10Index?.all ?? 'N/A'}  years ${p.citationsByYear?.length ?? 0}  coauthors ${p.coAuthors?.length ?? 0}  interests ${p.interests?.length ?? 0}`
    : `${f.name.padEnd(22)} no scholar data  (sync: ${f.sync.get('googlescholar')?.status || 'not run'} ${f.sync.get('googlescholar')?.error || ''})`);
}
const first = await Faculty.findOne({ name: /Manisha/ });
const p = first.profiles.get('googlescholar');
if (p) console.log('\nSample profile fields (Manisha):', JSON.stringify({ name: p.name, affiliation: p.affiliation, email: p.emailNote, interests: p.interests, totalCitations: p.totalCitations, hIndex: p.hIndex, i10Index: p.i10Index, citationsByYear: p.citationsByYear?.slice(-4), coAuthors: p.coAuthors?.slice(0, 3) }, null, 1));
console.log('\nPublications listed on Scholar:', await Publication.countDocuments({ 'indexing.googleScholar.status': 'listed' }),
  '| Scholar-only (no other source):', await Publication.countDocuments({ 'indexing.googleScholar.status': 'listed', providers: { $size: 1 } }),
  '| Scopus-indexed without a Scopus record:', await Publication.countDocuments({ 'indexing.scopus.status': 'indexed', providers: { $nin: ['scopus'] } }));
await disconnectDb();
