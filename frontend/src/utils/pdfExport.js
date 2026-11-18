// Full-page PDF: the page is rendered once at a fixed desktop width (so the PDF looks the same on any screen),
// then every card / stat-card group / chart is cropped from that image and laid out on A4 landscape pages.
// Small cards are paired side by side; blocks never split unless taller than a page.
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const SELECTOR = '.card, [data-pdf-group]';
const RENDER_WIDTH = 1360; // CSS px: wide enough for the desktop layout (sidebar + content)
const INK = [27, 36, 48], MUTE = [107, 119, 133], BRAND = [31, 78, 121];

function topLevelBlocks(root) {
  return [...root.querySelectorAll(SELECTOR)].filter((el) => {
    if (el.closest('[data-pdf-skip]')) return false;
    const parent = el.parentElement?.closest(SELECTOR);
    return !parent || !root.contains(parent);
  }).filter((el) => el.offsetWidth > 40 && el.offsetHeight > 20);
}

/** Renders `root` once and returns [{canvas, half}] for each top-level block, measured in the same render. */
export async function captureBlocks(root, scale = 1.5) {
  let layout = null;
  const full = await html2canvas(root, {
    scale, windowWidth: RENDER_WIDTH, backgroundColor: '#ffffff', useCORS: true, logging: false,
    onclone: (doc, cloned) => {
      // Interactive controls are meaningless on paper. Hide (do not remove) so positions stay exact.
      doc.querySelectorAll('.btn, select, input, button, [data-pdf-hide], .skeleton').forEach((n) => { n.style.visibility = 'hidden'; });
      const rr = cloned.getBoundingClientRect();
      layout = { w: rr.width, items: topLevelBlocks(cloned).map((el) => { const r = el.getBoundingClientRect(); return { x: r.left - rr.left, y: r.top - rr.top, w: r.width, h: r.height }; }) };
    },
  });
  if (!layout || !layout.items.length) return [];
  const k = full.width / layout.w; // pixels per CSS pixel actually rendered
  return layout.items.map((r) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * k)); c.height = Math.max(1, Math.round(r.h * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(full, Math.round(r.x * k), Math.round(r.y * k), c.width, c.height, 0, 0, c.width, c.height);
    return { c, half: r.w < layout.w * 0.62 };
  });
}

/**
 * @param root     element whose cards are exported (normally <main>)
 * @param options  { title, subtitle, filename, returnBlob }
 */
export async function exportPageToPdf(root, { title, subtitle = '', filename = 'page', returnBlob = false } = {}) {
  const shots = await captureBlocks(root);
  if (!shots.length) throw new Error('Nothing to export on this page yet.');

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight();
  const M = 28, GAP = 10, FOOT = 24;
  const colW = PW - M * 2, halfW = (colW - GAP) / 2;
  let y = M;

  pdf.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...BRAND).text('KLE TECHNOLOGICAL UNIVERSITY  |  RESEARCH PORTAL', M, y + 6);
  pdf.setFontSize(17).setTextColor(...INK).text(title || document.title, M, y + 26);
  pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTE);
  const sub = `${subtitle ? subtitle + '   |   ' : ''}Generated ${new Date().toISOString().slice(0, 10)}   |   Citation counts are per source and are never combined. N/A means not available, not zero.`;
  pdf.text(pdf.splitTextToSize(sub, colW), M, y + 40);
  y += 62;

  const avail = () => PH - FOOT - y;
  const newPage = () => { pdf.addPage(); y = M; };
  const place = (c, x, w) => { const h = (c.height / c.width) * w; pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, w, h); return h; };
  const sliceAcross = (c) => { // block taller than a page: cut it into page-height slices
    const scale = colW / c.width;
    const maxPx = Math.floor((PH - FOOT - M) / scale);
    for (let top = 0; top < c.height; top += maxPx) {
      if (y > M + 1) newPage();
      const hPx = Math.min(maxPx, c.height - top);
      const part = document.createElement('canvas'); part.width = c.width; part.height = hPx;
      part.getContext('2d').drawImage(c, 0, top, c.width, hPx, 0, 0, c.width, hPx);
      y += place(part, M, colW) + GAP;
    }
  };

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i], next = shots[i + 1];
    if (s.half && next?.half) { // pair two small blocks side by side
      const h = Math.max((s.c.height / s.c.width) * halfW, (next.c.height / next.c.width) * halfW);
      if (h > avail()) newPage();
      place(s.c, M, halfW); place(next.c, M + halfW + GAP, halfW);
      y += h + GAP; i++;
      continue;
    }
    const w = s.half ? halfW : colW;
    const h = (s.c.height / s.c.width) * w;
    if (h > PH - FOOT - M) { sliceAcross(s.c); continue; }
    if (h > avail()) newPage();
    place(s.c, M, w);
    y += h + GAP;
  }

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p).setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTE);
    pdf.text('KLE Technological University Research Portal', M, PH - 12);
    pdf.text(`Page ${p} of ${pages}`, PW - M, PH - 12, { align: 'right' });
  }
  const name = `${filename}-${new Date().toISOString().slice(0, 10)}.pdf`;
  if (returnBlob) return { pages, blocks: shots.length, bytes: pdf.output('arraybuffer').byteLength, name, shots };
  pdf.save(name);
  return { pages, blocks: shots.length, name };
}
