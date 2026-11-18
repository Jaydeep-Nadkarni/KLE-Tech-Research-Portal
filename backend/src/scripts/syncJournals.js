// Usage: node src/scripts/syncJournals.js [--force]
import { connectDb, disconnectDb } from '../config/db.js';
import { syncJournals } from '../services/journalSync.js';

await connectDb();
console.log(JSON.stringify(await syncJournals({ force: process.argv.includes('--force'), onProgress: (d, t, n) => process.stdout.write(`\r${d}/${t} ${String(n).slice(0, 50).padEnd(50)}`) }), null, 2));
await disconnectDb();
