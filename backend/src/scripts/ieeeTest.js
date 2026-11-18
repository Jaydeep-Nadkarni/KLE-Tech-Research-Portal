// Unit tests for IEEE formatting (no database needed).
import { ieeeAuthor, ieeeAuthors, ieeePlain, toBibtex, toTxt, toDocx } from '../services/ieee.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = got === want; ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got:  ${got}\n   want: ${want}`}`); };

eq('given-first with middle initial', ieeeAuthor('Manisha T. Tapale'), 'M. T. Tapale');
eq('Scopus surname+initials', ieeeAuthor('Tapale M.'), 'M. Tapale');
eq('surname + two initials', ieeeAuthor('Patil R.G.'), 'R. G. Patil');
eq('initial + surname (Scholar)', ieeeAuthor('M Tapale'), 'M. Tapale');
eq('comma form', ieeeAuthor('Khanai, Rajashri'), 'R. Khanai');
eq('strips Dr. prefix', ieeeAuthor('Dr. R H Goudar'), 'R. H. Goudar');
eq('three authors use Oxford "and"', ieeeAuthors({ authors: [{ name: 'A B Cee' }, { name: 'D Eff' }, { name: 'G Aitch' }], providers: ['openalex'] }).text, 'A. B. Cee, D. Eff, and G. Aitch');
eq('two authors', ieeeAuthors({ authors: [{ name: 'A Cee' }, { name: 'D Eff' }], providers: ['crossref'] }).text, 'A. Cee and D. Eff');
eq('more than six -> et al.', ieeeAuthors({ authors: Array.from({ length: 7 }, (_, i) => ({ name: `A Name${i}` })), providers: ['openalex'] }).text, 'A. Name0 et al.');
eq('only first author known (Scopus) -> et al., not a fake complete list', ieeeAuthors({ authors: [{ name: 'Tapale M.' }], providers: ['scopus'] }).text, 'M. Tapale et al.');

const journal = { title: 'AI-Driven Rubrics for Academic Grading', authors: [{ name: 'Rudragouda G. Patil' }, { name: 'Manisha T. Tapale' }], providers: ['openalex'], venueType: 'journal', venue: 'International Journal of Modern Education and Computer Science', volume: '18', issue: '4', pages: '1-24', date: '2026-08-01', year: 2026, doi: '10.5815/ijmecs.2026.04.01' };
eq('journal article (first-of-month date = imprecise, so year only)', ieeePlain(journal), 'R. G. Patil and M. T. Tapale, “AI-Driven Rubrics for Academic Grading,” International Journal of Modern Education and Computer Science, vol. 18, no. 4, pp. 1–24, 2026, doi: 10.5815/ijmecs.2026.04.01.');
eq('month printed when the full date is known', ieeePlain({ ...journal, date: '2026-08-15' }).includes('pp. 1–24, Aug. 2026,'), true);
const conf = { title: 'Incentive-Based Proof of Collaboration', authors: [{ name: 'A Cee' }, { name: 'B Dee' }], providers: ['crossref'], venueType: 'conference', venue: 'Lecture Notes in Networks and Systems', pages: '250-260', year: 2026 };
eq('Scopus series code stripped from volume', ieeePlain({ ...conf, volume: '1997 LNNS' }).includes('vol. 1997,') && !ieeePlain({ ...conf, volume: '1997 LNNS' }).includes('LNNS,'), true);
eq('ALL-CAPS surname normalised', ieeeAuthor('N. MUCHANDI'), 'N. Muchandi');
eq('ALL-CAPS title becomes Title Case', ieeePlain({ title: 'A SURVEY ON DATA ENCRYPTION USING DNA', authors: [], providers: [], venueType: 'unknown' }), '“A Survey on Data Encryption using Dna.”');
eq('conference paper', ieeePlain(conf), 'A. Cee and B. Dee, “Incentive-Based Proof of Collaboration,” in Lecture Notes in Networks and Systems, pp. 250–260, 2026.');
eq('missing fields are omitted, not invented', ieeePlain({ title: 'Bare Title', authors: [], providers: [], venueType: 'unknown' }), '“Bare Title.”');
eq('no "N/A" or "undefined" ever appears', /N\/A|undefined|null/.test(ieeePlain({ title: 'T', providers: [], venueType: 'journal', venue: 'J' })), false);

const bib = toBibtex([journal, conf]);
eq('BibTeX article + inproceedings', /@article\{patil2026aidriven,[\s\S]*journal = \{International Journal[\s\S]*@inproceedings\{cee2026incentivebased/.test(bib), true);
eq('txt numbering', toTxt([journal, conf], ['H']).includes('[2] A. Cee and B. Dee'), true);
const buf = await toDocx([journal, conf], ['H1', 'H2'], 'Test');
eq('docx is a valid zip (PK header)', buf.slice(0, 2).toString(), 'PK');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
