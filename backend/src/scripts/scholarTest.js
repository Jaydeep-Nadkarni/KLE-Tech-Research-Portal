// Isolated test of the Google Scholar paths. Uses a throwaway database that is dropped at the end.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/kle_test_scholar';
process.env.LOG_LEVEL = 'silent';
const { connectDb } = await import('../config/db.js');
const mongoose = (await import('mongoose')).default;
const M = await import('../models/index.js');
const { upsertWork } = await import('../services/ingest.js');
const S = await import('../services/scholar.js');
const G = await import('../providers/googleScholar.js');
const { facultyRows } = await import('../services/summaries.js');

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };

await connectDb();
await mongoose.connection.dropDatabase();
const f = await M.Faculty.create({ name: 'Test Person', email: 'test.person@example.org' });

// an existing record from another provider that Scholar also lists (same title, no DOI on Scholar side)
await upsertWork(f, { provider: 'scopus', externalId: '2-s2.0-1', eid: '2-s2.0-1', doi: '10.1000/abc', title: 'Deep Learning for Medical Image Segmentation', year: 2023, authors: [{ name: 'Person T.' }], citations: { count: 7 }, venueType: 'journal' }, { stats: {}, matchedBy: 'test', confidence: 0.97 });

const csv = 'Authors,Title,Publication,Volume,Number,Pages,Year,Publisher,Cited by\n"T Person, A Kumar",Deep learning for medical image segmentation,Journal of Imaging,5,2,10-20,2023,MDPI,12\n"T Person",A New Method for Graph Colouring,Discrete Math Letters,,,,2021,,3\n';
const works = S.parseScholarCsv(csv);
check('CSV parsed', works.length === 2 && works[0].authors.length === 2 && works[0].citations.count === 12);
const r = await S.importScholarWorks(f, works);
check('import dedupes against existing paper (not counted twice)', r.matchedExisting === 1 && r.created === 1 && (await M.Publication.countDocuments()) === 2, JSON.stringify(r));
const merged = await M.Publication.findOne({ doi: '10.1000/abc' });
check('Scholar listing recorded independently of Scopus', merged.indexing.googleScholar.status === 'listed' && merged.indexing.scopus.status === 'indexed');
check('Scholar and Scopus citations kept separate', merged.citations.get('scopus').count === 7 && merged.citations.get('googlescholar').count === 12 && merged.citations.get('googlescholar').via === 'manual');
const fresh = await M.Publication.findOne({ title: 'A New Method for Graph Colouring' });
check('Scholar-only paper is NOT marked Scopus-indexed', fresh.indexing.scopus.status === 'pending' && fresh.indexing.googleScholar.status === 'listed');

const bib = '@article{x1,\n  title={Bibtex {Test} Paper},\n  author={Person, Test and Kumar, Anil},\n  journal={Test Journal},\n  year={2020}\n}\n@inproceedings{x2,\n  title={A Conference Paper},\n  author={Person, T},\n  booktitle={ICTest},\n  year={2019}\n}\n';
const bw = S.parseBibtex(bib);
check('BibTeX parsed with entry types', bw.length === 2 && bw[0].venueType === 'journal' && bw[1].venueType === 'conference' && bw[0].title === 'Bibtex Test Paper');

// profile: faculty submission is pending, admin approval verifies it
const facDoc = await M.Faculty.findById(f._id);
const input = { totalCitations: 120, totalCitationsSince: 90, hIndex: 6, hIndexSince: 5, i10Index: 4, i10IndexSince: 3, sinceYear: 2021, citationsByYear: [{ year: 2024, citations: 30 }] };
const p1 = await S.saveManualProfile(facDoc, input, { email: 'test.person@example.org' }, false);
check('faculty-submitted figures are pending approval', p1.verification === 'pending_approval' && p1.verifiedBy === null);
const p2 = await S.approveManualProfile(await M.Faculty.findById(f._id), { email: 'hod@example.org' });
check('admin approval verifies and records who/when', p2.verification === 'verified' && p2.verifiedBy === 'hod@example.org' && !!p2.lastVerifiedAt);
check('metric history snapshot kept', (await M.ResearcherMetricSnapshot.countDocuments({ faculty: f._id, provider: 'googlescholar' })) === 1);

const rows = await facultyRows('googlescholar', {}, { _id: f._id });
check('faculty table uses Scholar profile figures, flagged as reported', rows[0].citations === 120 && rows[0].hIndex === 6 && rows[0].i10Index === 4 && rows[0].indicesReported === true);
const rowsS = await facultyRows('scopus', {}, { _id: f._id });
check('other sources stay portal-calculated', rowsS[0].indicesReported === false);

// SerpApi response shape (per the provider's documented Google Scholar Author API)
const sample = { author: { name: 'T Person', affiliations: 'Test University', email: 'Verified email at example.org', interests: [{ title: 'Imaging' }, { title: 'Graphs' }] },
  cited_by: { table: [{ citations: { all: 500, since_2021: 300 } }, { h_index: { all: 11, since_2021: 9 } }, { i10_index: { all: 14, since_2021: 10 } }], graph: [{ year: 2023, citations: 80 }, { year: 2024, citations: 110 }] },
  co_authors: [{ name: 'A Kumar', affiliations: 'Elsewhere' }] };
const np = G.normalizeProfile(sample, 'ABC123xyz_AJ');
check('SerpApi profile normalized (all/since pairs, graph, interests)', np.totalCitations.all === 500 && np.totalCitations.since === 300 && np.totalCitations.sinceYear === 2021 && np.hIndex.all === 11 && np.i10Index.since === 10 && np.citationsByYear.length === 2 && np.interests.length === 2 && np.coAuthors[0].name === 'A Kumar');
check('adapter refuses to run without an API key', await G.fetchWorks('x').then(() => false, (e) => e.kind === 'auth'));

await mongoose.connection.dropDatabase();
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed (test database dropped)`);
process.exit(fail ? 1 : 0);
