// Usage: node src/scripts/importScimago.js <path-to-scimago.csv> <reporting-year>
import fs from 'node:fs';
import { connectDb, disconnectDb } from '../config/db.js';
import { importScimago } from '../services/scimagoImport.js';

const [file, yearArg] = process.argv.slice(2);
const year = Number(yearArg);
if (!file || !year) { console.error('Usage: node src/scripts/importScimago.js <scimago.csv> <reporting-year e.g. 2024>'); process.exit(2); }
await connectDb();
const r = await importScimago(fs.readFileSync(file, 'utf8'), year);
console.log(JSON.stringify({ ...r, unmatched: `${r.unmatched.length} journals not found in file`, unmatchedSample: r.unmatched.slice(0, 10) }, null, 2));
await disconnectDb();
