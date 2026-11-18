// Measures empty fields across publications and faculty. Usage: node src/scripts/gapReport.js
import { connectDb, disconnectDb } from '../config/db.js';
import { Publication, Faculty, FacultyPublication, Journal } from '../models/index.js';

await connectDb();
const live = await FacultyPublication.find({ verificationStatus: { $ne: 'rejected' } }).distinct('publication');
const pubs = await Publication.find({ _id: { $in: live } }).lean();
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const fields = ['doi', 'abstract', 'year', 'date', 'venue', 'publisher', 'volume', 'issue', 'pages', 'type', 'url', 'issn', 'keywords', 'fields', 'countries', 'authors'];
const out = { publications: pubs.length };
for (const f of fields) out[f] = pubs.filter((p) => empty(p[f])).length;
out.onlyFirstAuthor = pubs.filter((p) => (p.authors || []).length === 1).length;
out.openAccessUnknown = pubs.filter((p) => p.openAccess === 'unknown').length;
out.venueTypeUnknown = pubs.filter((p) => p.venueType === 'unknown').length;
out.journalPapersNoJournalLink = pubs.filter((p) => p.venueType === 'journal' && !p.journal).length;
out.noCitationsAnyProvider = pubs.filter((p) => !p.citations || !Object.keys(p.citations).length).length;
console.log('MISSING per publication field (of ' + pubs.length + '):'); console.log(JSON.stringify(out, null, 1));
const noDoi = pubs.filter((p) => !p.doi);
console.log('\nno-DOI papers by provider set:', JSON.stringify(noDoi.reduce((a, p) => { const k = p.providers.join('+'); a[k] = (a[k] || 0) + 1; return a; }, {})));
console.log('\nFACULTY gaps:');
for (const f of await Faculty.find().lean()) {
  const g = f.profiles || {};
  const miss = ['scopus', 'orcid', 'openalex', 'googlescholar'].filter((k) => !g[k]);
  console.log(`  ${f.name.padEnd(22)} missing profiles: ${miss.join(', ') || 'none'}  | sync: ${Object.entries(f.sync || {}).map(([k, v]) => k + ':' + v.status).join(' ')}`);
}
console.log('\njournals without CiteScore:', await Journal.countDocuments({ scopusStatus: 'not_found' }), 'not found in Scopus of', await Journal.countDocuments());
await disconnectDb();
