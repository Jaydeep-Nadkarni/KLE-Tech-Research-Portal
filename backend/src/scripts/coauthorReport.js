// Prints the co-author classification as computed from the live database. Usage: node src/scripts/coauthorReport.js
import { connectDb, disconnectDb } from '../config/db.js';
import { buildCoauthors } from '../services/coauthors.js';

await connectDb();
const { items, summary, totals } = await buildCoauthors();
console.log('totals:', JSON.stringify(totals));
console.log('classes:', JSON.stringify(summary));
console.log('\nTop co-authors:');
for (const i of items.slice(0, 14)) console.log(`${String(i.papers).padStart(3)}  ${i.name.padEnd(26)} ${i.classLabel.padEnd(28)} ${i.institutions.slice(0, 2).join('; ').slice(0, 55)}  [with ${i.faculty.map((f) => f.name.split(' ')[0]).join(', ')}]`);
console.log('\nSample of "Affiliation unknown":', items.filter((i) => i.class === 'unknown').slice(0, 5).map((i) => i.name).join(', '));
console.log('Sample of "External":', items.filter((i) => i.class === 'external').slice(0, 5).map((i) => `${i.name} (${i.institutions[0]})`).join('; '));
const dept = items.filter((i) => i.class === 'department');
console.log('Dept faculty appearing as co-authors in the department-wide view (should be 0):', dept.length);
await disconnectDb();
