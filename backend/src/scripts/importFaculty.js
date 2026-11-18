// Cleans and imports a faculty list (JSON array of {name, designation, email, scholar, orcid, scopus}).
// Usage: node src/scripts/importFaculty.js data/faculty-2026-11.json [--department "Name"]
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { Faculty, ResearcherIdentifier } from '../models/index.js';
import { importFacultyRecords, validateIdentifiers, orcidChecksumOk, formatCheck } from '../services/identifierValidation.js';
import { normOrcid } from '../utils/normalize.js';

const file = process.argv[2];
const dept = process.argv.includes('--department') ? process.argv[process.argv.indexOf('--department') + 1] : null;
if (!file) { console.error('Usage: node src/scripts/importFaculty.js <file.json> [--department "Name"]'); process.exit(2); }

const issues = [];
const title = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const records = JSON.parse(fs.readFileSync(path.resolve(env.root, file), 'utf8')).map((r) => {
  const name = r.name.replace(/\s+/g, ' ').trim();
  const out = { name, designation: title(String(r.designation || '').replace(/\s+/g, ' ').trim()), email: String(r.email || '').trim().toLowerCase() };
  let scholar = String(r.scholar || '').trim();
  if (/[&?#]/.test(scholar)) { const cleaned = scholar.split(/[&?#]/)[0]; issues.push(`${name}: Scholar ID "${scholar}" had URL leftovers; using "${cleaned}"`); scholar = cleaned; }
  if (scholar && !formatCheck.scholar(scholar)) { issues.push(`${name}: Scholar ID "${scholar}" is not 12 characters; skipped`); scholar = ''; }
  const orcid = normOrcid(r.orcid) || '';
  if (r.orcid && !orcid) issues.push(`${name}: ORCID "${r.orcid}" is not a valid format; skipped`);
  else if (orcid && !orcidChecksumOk(orcid)) issues.push(`${name}: ORCID ${orcid} fails the ORCID checksum (likely a typo); it will be flagged for review`);
  const scopus = String(r.scopus || '').trim();
  if (scopus && !formatCheck.scopus(scopus)) issues.push(`${name}: Scopus ID "${scopus}" is not 10-11 digits; it will be flagged for review`);
  const missing = ['scholar', 'orcid', 'scopus'].filter((k) => !{ scholar, orcid, scopus }[k]);
  if (missing.length === 3) issues.push(`${name}: no identifiers supplied, so no publications can be retrieved until some are added`);
  return { ...out, scholar: scholar || undefined, orcid: orcid || undefined, scopus: scopus || undefined, _missing: missing };
});

await connectDb();
const before = new Set((await Faculty.find().select('email').lean()).map((f) => f.email));
const created = records.filter((r) => !before.has(r.email));
await importFacultyRecords(records.map(({ _missing, ...r }) => r));
if (dept) await Faculty.updateMany({}, { $set: { department: dept } });
const validation = await validateIdentifiers();

console.log(`Faculty in file: ${records.length} | new: ${created.length} | already present: ${records.length - created.length}`);
console.log('New:', created.map((r) => r.name).join(', ') || 'none');
if (dept) console.log(`Department set to "${dept}" for all faculty`);
console.log('\nData issues found while cleaning:'); (issues.length ? issues : ['none']).forEach((i) => console.log(' -', i));
console.log('\nIdentifier validation (whole database):', JSON.stringify(validation));
const gaps = records.filter((r) => r._missing.length).map((r) => `${r.name} (no ${r._missing.join(', ')})`);
console.log('\nMissing identifiers:', gaps.join('; ') || 'none');
console.log('Total faculty now:', await Faculty.countDocuments(), '| identifiers:', await ResearcherIdentifier.countDocuments());
await disconnectDb();
