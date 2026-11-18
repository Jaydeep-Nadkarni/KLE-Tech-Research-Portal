// Integrity report over what is actually stored. Usage: node src/scripts/dbReport.js
import { connectDb, disconnectDb } from '../config/db.js';
import { Faculty, Publication, FacultyPublication, ProviderRecord, VerificationTask, SyncLog, CitationSnapshot, ResearcherIdentifier } from '../models/index.js';

await connectDb();
const out = {};
out.counts = {
  faculty: await Faculty.countDocuments(), identifiers: await ResearcherIdentifier.countDocuments(),
  publications: await Publication.countDocuments(), facultyPublications: await FacultyPublication.countDocuments(),
  providerRecords: await ProviderRecord.countDocuments(), citationSnapshots: await CitationSnapshot.countDocuments(),
  openVerificationTasks: await VerificationTask.countDocuments({ status: 'open' }),
};
out.providerRecordsByProvider = Object.fromEntries((await ProviderRecord.aggregate([{ $group: { _id: '$provider', n: { $sum: 1 } } }])).map((r) => [r._id, r.n]));

// integrity: no duplicate DOI / EID among publications
const dup = async (f) => (await Publication.aggregate([{ $match: { [f]: { $ne: null } } }, { $group: { _id: `$${f}`, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])).length;
out.integrity = { duplicateDois: await dup('doi'), duplicateEids: await dup('eid') };

// Scopus "indexed" must be backed by a Scopus provider record
const scopusIndexed = await Publication.find({ 'indexing.scopus.status': 'indexed' }).select('_id');
const withScopusRec = new Set((await ProviderRecord.find({ provider: 'scopus' }).distinct('publication')).map(String));
out.integrity.scopusIndexedWithoutScopusRecord = scopusIndexed.filter((p) => !withScopusRec.has(String(p._id))).length;

const stat = async (path) => Object.fromEntries((await Publication.aggregate([{ $group: { _id: `$indexing.${path}.status`, n: { $sum: 1 } } }])).map((r) => [r._id, r.n]));
out.indexingDistribution = {};
for (const k of ['scopus', 'orcid', 'openalex', 'semanticScholar', 'crossref', 'webOfScience', 'googleScholar']) out.indexingDistribution[k] = await stat(k);

out.perFaculty = [];
for (const f of await Faculty.find()) {
  const links = await FacultyPublication.find({ faculty: f._id }).populate('publication');
  const cites = (prov) => links.filter((l) => l.publication.citations.get(prov)).reduce((a, l) => a + l.publication.citations.get(prov).count, 0);
  const has = (prov) => links.filter((l) => l.publication.citations.get(prov)).length;
  out.perFaculty.push({
    name: f.name, unique: links.length,
    scopusIndexed: links.filter((l) => l.publication.indexing.scopus.status === 'indexed').length,
    // citation sums are per provider and shown separately, never added together
    citationsScopus: has('scopus') ? cites('scopus') : 'N/A', citationsOpenAlex: has('openalex') ? cites('openalex') : 'N/A',
    sync: Object.fromEntries([...f.sync.entries()].map(([k, v]) => [k, v.status])),
  });
}
out.syncFailures = (await SyncLog.find({ status: 'failed' }).limit(5)).map((l) => ({ provider: l.provider, kind: l.errorKind, msg: l.message?.slice(0, 120) }));
out.openTasks = (await VerificationTask.find({ status: 'open' })).map((t) => ({ type: t.type, payload: t.type === 'identifier_conflict' ? t.payload : { incoming: t.payload.incoming?.title } }));
console.log(JSON.stringify(out, null, 2));
await disconnectDb();
