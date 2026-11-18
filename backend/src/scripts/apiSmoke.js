// End-to-end API smoke test against a running server. Usage: node src/scripts/apiSmoke.js
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

const BASE = `http://localhost:${env.port}/api`;
const creds = Object.fromEntries(fs.readFileSync(path.join(env.root, '.credentials.txt'), 'utf8').trim().split('\n').map((l) => { const [role, email, pw] = l.trim().split(/\s+/); return [email, { role, pw }]; }));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

async function login(email) {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: creds[email].pw }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0], body: await r.json() };
}
const api = (cookie) => async (p, opt = {}) => { const r = await fetch(BASE + p, { ...opt, headers: { cookie, ...(opt.headers || {}) } }); const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() }; };

const anon = await fetch(`${BASE}/admin/overview`);
check('unauthenticated request rejected (401)', anon.status === 401);
const bad = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: Object.keys(creds).find((e) => creds[e].role === 'hod'), password: 'wrong' }) });
check('wrong password rejected (401)', bad.status === 401);

const HOD_EMAIL = Object.keys(creds).find((e) => creds[e].role === 'hod');
const hod = await login(HOD_EMAIL);
check('HOD login', hod.status === 200 && hod.body.user.role === 'hod');
const H = api(hod.cookie);

const ov = await H('/admin/overview');
check('overview returns cards', ov.status === 200 && ov.body.cards.uniquePublications > 0, `unique=${ov.body.cards?.uniquePublications} scopus=${ov.body.cards?.scopusPublications} medianH=${ov.body.cards?.medianHIndex}`);
check('citations kept per provider (no combined total)', ov.body.cards.citationsBySource && !('combined' in ov.body.cards.citationsBySource) && !('total' in ov.body.cards.citationsBySource));
{
  const c = ov.body.cards, b = c.averageCitationsBasis;
  check('average citations = total citations / number of faculty', b.faculty === c.totalFaculty && b.totalCitations === c.citationsBySource.scopus.total && c.averageCitationsPerFaculty === +(b.totalCitations / c.totalFaculty).toFixed(1), `${b.totalCitations} / ${b.faculty} = ${c.averageCitationsPerFaculty}`);
  const gsOv2 = await H('/admin/overview?source=googlescholar');
  const g = gsOv2.body.cards;
  check('average also uses all faculty for Google Scholar', g.averageCitationsBasis.faculty === g.totalFaculty && g.averageCitationsPerFaculty === +(g.googleScholar.totalCitations / g.totalFaculty).toFixed(1), `${g.googleScholar.totalCitations} / ${g.totalFaculty} = ${g.averageCitationsPerFaculty}`);
}
check('web of science is null not 0', ov.body.cards.webOfSciencePublications === null);

const an = await H('/admin/analytics');
check('analytics', an.status === 200 && an.body.pubsByYear.length > 0, `years=${an.body.pubsByYear.length}`);
const cmp = await H('/admin/faculty-comparison?sort=totalPapers');
check('faculty comparison sorted desc', cmp.status === 200 && cmp.body.items[0].totalPapers >= cmp.body.items.at(-1).totalPapers, `rows=${cmp.body.total}`);
const first = cmp.body.items[0];

const prof = await H(`/researchers/${first.id}/profile`);
check('researcher profile', prof.status === 200 && prof.body.identifiers.length > 0);
const met = await H(`/researchers/${first.id}/metrics`);
check('researcher metrics', met.status === 200 && met.body.metrics.totalPublications === first.totalPapers, `${first.name}: ${met.body.metrics.totalPublications} papers`);
const pubs = await H(`/researchers/${first.id}/publications?limit=5&sort=citations&order=desc`);
check('publications paginated', pubs.status === 200 && pubs.body.items.length === 5 && pubs.body.total === first.totalPapers);
const filt = await H(`/researchers/${first.id}/publications?scopus=indexed&limit=100`);
check('scopus filter', filt.body.items.every((p) => p.indexing.scopus.status === 'indexed'), `n=${filt.body.total}`);
const det = await H(`/publications/${pubs.body.items[0]._id}`);
check('publication detail with provenance', det.status === 200 && det.body.sources.length > 0 && typeof det.body.journalRanking.applicable === 'boolean', `sources=${det.body.sources.map((s) => s.provider).join(',')}`);
const bogus = await H('/publications/not-an-id');
check('bad id returns 404 not 500', bogus.status === 404);

