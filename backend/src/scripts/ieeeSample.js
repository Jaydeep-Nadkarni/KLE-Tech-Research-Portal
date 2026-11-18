// Prints a sample of the IEEE list as the HOD would download it. Usage: node src/scripts/ieeeSample.js
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

const BASE = `http://localhost:${env.port}/api`;
const [email, pw] = fs.readFileSync(path.join(env.root, '.credentials.txt'), 'utf8').split('\n').find((l) => l.startsWith('hod ')).trim().split(/\s+/).slice(1);
const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const txt = await (await fetch(`${BASE}/reports/ieee?format=txt`, { headers: { cookie } })).text();
const lines = txt.split('\n');
console.log(lines.slice(0, 6).join('\n'));
const refs = lines.filter((l) => /^\[\d+\]/.test(l));
const pick = (re) => refs.filter((l) => re.test(l));
console.log('\n--- first 5 ---\n' + refs.slice(0, 5).join('\n'));
console.log('\n--- conference samples ---\n' + pick(/ in /).slice(0, 3).join('\n'));
console.log('\n--- et al. count:', pick(/et al\./).length, '| with DOI:', pick(/doi: /).length, '| total:', refs.length);
console.log('--- bare (no venue/details) refs:', refs.filter((l) => /\.”$/.test(l)).length);
console.log('--- shortest 3 ---\n' + [...refs].sort((a, b) => a.length - b.length).slice(0, 3).join('\n'));
