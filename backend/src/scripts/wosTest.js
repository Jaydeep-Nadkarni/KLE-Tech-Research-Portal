// Isolated test of the Web of Science paths (throwaway database, dropped at the end).
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/kle_test_wos';
process.env.LOG_LEVEL = 'silent';
process.env.CLARIVATE_API_KEY = '';
const { connectDb } = await import('../config/db.js');
const mongoose = (await import('mongoose')).default;
const XLSX = await import('xlsx');
const M = await import('../models/index.js');
const { upsertWork } = await import('../services/ingest.js');
const W = await import('../services/wosImport.js');
const P = await import('../providers/webOfScience.js');
const { wosCount, wosCoverage, loadPubs } = await import('../services/metrics.js');

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };

await connectDb();
await mongoose.connection.dropDatabase();
const f = await M.Faculty.create({ name: 'Test Person', email: 'tp@example.org' });
const add = (w) => upsertWork(f, { authors: [], citations: null, ...w }, { stats: {}, matchedBy: 'test', confidence: 0.97 });
await add({ provider: 'scopus', externalId: 'e1', eid: '2-s2.0-1', doi: '10.1000/aaa', title: 'Alpha Paper On Graphs', year: 2022, citations: { count: 5 }, venueType: 'journal' });
await add({ provider: 'scopus', externalId: 'e2', eid: '2-s2.0-2', title: 'Beta Paper On Trees', year: 2021, citations: { count: 2 }, venueType: 'journal' });
await add({ provider: 'scopus', externalId: 'e3', eid: '2-s2.0-3', doi: '10.1000/ccc', title: 'Gamma Paper Not In WoS', year: 2020, citations: { count: 1 }, venueType: 'journal' });

check('before any check Web of Science count is N/A (null), not 0', wosCount(await loadPubs([f._id])) === null);

// Tab-delimited export (two-letter field tags), as saved by "Plain text file"
const tsv = 'PT\tAU\tTI\tSO\tPY\tDI\tUT\tTC\tSN\tVL\tBP\tEP\tDT\nJ\tCee, A; Dee, B\tAlpha Paper On Graphs\tJournal Of Graphs\t2022\t10.1000/AAA\tWOS:000111\t14\t1234-5678\t7\t10\t20\tArticle\nJ\tEff, C\tBeta Paper on Trees\tTree Letters\t2021\t\tWOS:000222\t3\t\t\t\t\tArticle\nJ\tNobody, N\tA Paper By Someone Else\tOther J\t2019\t10.9999/zzz\tWOS:000333\t50\t\t\t\t\tArticle\n';
const r1 = await W.importWosExport('savedrecs.txt', Buffer.from(tsv));
check('tab-delimited: 2 matched (DOI case-insensitive, title), 1 unmatched not created', r1.matched === 2 && r1.unmatchedCount === 1 && (await M.Publication.countDocuments()) === 3, JSON.stringify({ m: r1.matched, u: r1.unmatchedCount }));
const a = await M.Publication.findOne({ doi: '10.1000/aaa' });
check('WoS indexed with evidence + UT, independent of Scopus', a.indexing.webOfScience.status === 'indexed' && /WOS:000111/.test(a.indexing.webOfScience.evidence) && a.indexing.scopus.status === 'indexed');
check('WoS citations kept separate from Scopus', a.citations.get('webofscience').count === 14 && a.citations.get('scopus').count === 5 && a.citations.get('webofscience').via === 'manual');
const c = await M.Publication.findOne({ doi: '10.1000/ccc' });
check('paper absent from the export is NOT marked WoS-indexed or not-found (stays unchecked)', c.indexing.webOfScience.status === 'not_checked');
const cov = wosCoverage(await loadPubs([f._id]));
check('WoS count = papers actually confirmed', wosCount(await loadPubs([f._id])) === 2 && cov.indexed === 2 && cov.total === 3, JSON.stringify(cov));

// Excel export (long column names), idempotent re-import
const ws = XLSX.utils.json_to_sheet([{ Authors: 'Cee, A', 'Article Title': 'Alpha Paper On Graphs', 'Source Title': 'Journal Of Graphs', 'Publication Year': 2022, DOI: '10.1000/aaa', 'UT (Unique WOS ID)': 'WOS:000111', 'Times Cited, WoS Core': 15 }]);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'savedrecs');
const r2 = await W.importWosExport('savedrecs.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
const a2 = await M.Publication.findOne({ doi: '10.1000/aaa' });
check('Excel export read; re-import updates, never duplicates', r2.matched === 1 && (await M.Publication.countDocuments()) === 3 && a2.citations.get('webofscience').count === 15 && r2.alreadyIndexed === 1);
check('unreadable/no-title file is reported', await W.importWosExport('x.txt', Buffer.from('A\tB\n1\t2\n')).then((r) => r.noTitle === r.rows));

// Clarivate Starter API response shape (per the provider's documentation)
const hit = { uid: 'WOS:000999', title: 'Starter Shape Paper', types: ['Article'], sourceTypes: ['Journal'], source: { sourceTitle: 'Some Journal', publishYear: 2024, volume: '3', issue: '2', pages: { range: '5-9' } }, names: { authors: [{ displayName: 'Cee, A', wosStandard: 'Cee, A' }] }, links: { record: 'https://www.webofscience.com/wos/woscc/full-record/WOS:000999' }, citations: [{ db: 'WOS', count: 8 }], identifiers: { doi: '10.1000/XYZ', issn: '1234-5678' }, keywords: { authorKeywords: ['graphs'] } };
const nh = P.normalizeHit(hit);
check('Starter API hit normalized (UT, DOI, citations, venue type)', nh.externalId === 'WOS:000999' && nh.doi === '10.1000/xyz' && nh.citations.count === 8 && nh.venueType === 'journal' && nh.year === 2024 && nh.pages === '5-9');
check('API adapter refuses to run without a key', await P.lookupByDoi('10.1000/aaa').then(() => false, (e) => e.kind === 'auth'));

await mongoose.connection.dropDatabase();
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed (test database dropped)`);
process.exit(fail ? 1 : 0);
