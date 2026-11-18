// Server-side PDF generation (pdfkit). Standard PDF fonts only cover Latin text, so text is made "PDF-safe":
// accents are stripped and unsupported characters are dropped rather than printed as garbage.
import PDFDocument from 'pdfkit';
import { ieeeSegments } from './ieee.js';

const BRAND = '#1f4e79', INK = '#1b2430', MUTE = '#6b7785', LINE = '#d9dee4', SHADE = '#f1f4f7';

export function pdfSafe(s) {
  return String(s ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E¡-ÿ]/g, '');
}

function start({ orientation = 'portrait', title, info = [] }) {
  const doc = new PDFDocument({ size: 'A4', layout: orientation, margin: 40, bufferPages: true, info: { Title: pdfSafe(title), Author: 'KLE Technological University Research Portal' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(BRAND).text('KLE TECHNOLOGICAL UNIVERSITY  |  RESEARCH PORTAL', { characterSpacing: 0.5 });
  doc.moveDown(0.4).font('Helvetica-Bold').fontSize(17).fillColor(INK).text(pdfSafe(title), { width: W() });
  doc.moveDown(0.3).font('Helvetica').fontSize(8.5).fillColor(MUTE);
  for (const line of info) doc.text(pdfSafe(line), { width: W(), lineGap: 1.5 });
  doc.moveDown(0.6).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + W(), doc.y).strokeColor(LINE).lineWidth(0.7).stroke();
  doc.moveDown(0.8);
  return { doc, done, W };
}

function finish({ doc, done }, generated) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing in the bottom margin would otherwise add a blank page
    const y = doc.page.height - 28;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTE);
    doc.text(`KLE Technological University Research Portal  |  Generated ${generated}`, doc.page.margins.left, y, { lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

/** columns: [{key, label, w (relative width), align?}]. Header repeats on every page; rows never split across pages. */
export async function buildTablePdf({ title, info = [], columns, rows, orientation = 'landscape', note }) {
  const ctx = start({ orientation, title, info });
  const { doc, W } = ctx;
  const totalW = columns.reduce((a, c) => a + c.w, 0);
  const widths = columns.map((c) => (c.w / totalW) * W());
  const left = doc.page.margins.left;
  const pad = 4;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 14;

  const header = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(7);
    const labels = columns.map((c) => pdfSafe(c.label).toUpperCase());
    const hh = Math.max(...labels.map((t, i) => doc.heightOfString(t, { width: widths[i] - pad * 2 }))) + 10;
    doc.rect(left, y, W(), hh).fill(SHADE);
    doc.fillColor(INK);
    let x = left;
    labels.forEach((t, i) => { doc.text(t, x + pad, y + 5, { width: widths[i] - pad * 2, align: columns[i].align || 'left' }); x += widths[i]; });
    doc.y = y + hh + 2;
  };
  header();

  doc.font('Helvetica').fontSize(8);
  if (!rows.length) { doc.fillColor(MUTE).text('No records for this selection.', left, doc.y + 6); }
  rows.forEach((r, idx) => {
    const cells = columns.map((c, i) => pdfSafe(r[c.key] ?? 'N/A'));
    doc.font('Helvetica').fontSize(8);
    const h = Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: widths[i] - pad * 2, lineGap: 1 }))) + pad * 2;
    if (doc.y + h > bottom()) { doc.addPage(); header(); }
    const y = doc.y;
    if (idx % 2) doc.rect(left, y, W(), h).fill('#fafbfc');
    doc.fillColor(INK);
    let x = left;
    cells.forEach((t, i) => {
      doc.fillColor(t === 'N/A' ? MUTE : INK).text(t, x + pad, y + pad, { width: widths[i] - pad * 2, align: columns[i].align || 'left', lineGap: 1 });
      x += widths[i];
    });
    doc.moveTo(left, y + h).lineTo(left + W(), y + h).strokeColor(LINE).lineWidth(0.4).stroke();
    doc.y = y + h;
  });

  if (note) { doc.moveDown(1).font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTE).text(pdfSafe(note), left, doc.y, { width: W() }); }
  return finish(ctx, new Date().toISOString().slice(0, 10));
}

/** IEEE reference list: numbered, hanging indent, italic venue. */
export async function buildIeeePdf({ title, info = [], pubs }) {
  const ctx = start({ orientation: 'portrait', title, info });
  const { doc, W } = ctx;
  const left = doc.page.margins.left, indent = 30;
  doc.fontSize(9.5);
  pubs.forEach((p, i) => {
    const segs = ieeeSegments(p);
    const plain = segs.map((s) => pdfSafe(s.text)).join('');
    doc.font('Times-Roman').fontSize(9.5);
    const h = doc.heightOfString(plain, { width: W() - indent, lineGap: 2 }) + 6;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 14) doc.addPage();
    const y = doc.y;
    doc.fillColor(INK).font('Times-Roman').text(`[${i + 1}]`, left, y, { width: indent - 4, lineBreak: false });
    // Layout options go on the FIRST piece only: repeating width/position on later pieces makes pdfkit start a new line each time
    segs.forEach((s, k) => {
      doc.font(s.italic ? 'Times-Italic' : 'Times-Roman');
      const t = pdfSafe(s.text);
      if (k === 0) doc.text(t, left + indent, y, { width: W() - indent, continued: segs.length > 1, lineGap: 2 });
      else doc.text(t, { continued: k < segs.length - 1 });
    });
    doc.moveDown(0.35);
  });
  if (!pubs.length) doc.font('Helvetica').fillColor(MUTE).text('No publications for this selection.');
  return finish(ctx, new Date().toISOString().slice(0, 10));
}
