// One-off: re-derive venueType for Scopus-sourced publications from the stored raw Scopus record.
import { connectDb, disconnectDb } from '../config/db.js';
import { ProviderRecord, Publication } from '../models/index.js';
import { venueTypeOf } from '../providers/scopus.js';

await connectDb();
let changed = 0, total = 0;
for await (const r of ProviderRecord.find({ provider: 'scopus' })) {
  const vt = venueTypeOf(r.raw?.['prism:aggregationType'], r.raw?.subtypeDescription);
  total++;
  if (vt === 'unknown') continue;
  const res = await Publication.updateOne({ _id: r.publication, venueType: { $ne: vt } }, { $set: { venueType: vt } });
  changed += res.modifiedCount;
}
console.log(`Scopus records: ${total}, publications updated: ${changed}`);
await disconnectDb();
