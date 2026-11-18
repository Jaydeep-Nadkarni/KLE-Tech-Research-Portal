// Usage: node src/scripts/syncResearcher.js "Manisha"   |  --all   [--no-enrich]
import { connectDb, disconnectDb } from '../config/db.js';
import { syncFaculty, findFaculty } from '../services/syncService.js';

const args = process.argv.slice(2);
const enrich = !args.includes('--no-enrich');
const q = args.find((a) => !a.startsWith('--'));
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
await connectDb();
let list = await findFaculty(args.includes('--all') || args.includes('--unsynced') ? null : q);
// --unsynced: only faculty that have never been synchronized (new imports)
if (args.includes('--unsynced')) list = list.filter((f) => !f.sync || f.sync.size === 0);
if (!list.length) console.log('No faculty matched.');
for (const f of list) {
  console.log(`\n=== ${f.name} ===`);
  console.log(JSON.stringify(await syncFaculty(f, { enrich, providers: only }), null, 2));
}
await disconnectDb();
