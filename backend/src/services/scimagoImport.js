// Imports a SCImago Journal Rank export (scimagojr.com > Journal Rankings > Download data; semicolon CSV).
// Only journals already in the portal are touched. Quartiles are stored per subject category and year.
import { parse } from 'csv-parse/sync';
import { Journal } from '../models/index.js';
import { upsertMetrics } from './journalSync.js';
import { normIssn } from '../utils/normalize.js';

const dec = (v) => { const x = Number(String(v ?? '').replace(',', '.')); return v === '' || v == null || Number.isNaN(x) ? null : x; };

/**
 * Tolerant splitter for SCImago rows: ';'-separated, fields optionally wrapped in quotes. A quoted field ends only at a
 * quote that is followed by ';' or end of line, so publisher names containing stray inner quotes do not break parsing.
 */
export function splitScimagoLine(line) {
  const out = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length && !(line[j] === '"' && (j + 1 === line.length || line[j + 1] === ';'))) j++;
      out.push(line.slice(i + 1, j));
      i = j + 2; // skip closing quote and the separator
    } else {
      let j = line.indexOf(';', i);
      if (j === -1) j = line.length;
      out.push(line.slice(i, j));
      i = j + 1;
    }
    if (i > line.length) break;
  }
  return out.map((s) => s.trim());
}

function readRows(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = splitScimagoLine(lines[0]);
  return lines.slice(1).map((l) => { const f = splitScimagoLine(l); return Object.fromEntries(header.map((h, k) => [h, f[k] ?? ''])); });
}

export function parseScimago(text) {
  const rows = readRows(text);
  return rows.map((r) => ({
    sourceId: r.Sourceid || null,
    title: r.Title,
    type: r.Type,
    issns: String(r.Issn || '').split(',').map((s) => normIssn(s.trim())).filter(Boolean),
    sjr: dec(r.SJR),
    bestQuartile: /^Q[1-4]$/.test(r['SJR Best Quartile'] || '') ? r['SJR Best Quartile'] : null,
    hIndex: dec(r['H index']),
    categories: String(r.Categories || '').split(';').map((c) => c.trim()).filter(Boolean).map((c) => {
      const m = c.match(/^(.*)\s\((Q[1-4])\)$/);
      return m ? { name: m[1].trim(), quartile: m[2] } : { name: c, quartile: null };
    }),
  }));
}

export async function importScimago(text, year) {
  const source = `SCImago Journal Rank ${year} file`;
  const rows = parseScimago(text);
  const byIssn = new Map();
  for (const r of rows) for (const i of r.issns) byIssn.set(i, r);
  const out = { rowsInFile: rows.length, portalJournals: 0, matched: 0, unmatched: [] };
  for (const j of await Journal.find({ aggregationType: { $in: ['journal', 'Journal', null] } })) {
    out.portalJournals++;
    const r = j.issn.map((i) => byIssn.get(i)).find(Boolean);
    if (!r) { out.unmatched.push(j.title); continue; }
    out.matched++;
    const metrics = [];
    if (r.bestQuartile) metrics.push({ metric: 'SJR Best Quartile', value: r.bestQuartile, reportingYear: year, source });
    if (r.sjr != null) metrics.push({ metric: 'SJR', value: r.sjr, reportingYear: year, source });
    if (r.hIndex != null) metrics.push({ metric: 'H index', value: r.hIndex, reportingYear: year, source });
    for (const c of r.categories) if (c.quartile) metrics.push({ metric: 'SJR Quartile', value: c.quartile, reportingYear: year, subjectCategory: c.name, source });
    await upsertMetrics(j._id, metrics);
  }
  return out;
}
