import { PageHeader, Card } from '../components/ui/Ui';

const DEFS = [
  ['Unique publications', 'Papers deduplicated across Scopus, OpenAlex, ORCID, Crossref and Semantic Scholar. Matching is by DOI, then Scopus EID, then identical normalized title within one year. Similar-but-not-identical titles are flagged for review, never merged automatically.'],
  ['Publication links', 'Faculty-to-paper associations. A paper co-authored by three faculty is 1 unique publication and 3 links.'],
  ['Scopus publications', 'Papers backed by an actual Scopus record (it has a Scopus EID). A paper that merely appears in ORCID, OpenAlex, Crossref or Google Scholar is not counted as Scopus-indexed. Papers found elsewhere are checked against Scopus by DOI.'],
  ['Citations (per source)', 'The cited-by count reported by one provider. Providers use different corpora, so counts differ and are never added together. N/A means the provider returned no figure; it does not mean zero.'],
  ['h-index (portal-calculated)', 'The largest h such that h papers each have at least h citations, computed by this portal from the stored citation counts of the faculty member\'s papers for the selected source. It is not the provider\'s official figure. OpenAlex\'s own h-index is shown separately and labelled.'],
  ['i10-index (portal-calculated)', 'Number of papers with at least 10 citations in the selected source.'],
  ['Citations by year', 'Citations received in each calendar year, from OpenAlex per-paper yearly counts. It is not the publication year of the cited paper.'],
  ['International collaboration', 'Papers where OpenAlex lists at least one co-author institution outside India. Papers without country data are excluded from the denominator and the count is shown against it.'],
  ['CiteScore, SJR, SNIP', 'Journal-level metrics from the Scopus Serial Title API, stored with the reporting year they belong to and the retrieval date. They describe the journal in that year, not the individual paper, and the year usually differs from the paper\'s publication year.'],
  ['Journal quartile (Q1-Q4)', 'Shown only after a SCImago Journal Rank file has been imported; Scopus does not return quartiles at this API access level and the portal never estimates them. A journal can hold different quartiles in different subject categories and years, so the portal uses SCImago\'s best quartile for the reporting year nearest the paper\'s publication year. Quartiles never apply to conference papers.'],
  ['Journal Impact Factor / JCI', 'Not available: these require a Clarivate licence.'],
  ['CiteScore bands', 'A portal grouping of the latest Scopus CiteScore (below 1, 1 to under 3, 3 to under 5, 5 or more). It is not a quartile and is not a ranking within a subject category.'],
  ['Web of Science', 'A paper counts as Web of Science-indexed only when a real Web of Science record exists for it: found through the Clarivate API by DOI, or present in an administrator-imported Web of Science export. Counts show N/A until papers have been checked, never 0. "Not found" through the API means not found in the data available to this portal; it is not proof the paper is outside Web of Science. Papers without a DOI cannot be checked through the API. Citation counts are Web of Science Core Collection figures, separate from every other source.'],
  ['Google Scholar', 'Google provides no public API and forbids automated access, so the portal never scrapes it. Scholar data arrives either through a licensed third-party provider (SerpApi, when a key is configured) or is entered by hand from the public profile. Every Scholar figure is labelled "Via API", "Manual, verified" or "Manual, unverified". Faculty-submitted figures stay unverified until an administrator approves them.'],
  ['Google Scholar h-index / i10 / citations', 'The numbers Google Scholar itself shows on a profile. They are reported, not calculated by this portal, and they count papers that other sources may not know about. "Since" columns cover the stated year onwards.'],
  ['Google Scholar "Listed"', 'The paper appears on that person\'s Scholar profile. It says nothing about Scopus or Web of Science indexing.'],
  ['Calendar vs academic year', 'All year filters use the publication calendar year.'],
  ['Research output caveat', 'Publication counts and citation metrics are not a definitive measure of an individual\'s research quality.'],
];

export default function Definitions() {
  return (
    <div>
      <PageHeader title="Metric definitions" description="How every number in this portal is produced, and what it does not mean." />
      <Card pad={false}><dl className="divide-y divide-line">{DEFS.map(([t, d]) => <div key={t} className="grid gap-1 px-4 py-3 md:grid-cols-[240px_1fr] md:gap-6"><dt className="text-[13px] font-semibold">{t}</dt><dd className="text-[13px] leading-relaxed text-ink-soft">{d}</dd></div>)}</dl></Card>
    </div>
  );
}
