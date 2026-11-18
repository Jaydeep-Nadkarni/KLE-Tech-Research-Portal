// Downloads sample PDFs as the HOD would. Usage: node src/scripts/pdfSample.js <output-dir>
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

const out = process.argv[2];
if (!out) { console.error('Usage: node src/scripts/pdfSample.js <output-dir>'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const BASE = `http://localhost:${env.port}/api`;
const [email, pw] = fs.readFileSync(path.join(env.root, '.credentials.txt'), 'utf8').split('\n').find((l) => l.startsWith('hod ')).trim().split(/\s+/).slice(1);
const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const jobs = { 'department.pdf': '/reports/export?type=department&format=pdf', 'scopus.pdf': '/reports/export?type=scopus&format=pdf', 'citations.pdf': '/reports/export?type=citations&format=pdf&yearFrom=2024', 'ieee.pdf': '/reports/ieee?format=pdf&yearFrom=2025' };
for (const [name, p] of Object.entries(jobs)) {
  const r = await fetch(BASE + p, { headers: { cookie } });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(path.join(out, name), buf);
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`${name.padEnd(16)} HTTP ${r.status} ${r.headers.get('content-type')}  ${buf.length} bytes  header ${buf.slice(0, 5).toString()}  pages ${pages}`);
}
