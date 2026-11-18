// Usage: node src/scripts/fillGaps.js   (then node src/scripts/gapReport.js to compare)
import { connectDb, disconnectDb } from '../config/db.js';
import { fillGaps } from '../services/gapFill.js';

await connectDb();
const r = await fillGaps((step, d, t) => process.stdout.write(`\r${step} ${d}/${t}   `));
console.log('\n' + JSON.stringify({ ...r, enrichment: r.enrichment.map((e) => ({ faculty: e.faculty, scopusDoiCheck: e.scopusDoiCheck, crossref: e.crossref, semanticScholar: e.semanticScholar })) }, null, 1));
await disconnectDb();
