// Scopus API entitlement diagnostic.
// Probes each Elsevier endpoint/view with the configured key, reports real HTTP
// results only, and writes a report to backend/reports/. Never prints the API key.
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..', '..');
dotenv.config({ path: path.join(backendRoot, '.env') });

const KEY = (process.env.ELSEVIER_API_KEY || '').trim();
const INSTTOKEN = (process.env.ELSEVIER_INSTTOKEN || '').trim();
const BASE = (process.env.SCOPUS_API_BASE_URL || 'https://api.elsevier.com').replace(/\/$/, '');
const AUTHOR_ID = (process.env.DIAG_SCOPUS_AUTHOR_ID || '57201310675').trim();

const RATE_HEADERS = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-els-status', 'x-els-reqid'];

if (!KEY) {
  console.error('\nELSEVIER_API_KEY is empty. Put your key in backend/.env (ELSEVIER_API_KEY=...) and re-run.\n');
  process.exit(2);
}

const http = axios.create({
  baseURL: BASE,
  timeout: 30000,
  validateStatus: () => true, // we want to inspect every status ourselves
  headers: {
    Accept: 'application/json',
    'X-ELS-APIKey': KEY,
    ...(INSTTOKEN ? { 'X-ELS-Insttoken': INSTTOKEN } : {}),
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function classify(status, body, headers) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  const els = headers['x-els-status'] || '';
  if (status >= 200 && status < 300) return 'ACCESSIBLE';
  if (status === 401) {
    // Elsevier returns 401 both for a bad key and for a view the key's tier can't use.
    return /not authorized to access the requested view/i.test(text)
      ? 'VIEW_NOT_ENTITLED'
      : 'INVALID_OR_MISSING_CREDENTIALS';
  }
  if (status === 403) {
    if (/insttoken|institution|entitle|subscri|view not|not permitted|AUTHORIZATION_ERROR|privileges/i.test(text + els))
      return 'MISSING_ENTITLEMENT';
    return 'FORBIDDEN';
  }
  if (status === 400 && /invalid|view|count|exceed/i.test(text)) return 'BAD_REQUEST';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'QUOTA_OR_RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_ERROR';
  return 'UNEXPECTED';
}

// Retry only transient failures (429/5xx/network), with exponential backoff.
async function call(label, url, params) {
  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await http.get(url, { params });
    } catch (e) {
      res = { status: 0, data: String(e.message), headers: {} };
    }
    const transient = res.status === 0 || res.status === 429 || res.status >= 500;
    if (transient && attempt < 2) {
      const wait = 1000 * 2 ** attempt;
      console.log(`  ... ${label}: HTTP ${res.status}, retrying in ${wait}ms`);
      await sleep(wait);
      attempt++;
      continue;
    }
    const headers = {};
    for (const h of RATE_HEADERS) if (res.headers?.[h] !== undefined) headers[h] = res.headers[h];
    const result = {
      label,
      request: `GET ${url}?${new URLSearchParams(params).toString()}`,
      status: res.status,
      verdict: classify(res.status, res.data, res.headers || {}),
      headers,
      body: res.data,
    };
    await sleep(400); // be gentle: Scopus quotas are per-second and per-week
    return result;
  }
}

const errMsg = (b) =>
  b?.['service-error']?.status?.statusText ||
  b?.['error-response']?.['error-message'] ||
  b?.message ||
  (typeof b === 'string' ? b.slice(0, 200) : '');

function line(r) {
  const msg = r.status >= 400 || r.status === 0 ? `  -> ${errMsg(r.body)}` : '';
  console.log(`[${String(r.status).padEnd(3)}] ${r.verdict.padEnd(32)} ${r.label}${msg}`);
}

const results = [];
const run = async (label, url, params) => {
  const r = await call(label, url, params);
  results.push(r);
  line(r);
  return r;
};

console.log(`\nScopus diagnostic  base=${BASE}  author=${AUTHOR_ID}  insttoken=${INSTTOKEN ? 'set' : 'not set'}  key=****${KEY.slice(-4)}\n`);

// 1. Author Retrieval, every documented view
const authorViews = {};
for (const view of ['LIGHT', 'STANDARD', 'ENHANCED', 'METRICS']) {
  authorViews[view] = await run(`Author Retrieval view=${view}`, `/content/author/author_id/${AUTHOR_ID}`, { view });
}

// 2. Author Search
const authSearch = await run('Author Search AU-ID', '/content/search/author', { query: `AU-ID(${AUTHOR_ID})` });

// 3. Scopus Search, STANDARD and COMPLETE, plus pagination probe
const searchStd = await run('Scopus Search view=STANDARD count=5', '/content/search/scopus', {
  query: `AU-ID(${AUTHOR_ID})`, view: 'STANDARD', count: 5,
});
const searchCmp = await run('Scopus Search view=COMPLETE count=5', '/content/search/scopus', {
  query: `AU-ID(${AUTHOR_ID})`, view: 'COMPLETE', count: 5,
});
for (const count of [200, 100, 50, 25]) {
  await run(`Scopus Search STANDARD count=${count} (page-size probe)`, '/content/search/scopus', {
    query: `AU-ID(${AUTHOR_ID})`, view: 'STANDARD', count,
  });
}
await run('Scopus Search STANDARD start=5 count=5 (offset paging)', '/content/search/scopus', {
  query: `AU-ID(${AUTHOR_ID})`, view: 'STANDARD', start: 5, count: 5,
});
await run('Scopus Search cursor pagination', '/content/search/scopus', {
  query: `AU-ID(${AUTHOR_ID})`, view: 'STANDARD', count: 5, cursor: '*',
});