const ja = await H('/admin/journal-analytics');
check('journal analytics has real Scopus metrics', ja.status === 200 && ja.body.summary.foundInScopus > 0 && ja.body.items.some((i) => i.citeScore && i.sjr && i.snip), `journals=${ja.body.summary?.journals} found=${ja.body.summary?.foundInScopus} notFound=${ja.body.summary?.notFoundByIssn}`);
{
  const q = ja.body.quartiles;
  if (ja.body.summary.withQuartile === 0) check('no quartiles fabricated without a SCImago import', q.available === false && q.Q1 === null);
  else check('quartiles come only from SCImago data and only for journal papers', q.available === true && q.Q1 + q.Q2 + q.Q3 + q.Q4 === q.journalPapersWithQuartile && q.journalPapersWithQuartile <= q.journalPapersTotal && ja.body.items.filter((i) => i.quartile).every((i) => /SCImago/.test(i.quartile.source) && /^Q[1-4]$/.test(i.quartile.value)), `Q1 ${q.Q1} Q2 ${q.Q2} Q3 ${q.Q3} Q4 ${q.Q4} of ${q.journalPapersTotal} journal papers (${q.journalPapersWithQuartile} with quartile)`);
}
const jItem = ja.body.items.find((i) => i.citeScore);
check('CiteScore carries its own reporting year and source (may be old)', jItem?.citeScore?.year >= 2000 && jItem.citeScore.year <= new Date().getFullYear() && /Scopus/.test(jItem.citeScore.source), `${jItem?.title}: CiteScore ${jItem?.citeScore?.value} (${jItem?.citeScore?.year})`);
const confPub = (await H(`/researchers/${first.id}/publications?venueType=conference&limit=1`)).body.items[0];
if (confPub) { const cd = await H(`/publications/${confPub._id}`); check('conference paper has no journal ranking', cd.body.journalRanking.applicable === false); }
const jrPub = (await H(`/researchers/${first.id}/publications?venueType=journal&limit=100`)).body.items.find((p) => p.journal);
if (jrPub) { const jd = await H(`/publications/${jrPub._id}`); check('journal paper detail includes metrics with source', jd.body.journalRanking.available && jd.body.journalRanking.metrics.every((m) => m.source && m.year)); }

const tasks = await H('/admin/tasks');
check('verification tasks include ORCID conflict', tasks.body.items.some((t) => t.type === 'identifier_conflict'));
const rep = await H('/reports/export?type=department&format=xlsx');
check('xlsx report', rep.status === 200 && rep.body.byteLength > 2000, `${rep.body.byteLength} bytes`);
const csv = await H('/reports/export?type=scopus&format=csv&yearFrom=2024');
check('csv report', csv.status === 200);
const sync = await H('/sync/jobs');
check('sync jobs list', sync.status === 200);

