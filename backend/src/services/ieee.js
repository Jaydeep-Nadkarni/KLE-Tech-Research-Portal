// IEEE reference-style formatting of publications (IEEE Editorial Style Manual, "References").
// A reference is built from stored fields only. Missing fields are omitted, never invented.
import { Document, Packer, Paragraph, TextRun, AlignmentType, TabStopType } from 'docx';

const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
const TITLE_PREFIX = /^(dr|prof|mr|mrs|ms)\.?\s+/i;

const isInitials = (t) => /^([A-Z]\.?){1,4}$/.test(t);
const initialsOf = (parts) => parts.flatMap((p) => p.split(/[-\s.]+/).filter(Boolean)).map((p) => `${p[0].toUpperCase()}.`).join(' ');

/** "Manisha T. Tapale" | "Tapale M." | "M Tapale" | "Patil R.G." -> "M. T. Tapale" */
export function ieeeAuthor(raw) {
  const name = String(raw || '').replace(TITLE_PREFIX, '').replace(/\s+/g, ' ').trim().split(' ').map(unshout).join(' ');
  if (!name) return null;
  if (name.includes(',')) { // "Tapale, Manisha T."
    const [sur, given] = name.split(',').map((s) => s.trim());
    return given ? `${initialsOf(given.split(' '))} ${sur}` : sur;
  }
  const t = name.split(' ');
  if (t.length === 1) return t[0];
  const last = t.at(-1);
  if (t.length >= 2 && isInitials(last) && !isInitials(t[0])) { // "Surname Initials"
    const given = last.replace(/\./g, '').split('').map((c) => `${c}.`).join(' ');
    return `${given} ${t.slice(0, -1).join(' ')}`;
  }
  return `${initialsOf(t.slice(0, -1))} ${last}`;
}

export function ieeeAuthors(pub) {
  const list = (pub.authors || []).map((a) => ieeeAuthor(a.name)).filter(Boolean);
  const onlyFirstKnown = list.length === 1 && !(pub.providers || []).some((p) => ['openalex', 'crossref'].includes(p));
  if (!list.length) return { text: '', complete: false };
  if (list.length > 6 || onlyFirstKnown) return { text: `${list[0]} et al.`, complete: false };
  if (list.length === 1) return { text: list[0], complete: true };
  if (list.length === 2) return { text: `${list[0]} and ${list[1]}`, complete: true };
  return { text: `${list.slice(0, -1).join(', ')}, and ${list.at(-1)}`, complete: true };
}

const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'at', 'by', 'with', 'using', 'via', 'from', 'as', 'is']);
// Source data sometimes shouts. Title-case it (acronyms cannot be recovered, so none are guessed).
const sentenceCaseIfShouting = (t) => (t === t.toUpperCase() && /[A-Z]{4}/.test(t)
  ? t.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
  : t);
const unshout = (w) => (w.length > 3 && !w.includes('.') && /^[A-Z'-]+$/.test(w) ? w.charAt(0) + w.slice(1).toLowerCase() : w);
// Scopus appends series codes to volumes ("1997 LNNS"); only the number belongs in the reference
const cleanVolume = (v) => String(v || '').replace(/^(\d+)\s+[A-Z]{2,}$/, '$1');
const cleanTitle = (t) => sentenceCaseIfShouting(String(t || '').replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim());
const pagesText = (p) => { if (!p.pages) return p.articleNumber ? `Art. no. ${p.articleNumber}` : ''; const s = String(p.pages).replace(/\s/g, '').replace(/[-–—]+/g, '–'); return s.includes('–') ? `pp. ${s}` : `p. ${s}`; };
// A month is printed only when the full date is known. Scopus (and others) fill "01" when only the year or month
// is known, so a first-of-month date is treated as imprecise and the year alone is printed.
const monthOf = (p) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.date || '');
  return m && m[3] !== '01' && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? MONTHS[Number(m[2]) - 1] : null;
};
const dateText = (p) => [monthOf(p), p.year || /^(\d{4})/.exec(p.date || '')?.[1]].filter(Boolean).join(' ');

