// Copies every collection from the local dev MongoDB to the database in MONGODB_URI (e.g. Atlas).
// Idempotent: documents are upserted by _id, so it can be re-run safely. Usage: node src/scripts/migrateToAtlas.js
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import * as M from '../models/index.js';

const local = process.env.LOCAL_MONGODB_URI || 'mongodb://127.0.0.1:27017/kle_research_portal';
const target = env.mongoUri;
if (/127\.0\.0\.1|localhost/.test(target)) { console.error('MONGODB_URI still points at a local database; nothing to migrate to.'); process.exit(2); }

const { MongoClient } = mongoose.mongo;
const src = await MongoClient.connect(local, { serverSelectionTimeoutMS: 8000 });
const dst = await MongoClient.connect(target, { serverSelectionTimeoutMS: 15000 });
const sdb = src.db(), ddb = dst.db(new URL(target.replace('mongodb+srv://', 'https://')).pathname.slice(1) || 'kle_research_portal');

const report = [];
for (const { name } of await sdb.listCollections().toArray()) {
  if (name.startsWith('system.')) continue;
  const docs = await sdb.collection(name).find().toArray();
  for (let i = 0; i < docs.length; i += 500) {
    await ddb.collection(name).bulkWrite(docs.slice(i, i + 500).map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })), { ordered: false });
  }
  report.push({ collection: name, local: docs.length, atlas: await ddb.collection(name).countDocuments() });
}
console.table(report);
await src.close(); await dst.close();

// Create the schema indexes on the new database
await mongoose.connect(target, { serverSelectionTimeoutMS: 15000 });
for (const model of Object.values(M)) if (model?.syncIndexes) await model.syncIndexes();
console.log('indexes synced');
const mismatch = report.filter((r) => r.local !== r.atlas);
console.log(mismatch.length ? `MISMATCH: ${JSON.stringify(mismatch)}` : 'All collection counts match.');
await mongoose.disconnect();
process.exit(mismatch.length ? 1 : 0);