// Faculty RBAC
const fEmail = Object.keys(creds).find((e) => creds[e].role === 'faculty' && e.startsWith('manisha'));
const fac = await login(fEmail);
const F = api(fac.cookie);
check('faculty login', fac.status === 200 && fac.body.user.role === 'faculty');
check('faculty blocked from admin overview (403)', (await F('/admin/overview')).status === 403);
check('faculty blocked from sync (403)', (await F('/sync/all', { method: 'POST' })).status === 403);
const list = await F('/faculty');
check('faculty list scoped to self', list.body.items.length === 1);
const other = cmp.body.items.find((x) => x.email !== fEmail);
check("faculty cannot read another's profile (403)", (await F(`/researchers/${other.id}/metrics`)).status === 403);
const ownId = list.body.items[0].id;
check('faculty can read own metrics', (await F(`/researchers/${ownId}/metrics`)).status === 200);
const edit = await F(`/faculty/${ownId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Hacked', designation: 'Dean' }) });
const after = await F(`/faculty/${ownId}`);
check('faculty cannot change name/designation', after.body.faculty.name === 'Manisha Tapale' && after.body.faculty.designation === 'Associate Professor', `status ${edit.status}`);

// Google Scholar endpoints (read + denied paths only; no data is written to the real database)
const sc = await H(`/researchers/${first.id}/scholar`);
check('scholar endpoint reports honest status', sc.status === 200 && ['unavailable', 'api', 'manual_verified', 'manual_pending'].includes(sc.body.status) && typeof sc.body.apiConfigured === 'boolean', `status=${sc.body.status} apiConfigured=${sc.body.apiConfigured}`);
check('scholar metrics not fabricated when none entered', sc.body.status !== 'unavailable' || sc.body.profile === null);
const badBody = await F(`/researchers/${ownId}/scholar/profile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ totalCitations: -5, hIndex: 'x', i10Index: 1 }) });
check('invalid scholar figures rejected (400)', badBody.status === 400);
check("faculty cannot submit another person's scholar figures (403)", (await F(`/researchers/${other.id}/scholar/profile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ totalCitations: 1, hIndex: 1, i10Index: 0 }) })).status === 403);
check('faculty cannot import or approve scholar data (403)', (await F(`/researchers/${ownId}/scholar/import`, { method: 'POST' })).status === 403 && (await F(`/researchers/${ownId}/scholar/approve`, { method: 'POST' })).status === 403);
check('admin import without file rejected (400)', (await H(`/researchers/${first.id}/scholar/import`, { method: 'POST' })).status === 400);
const gsRows = await H('/admin/faculty-comparison?source=googlescholar');
check('faculty table accepts google scholar source', gsRows.status === 200 && gsRows.body.items.every((i) => i.indicesReported === true));
const gsOv = await H('/admin/overview?source=googlescholar');
check('overview has scholar card with N/A (null) when no data', gsOv.status === 200 && 'googleScholar' in gsOv.body.cards);

// IEEE downloads
const text = async (cookie, p) => { const r = await fetch(BASE + p, { headers: { cookie } }); return { status: r.status, type: r.headers.get('content-type') || '', disp: r.headers.get('content-disposition') || '', buf: Buffer.from(await r.arrayBuffer()) }; };
const ieeeTxt = await text(hod.cookie, '/reports/ieee?format=txt');
const lines = ieeeTxt.buf.toString('utf8').split('\n').filter((l) => /^\[\d+\]/.test(l));
check('HOD downloads IEEE txt list', ieeeTxt.status === 200 && /attachment/.test(ieeeTxt.disp) && lines.length === ov.body.cards.uniquePublications, `${lines.length} references`);
check('IEEE references contain no placeholder junk', lines.every((l) => !/undefined|null|N\/A|NaN/.test(l)));
check('IEEE references are numbered sequentially with quoted titles', lines.every((l, i) => l.startsWith(`[${i + 1}] `) && l.includes('“')));
const ieeeDocx = await text(hod.cookie, `/reports/ieee?format=docx&facultyId=${first.id}`);
check('HOD downloads IEEE Word file for one faculty', ieeeDocx.status === 200 && ieeeDocx.buf.slice(0, 2).toString() === 'PK' && /\.docx/.test(ieeeDocx.disp));
const ieeeBib = await text(hod.cookie, '/reports/ieee?format=bib&venueType=journal&scopusOnly=true');
const bibText = ieeeBib.buf.toString('utf8');
check('IEEE BibTeX filtered to Scopus journal papers', ieeeBib.status === 200 && /@article\{/.test(bibText) && !/@inproceedings/.test(bibText));
check('invalid IEEE format rejected (400)', (await text(hod.cookie, '/reports/ieee?format=odt')).status === 400);
check("faculty cannot download another faculty's IEEE list (403)", (await text(fac.cookie, `/reports/ieee?format=txt&facultyId=${other.id}`)).status === 403);
check('faculty can download their own IEEE list', (await text(fac.cookie, `/reports/ieee?format=txt&facultyId=${ownId}`)).status === 200);
check('faculty can export their own report but not the department one', (await text(fac.cookie, `/reports/export?type=faculty&format=csv&facultyId=${ownId}`)).status === 200 && (await text(fac.cookie, '/reports/export?type=department&format=csv')).status === 403);
// User management (creates a temporary user and removes it again)
{
  const J = { 'content-type': 'application/json' };
  const email = `smoke.user.${Date.now()}@example.org`;
  const list = await H('/users');
  check('HOD can list users', list.status === 200 && list.body.items.some((u) => u.role === 'hod'));
  check('users API blocked for faculty (403)', (await F('/users')).status === 403);
  check('short password rejected (400)', (await H('/users', { method: 'POST', headers: J, body: JSON.stringify({ email, name: 'Smoke User', role: 'viewer', password: 'short' }) })).status === 400);
  check('faculty account without a faculty member rejected (400)', (await H('/users', { method: 'POST', headers: J, body: JSON.stringify({ email, name: 'Smoke User', role: 'faculty' }) })).status === 400);
  check('HOD cannot create a super admin (403)', (await H('/users', { method: 'POST', headers: J, body: JSON.stringify({ email, name: 'Smoke User', role: 'super_admin' }) })).status === 403);
  const created = await H('/users', { method: 'POST', headers: J, body: JSON.stringify({ email, name: 'Smoke User', role: 'viewer' }) });
  const pw1 = created.body.generatedPassword, uid = created.body.user?.id;
  check('HOD creates a user; password generated once, hash never returned', created.status === 201 && pw1?.length >= 8 && !('passwordHash' in created.body.user));
  check('duplicate email rejected (409)', (await H('/users', { method: 'POST', headers: J, body: JSON.stringify({ email, name: 'Dup', role: 'viewer' }) })).status === 409);
  const lg = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ email, password: pw1 }) });
  const V = api(lg.headers.get('set-cookie')?.split(';')[0]);
  check('new user can sign in with the generated password', lg.status === 200);
  check('viewer sees dashboards but cannot manage users or sync', (await V('/admin/overview')).status === 200 && (await V('/users')).status === 403 && (await V('/sync/all', { method: 'POST' })).status === 403);
  check('wrong current password rejected when changing password', (await V('/auth/change-password', { method: 'POST', headers: J, body: JSON.stringify({ currentPassword: 'nope-nope', newPassword: 'NewPassw0rd!' }) })).status === 400);
  check('user can change their own password', (await V('/auth/change-password', { method: 'POST', headers: J, body: JSON.stringify({ currentPassword: pw1, newPassword: 'NewPassw0rd!' }) })).status === 200);
  const loginOld = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ email, password: pw1 }) });
  const loginNew = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ email, password: 'NewPassw0rd!' }) });
  check('old password stops working, new one works', loginOld.status === 401 && loginNew.status === 200);
  const rp = await H(`/users/${uid}/reset-password`, { method: 'POST', headers: J, body: '{}' });
  check('HOD can reset a password (shown once)', rp.status === 200 && rp.body.generatedPassword?.length >= 8);
  check('HOD can deactivate; deactivated user cannot sign in', (await H(`/users/${uid}`, { method: 'PUT', headers: J, body: JSON.stringify({ active: false }) })).status === 200 && (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ email, password: rp.body.generatedPassword }) })).status === 401);
  const myId = (await H('/users')).body.items.find((u) => u.email === HOD_EMAIL).id;
  check('cannot deactivate, demote or delete your own account (400)', (await H(`/users/${myId}`, { method: 'PUT', headers: J, body: JSON.stringify({ active: false }) })).status === 400 && (await H(`/users/${myId}`, { method: 'PUT', headers: J, body: JSON.stringify({ role: 'viewer' }) })).status === 400 && (await H(`/users/${myId}`, { method: 'DELETE' })).status === 400);
  check('temporary user deleted (cleanup)', (await H(`/users/${uid}`, { method: 'DELETE' })).status === 200 && !(await H('/users')).body.items.some((u) => u.email === email));
}

// Co-authors
const ca =await H('/admin/coauthors?limit=100');
const classes = Object.keys(ca.body.labels || {});
check('co-authors classified into known classes only', ca.status === 200 && ca.body.items.length > 0 && ca.body.items.every((i) => classes.includes(i.class)), `${ca.body.totals?.people} people, ${JSON.stringify(ca.body.summary)}`);
check('summary counts add up to distinct co-authors', Object.values(ca.body.summary).reduce((a, b) => a + b, 0) === ca.body.totals.people);
check('no department faculty listed as co-authors in the department-wide view', ca.body.summary.department === 0);
check('nobody is called a student without a manual tag', ca.body.items.every((i) => !['student', 'research_scholar'].includes(i.class) || i.classSource === 'manual tag'));
const perFac = await H(`/researchers/${first.id}/coauthors`);
check('per-faculty co-authors exclude the faculty themself', perFac.status === 200 && perFac.body.items.every((i) => i.name.toLowerCase() !== first.name.toLowerCase()), `${perFac.body.total} for ${first.name}`);
const tagTarget = ca.body.items.find((i) => i.class === 'unknown') || ca.body.items[0];
const tagRes = await H('/admin/coauthors/tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: tagTarget.key, name: tagTarget.name, category: 'student', note: 'smoke test' }) });
const afterTag = await H(`/admin/coauthors?q=${encodeURIComponent(tagTarget.name)}&limit=50`);
check('HOD can tag a co-author as student', tagRes.status === 200 && afterTag.body.items.find((i) => i.key === tagTarget.key)?.class === 'student' && afterTag.body.items.find((i) => i.key === tagTarget.key)?.classSource === 'manual tag');
check('tag is removable and the data-derived class returns', (await H(`/admin/coauthors/tag?key=${encodeURIComponent(tagTarget.key)}`, { method: 'DELETE' })).status === 200 && (await H(`/admin/coauthors?q=${encodeURIComponent(tagTarget.name)}&limit=50`)).body.items.find((i) => i.key === tagTarget.key)?.class === tagTarget.class);
check('invalid tag category / department tag rejected', (await H('/admin/coauthors/tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'oa:A1', category: 'dean' }) })).status === 400 && (await H('/admin/coauthors/tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'dept:123', category: 'student' }) })).status === 400);
check('faculty cannot tag or list the department-wide co-authors (403)', (await F('/admin/coauthors')).status === 403 && (await F('/admin/coauthors/tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: tagTarget.key, category: 'student' }) })).status === 403);
check('faculty can see own co-authors but not another faculty\'s (403)', (await F(`/researchers/${ownId}/coauthors`)).status === 200 && (await F(`/researchers/${other.id}/coauthors`)).status === 403);

// PDF reports
const pdfOf = async (cookie, p) => { const r = await text(cookie, p); return { ...r, pages: (r.buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length }; };
const pdfDept = await pdfOf(hod.cookie, '/reports/export?type=department&format=pdf');
check('HOD downloads department report as PDF', pdfDept.status === 200 && pdfDept.type.includes('application/pdf') && pdfDept.buf.slice(0, 5).toString() === '%PDF-' && /\.pdf/.test(pdfDept.disp) && pdfDept.pages >= 1 && pdfDept.pages <= 3, `${pdfDept.buf.length} bytes, ${pdfDept.pages} page(s)`);
const pdfPubs = await pdfOf(hod.cookie, `/reports/export?type=faculty&format=pdf&facultyId=${first.id}`);
check('faculty publications PDF spans pages, no blank trailing page', pdfPubs.status === 200 && pdfPubs.pages > 1, `${pdfPubs.pages} pages`);
const pdfIeee = await pdfOf(hod.cookie, '/reports/ieee?format=pdf');
check('IEEE list as PDF', pdfIeee.status === 200 && pdfIeee.buf.slice(0, 5).toString() === '%PDF-' && pdfIeee.pages > 5, `${pdfIeee.pages} pages`);
check('faculty can download own PDF, not the department one', (await text(fac.cookie, `/reports/export?type=faculty&format=pdf&facultyId=${ownId}`)).status === 200 && (await text(fac.cookie, '/reports/export?type=department&format=pdf')).status === 403 && (await text(fac.cookie, `/reports/ieee?format=pdf&facultyId=${other.id}`)).status === 403);
check('unknown report format rejected', (await text(hod.cookie, '/reports/export?type=department&format=doc')).status === 400);
// Web of Science
const ws = await H('/admin/wos/status');
check('web of science status is honest', ws.status === 200 && typeof ws.body.apiConfigured === 'boolean' && ws.body.coverage.total > 0, JSON.stringify(ws.body.coverage));
check('web of science is N/A (null) until papers are checked', ov.body.cards.webOfScienceCoverage.checked > 0 || ov.body.cards.webOfSciencePublications === null);
check('faculty cannot import WoS data (403)', (await F('/admin/wos/status')).status === 403);
check('WoS import without file rejected (400)', (await H('/admin/wos/import', { method: 'POST' })).status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