/** Returns segments [{text, italic}] so every output format can style the venue. */
export function ieeeSegments(pub) {
  const a = ieeeAuthors(pub);
  const seg = [];
  const push = (text, italic = false) => text && seg.push({ text, italic });
  const tail = (...parts) => parts.filter(Boolean).join(', ');
  if (a.text) push(`${a.text}, `);
  push(`\u201C${cleanTitle(pub.title)},\u201D `);
  const doi = pub.doi ? `doi: ${pub.doi}` : '';
  const v = cleanVolume(pub.volume);
  const vol = v ? `vol. ${v}` : '', no = pub.issue ? `no. ${pub.issue}` : '';
  if (pub.venueType === 'journal' && pub.venue) {
    push(pub.venue, true);
    push(', ' + tail(vol, no, pagesText(pub), dateText(pub), doi) + '.');
  } else if (pub.venueType === 'conference' && pub.venue) {
    push('in ');
    push(pub.venue.replace(/,\s*\d{4}\s*$/, ''), true);
    push(', ' + tail(vol, pagesText(pub), dateText(pub), doi) + '.');
  } else if (pub.venueType === 'book' && pub.venue) {
    push('in ');
    push(pub.venue, true);
    push(', ' + tail(pub.publisher, vol, dateText(pub), pagesText(pub), doi) + '.');
  } else {
    push(tail(pub.venue, pub.publisher, pagesText(pub), dateText(pub), doi) + '.');
  }
  // tidy ", ." produced when nothing followed the venue
  const out = seg.map((s) => ({ ...s, text: s.text.replace(/^, \.$/, '.').replace(/,\s*\./g, '.') }));
  // Nothing after the title: IEEE puts the full stop inside the closing quote
  const last = out.at(-1);
  if (out.length >= 2 && !last.italic && /^\s*\.\s*$/.test(last.text)) {
    const prev = out.at(-2);
    if (/,”\s*$/.test(prev.text)) { prev.text = prev.text.replace(/,”\s*$/, '.”'); out.pop(); }
  }
  return out;
}

export const ieeePlain = (pub) => ieeeSegments(pub).map((s) => s.text).join('').replace(/\s+/g, ' ').trim();

export function sortPubs(pubs, sort = 'year') {
  const key = (p) => (p.authors?.[0]?.name || p.title || '').toLowerCase();
  return [...pubs].sort(sort === 'author' ? (a, b) => key(a).localeCompare(key(b)) : (a, b) => (b.year || 0) - (a.year || 0) || (a.title || '').localeCompare(b.title || ''));
}

export const toTxt = (pubs, header) => `${header.join('\n')}\n\n${pubs.map((p, i) => `[${i + 1}] ${ieeePlain(p)}`).join('\n')}\n`;

const bibKey = (p, used) => {
  const sur = (ieeeAuthor(p.authors?.[0]?.name) || 'anon').split(' ').at(-1).replace(/[^A-Za-z]/g, '').toLowerCase() || 'anon';
  const word = (p.title || '').toLowerCase().replace(/[^a-z ]/g, '').split(' ').find((w) => w.length > 3) || 'paper';
  let k = `${sur}${p.year || ''}${word}`, n = 1;
  while (used.has(k)) k = `${sur}${p.year || ''}${word}${++n}`;
  used.add(k); return k;
};
const bibEsc = (s) => String(s || '').replace(/[{}]/g, '').replace(/&/g, '\\&').replace(/%/g, '\\%').replace(/_/g, '\\_');

/** BibTeX for use with IEEEtran.bst */
export function toBibtex(pubs) {
  const used = new Set();
  return pubs.map((p) => {
    const authors = (p.authors || []).map((a) => ieeeAuthor(a.name)).filter(Boolean).join(' and ');
    const type = p.venueType === 'journal' ? 'article' : p.venueType === 'conference' ? 'inproceedings' : p.venueType === 'book' ? 'incollection' : 'misc';
    const venueField = p.venueType === 'journal' ? 'journal' : 'booktitle';
    const mon = monthOf(p);
    const f = [
      authors && ['author', bibEsc(authors) + ((p.authors || []).length === 1 ? ' and others' : '')], ['title', `{${bibEsc(cleanTitle(p.title))}}`],
      p.venue && [venueField, bibEsc(p.venue)], p.volume && ['volume', bibEsc(p.volume)], p.issue && ['number', bibEsc(p.issue)],
      p.pages && ['pages', bibEsc(String(p.pages).replace(/[-–—]+/g, '--'))], p.publisher && ['publisher', bibEsc(p.publisher)],
      mon && ['month', mon.replace('.', '').toLowerCase()], p.year && ['year', String(p.year)], p.doi && ['doi', p.doi],
    ].filter(Boolean);
    return `@${type}{${bibKey(p, used)},\n${f.map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}`;
  }).join('\n\n') + '\n';
}

export async function toDocx(pubs, header, title = 'Publications') {
  const para = (children, opts = {}) => new Paragraph({ children, ...opts });
  const refs = pubs.map((p, i) => new Paragraph({
    tabStops: [{ type: TabStopType.LEFT, position: 540 }], indent: { left: 540, hanging: 540 }, spacing: { after: 100 }, alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: `[${i + 1}]\t`, size: 20, font: 'Times New Roman' }), ...ieeeSegments(p).map((s) => new TextRun({ text: s.text, italics: s.italic, size: 20, font: 'Times New Roman' }))],
  }));
  const doc = new Document({
    creator: 'KLE Research Portal', title,
    sections: [{ children: [
      para([new TextRun({ text: title, bold: true, size: 32, font: 'Times New Roman' })], { spacing: { after: 120 } }),
      ...header.map((h) => para([new TextRun({ text: h, size: 18, color: '555555', font: 'Times New Roman' })])),
      para([new TextRun('')], { spacing: { after: 160 } }),
      ...refs,
    ] }],
  });
  return Packer.toBuffer(doc);
}
