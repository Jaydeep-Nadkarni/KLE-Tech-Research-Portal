import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { importFacultyRecords, validateIdentifiers } from '../services/identifierValidation.js';

await connectDb();
const records = JSON.parse(fs.readFileSync(path.join(env.root, 'data', 'faculty.json'), 'utf8'));
const faculty = await importFacultyRecords(records);
console.log(`Imported/updated ${faculty.length} faculty`);
const report = await validateIdentifiers();
console.log('Identifier validation:', JSON.stringify(report, null, 2));
await disconnectDb();
