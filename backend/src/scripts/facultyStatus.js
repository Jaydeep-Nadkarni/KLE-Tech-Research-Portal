// One line per faculty: papers, Scopus-indexed, Scholar figures and per-provider sync result. Usage: node src/scripts/facultyStatus.js
import { connectDb, disconnectDb } from '../config/db.js';
import { Faculty, FacultyPublication, Publication } from '../models/index.js';

await connectDb();
const rows = [];
for (const f of await Faculty.find({ active: true }).sort({ createdAt: 1 })) {
  const links = await FacultyPublication.find({ faculty: f._id, verificationStatus: { $ne: 'rejected' } }).select('publication').lean();
  const ids = links.map((l) => l.publication);
  const scopus = await Publication.countDocuments({ _id: { $in: ids }, 'indexing.scopus.status': 'indexed' });
  const gs = f.profiles?.get?.('googlescholar');
  const st = Object.fromEntries([...f.sync.entries()].map(([k, v]) => [k, v.status === 'success' ? `ok(${v.count})` : `${v.status}${v.error ? ':' + v.error.slice(0, 38) : ''}`]));
  rows.push({ name: f.name.slice(0, 22), papers: ids.length, scopus, gsCites: gs?.totalCitations?.all ?? 'N/A', gsH: gs?.hIndex?.all ?? 'N/A', scopusSync: st.scopus || '-', orcid: st.orcid || '-', openalex: st.openalex || '-', scholar: st.googlescholar || '-' });
}
console.table(rows);
console.log('total unique publications:', await Publication.countDocuments({ _id: { $in: await FacultyPublication.find({ verificationStatus: { $ne: 'rejected' } }).distinct('publication') } }));
await disconnectDb();