// Pick a document from whichever search worked, for downstream endpoints
const entries = (r) => (r?.body?.['search-results']?.entry || []).filter((e) => e['dc:identifier']);
const docs = entries(searchCmp).length ? entries(searchCmp) : entries(searchStd);
const sample = docs[0];
const scopusId = sample?.['dc:identifier']?.replace('SCOPUS_ID:', '');
const issn = (sample?.['prism:issn'] || sample?.['prism:eIssn'] || '').replace(/(\d{4})(\d{4})/, '$1$2');

// 4-5. Abstract Retrieval, Citation Overview
if (scopusId) {
  for (const view of ['META', 'META_ABS', 'FULL']) {
    await run(`Abstract Retrieval view=${view}`, `/content/abstract/scopus_id/${scopusId}`, { view });
  }
  await run('Citation Overview', '/content/abstract/citations', { scopus_id: scopusId, httpAccept: 'application/json' });
} else {
  console.log('\n(skipping Abstract Retrieval / Citation Overview: no document ID available from search)');
}

// 6. Serial Title
if (issn) {
  for (const view of ['STANDARD', 'ENHANCED']) {
    await run(`Serial Title by ISSN view=${view}`, `/content/serial/title/issn/${issn}`, { view });
  }
} else {
  await run('Serial Title by ISSN (sample ISSN 0028-0836) view=STANDARD', '/content/serial/title/issn/00280836', { view: 'STANDARD' });
  await run('Serial Title by ISSN (sample ISSN 0028-0836) view=ENHANCED', '/content/serial/title/issn/00280836', { view: 'ENHANCED' });
}

// ---- Display available author information
console.log('\n=== AUTHOR INFORMATION (best accessible view) ===');
const authBody = ['METRICS', 'ENHANCED', 'STANDARD', 'LIGHT'].map((v) => authorViews[v]).find((r) => r.status === 200)?.body;
const coredata = authBody?.['author-retrieval-response']?.[0];
if (coredata) {
  const c = coredata.coredata || {};
  const name = coredata['author-profile']?.['preferred-name'] || {};
  console.log({
    name: [name['given-name'], name.surname].filter(Boolean).join(' ') || 'N/A',
    authorId: c['dc:identifier'] || 'N/A',
    documentCount: c['document-count'] ?? 'N/A',
    citedByCount: c['cited-by-count'] ?? 'N/A',
    citationCount: c['citation-count'] ?? 'N/A',
    hIndex: coredata['h-index'] ?? 'N/A',
    coauthorCount: coredata['coauthor-count'] ?? 'N/A',
    affiliation: coredata['affiliation-current']?.['affiliation-name'] ?? 'N/A',
    orcid: c.orcid ?? 'N/A',
  });
} else {
  console.log('No author view returned data.');
}

// ---- First five publications
console.log('\n=== FIRST FIVE PUBLICATIONS ===');
const five = docs.slice(0, 5);
if (!five.length) console.log('No publication records retrieved.');
five.forEach((d, i) => {
  console.log(`${i + 1}. ${d['dc:title'] || 'N/A'}`);
  console.log(`   ${d['prism:publicationName'] || 'N/A'} | ${d['prism:coverDate'] || 'N/A'} | DOI ${d['prism:doi'] || 'N/A'} | cited-by ${d['citedby-count'] ?? 'N/A'} | EID ${d.eid || 'N/A'}`);
});
const total = searchStd.body?.['search-results']?.['opensearch:totalResults'];
if (total !== undefined) console.log(`\nTotal documents matching AU-ID(${AUTHOR_ID}): ${total}`);

// ---- Report
const summary = results.map((r) => ({ endpoint: r.label, status: r.status, verdict: r.verdict, headers: r.headers }));
const stamp = new Date().toISOString();
fs.mkdirSync(path.join(backendRoot, 'reports'), { recursive: true });
fs.writeFileSync(
  path.join(backendRoot, 'reports', 'scopus-diagnostic.json'),
  JSON.stringify({ generatedAt: stamp, authorId: AUTHOR_ID, institutionalTokenConfigured: !!INSTTOKEN, summary, raw: results }, null, 2)
);
const md = [
  `# Scopus API diagnostic`,
  `Generated: ${stamp}  |  Author ID: ${AUTHOR_ID}  |  Institutional token: ${INSTTOKEN ? 'configured' : 'not configured'}`,
  '',
  '| Endpoint | HTTP | Verdict |',
  '|---|---|---|',
  ...summary.map((s) => `| ${s.endpoint} | ${s.status} | ${s.verdict} |`),
  '',
  'Quota headers (last response): ' + JSON.stringify(results.at(-1)?.headers || {}),
].join('\n');
fs.writeFileSync(path.join(backendRoot, 'reports', 'scopus-diagnostic.md'), md);

console.log('\n=== SUMMARY ===');
console.table(summary.map(({ endpoint, status, verdict }) => ({ endpoint, status, verdict })));
console.log('Report written to backend/reports/scopus-diagnostic.{md,json}\n');
