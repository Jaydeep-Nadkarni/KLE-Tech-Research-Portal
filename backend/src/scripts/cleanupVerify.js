import { connectDb, disconnectDb } from '../config/db.js';
import { Publication, FacultyPublication, ProviderRecord, AuditLog } from '../models/index.js';

await connectDb();
const fmt = (p) => `${p.title.slice(0, 50)} | scopus=${p.indexing.scopus.status} gscholar=${p.indexing.googleScholar.status} | cites ${[...p.citations.entries()].map(([k, v]) => `${k}:${v.count}`).join(' ')} | providers ${p.providers.join(',')}`;
console.log('publications in DB:', await Publication.countDocuments(), '| rejected:', await Publication.countDocuments({ verificationStatus: 'rejected' }));
console.log('links:', await FacultyPublication.countDocuments(), '| rejected links:', await FacultyPublication.countDocuments({ verificationStatus: 'rejected' }));
console.log('provider records pointing at missing publications:', (await ProviderRecord.find().select('publication').lean()).filter((r) => r.publication).length - (await ProviderRecord.countDocuments({ publication: { $in: await Publication.distinct('_id') } })));
console.log('orphan faculty links:', (await FacultyPublication.countDocuments()) - (await FacultyPublication.countDocuments({ publication: { $in: await Publication.distinct('_id') } })));
for (const re of [/^FSRCLP/, /^Stereo Image Transformation/, /^Parameter findings/, /^SURFACE CRACK/]) { const p = await Publication.findOne({ title: re }); console.log('merged ->', fmt(p)); }
const dups = await Publication.aggregate([{ $match: { doi: { $ne: null } } }, { $group: { _id: '$doi', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
console.log('duplicate DOIs:', dups.length, '| scopus-indexed w/o scopus record:', await Publication.countDocuments({ 'indexing.scopus.status': 'indexed', providers: { $nin: ['scopus'] } }));
console.log('audit entries:', await AuditLog.countDocuments({ action: 'publication_merge' }), 'merges,', await AuditLog.countDocuments({ action: 'publication_reject' }), 'rejections');
await disconnectDb();
