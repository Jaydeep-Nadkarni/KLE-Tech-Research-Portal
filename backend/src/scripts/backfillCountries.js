// One-off: copy author-institution countries from stored OpenAlex provider records onto publications.
import { connectDb, disconnectDb } from '../config/db.js';
import { ProviderRecord, Publication } from '../models/index.js';
import { uniq } from '../utils/normalize.js';

await connectDb();
let n = 0, withData = 0;
for await (const r of ProviderRecord.find({ provider: 'openalex' })) {
  const countries = uniq((r.raw?.authorships || []).flatMap((a) => a.countries || (a.institutions || []).map((i) => i.country_code)));
  n++;
  if (!countries.length) continue;
  withData++;
  await Publication.updateOne({ _id: r.publication }, { $addToSet: { countries: { $each: countries } } });
}
console.log(`OpenAlex records scanned: ${n}, with country data: ${withData}`);
await disconnectDb();
