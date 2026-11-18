import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Trophy } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { qs } from '../api/client';
import { PageHeader, StatCard, Card, ErrorState, Notice, Skeleton } from '../components/ui/Ui';
import { ChartCard, Bars, Areas, Donut } from '../components/charts/Charts';
import PdfPageButton from '../components/PdfPageButton';
import { n, dec, date, SOURCES } from '../utils/format';

const YEARS = Array.from({ length: new Date().getFullYear() - 2009 }, (_, i) => new Date().getFullYear() - i);

export default function Dashboard() {
  const [source, setSource] = useState('scopus');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const q = qs({ source, yearFrom, yearTo });
  const ov = useApi(`/admin/overview${q}`);
  const an = useApi(`/admin/analytics${q}`);
  const trends = useApi(`/admin/publication-trends${qs({ yearFrom, yearTo })}`);
  const c = ov.data?.cards;
  const srcLabel = SOURCES.find((s) => s.value === source).label;
  const cs = c?.citationsBySource || {};
  const L = ov.loading && !c;
  const a = an.data;

  const top = a?.facultyPublications?.[0];

  return (
    <div>
      <PageHeader title="Department research overview"
        description="Publications and citations for all active faculty, deduplicated across sources. Citation figures are reported per source and never added together."
        actions={<>
          <select className="input !w-auto" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Citation source for faculty metrics">{SOURCES.map((s) => <option key={s.value} value={s.value}>Faculty metrics: {s.label}</option>)}</select>
          <select className="input !w-auto" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} aria-label="From calendar year"><option value="">From year</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select>
          <select className="input !w-auto" value={yearTo} onChange={(e) => setYearTo(e.target.value)} aria-label="To calendar year"><option value="">To year</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select>
          <PdfPageButton title="Department research overview" filename="dashboard" disabled={L || an.loading} subtitle={`Faculty metrics: ${srcLabel}${yearFrom || yearTo ? `   |   Calendar years ${yearFrom || 'start'} to ${yearTo || 'present'}` : '   |   All years'}`} />
          <a className="btn" href={`/api/reports/export${qs({ type: 'department', format: 'pdf', source, yearFrom, yearTo })}`} title="Table report as PDF"><Download className="h-3.5 w-3.5" /> Table PDF</a>
          <a className="btn" href={`/api/reports/export${qs({ type: 'department', format: 'xlsx', source, yearFrom, yearTo })}`}><Download className="h-3.5 w-3.5" /> Excel</a>
        </>} />
      {(yearFrom || yearTo) && <div className="mb-4"><Notice>Filtered by publication <b>calendar year</b> {yearFrom || 'start'}–{yearTo || 'present'}. Academic years are not used.</Notice></div>}
      {ov.error && <div className="mb-4"><ErrorState message={ov.error} onRetry={ov.reload} /></div>}

      <div data-pdf-group className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard loading={L} label="Total faculty" value={n(c?.totalFaculty)} />
        <StatCard loading={L} label="Unique publications" value={n(c?.uniquePublications)} hint="Each paper counted once" />
        <StatCard loading={L} label="Publication links" value={n(c?.totalPublicationLinks)} hint="Shared papers counted per faculty" />
        <StatCard loading={L} label="Scopus publications" value={n(c?.scopusPublications)} source="Scopus" hint="Confirmed by Scopus record" />
        <StatCard loading={L} label="Web of Science publications" value={n(c?.webOfSciencePublications)} source="Web of Science" hint={c?.webOfScienceCoverage?.checked ? `${c.webOfScienceCoverage.checked} of ${c.webOfScienceCoverage.total} papers checked` : 'Not checked yet'} />
        <StatCard loading={L} label="Publications this year" value={n(c?.publicationsThisYear)} hint={`Calendar ${new Date().getFullYear()}`} />
        <StatCard loading={L} label="Citations · Scopus" value={n(cs.scopus?.total)} source="Scopus" hint={cs.scopus ? `${cs.scopus.papersWithData} papers` : undefined} />
        <StatCard loading={L} label="Citations · OpenAlex" value={n(cs.openalex?.total)} source="OpenAlex" hint={cs.openalex ? `${cs.openalex.papersWithData} papers` : undefined} />
        <StatCard loading={L} label="Citations · Semantic Scholar" value={n(cs.semanticscholar?.total)} source="Semantic Scholar" hint={cs.semanticscholar ? `${cs.semanticscholar.papersWithData} papers` : undefined} />
        <StatCard loading={L} label="Citations · Crossref" value={n(cs.crossref?.total)} source="Crossref" hint={cs.crossref ? `${cs.crossref.papersWithData} papers` : undefined} />
        <StatCard loading={L} label="Citations · Google Scholar" value={n(c?.googleScholar?.totalCitations)} source="Google Scholar profiles" hint={c?.googleScholar ? (c.googleScholar.facultyWithData ? `${c.googleScholar.facultyWithData} of ${c.googleScholar.facultyTotal} faculty${c.googleScholar.unverified ? `, ${c.googleScholar.unverified} unverified` : ''}` : 'No profile data yet') : undefined} />
        <StatCard loading={L} label="Average h-index" value={dec(c?.averageHIndex, 1)} source={srcLabel} hint={source === 'googlescholar' ? 'Reported by profiles' : 'Portal-calculated'} />
        <StatCard loading={L} label="Median h-index" value={n(c?.medianHIndex)} source={srcLabel} hint={source === 'googlescholar' ? 'Reported by profiles' : 'Portal-calculated'} />
        <StatCard loading={L} label="Avg citations / faculty" value={dec(c?.averageCitationsPerFaculty, 1)} source={srcLabel} hint={c?.averageCitationsBasis?.totalCitations != null ? `${n(c.averageCitationsBasis.totalCitations)} citations ÷ ${c.averageCitationsBasis.faculty} faculty` : undefined} />
        {['Q1', 'Q2', 'Q3', 'Q4'].map((qq) => c?.quartiles?.available
          ? <StatCard key={qq} loading={L} label={`${qq} publications`} value={n(c.quartiles[qq])} source="SCImago" hint={`of ${c.quartiles.journalPapersWithQuartile} journal papers`} />
          : <StatCard key={qq} loading={L} label={`${qq} publications`} value="N/A" hint="Needs SCImago import" />)}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Publications by year" loading={an.loading && !a} empty={!a?.pubsByYear?.length} source="Portal database (unique papers, by publication year)">
          <Bars data={a?.pubsByYear} x="year" series={[{ key: 'count', name: 'Publications' }]} />
        </ChartCard>
        <ChartCard title="Citations received by year" loading={an.loading && !a} empty={!a?.citationsByYear?.length} source={a?.citationsByYearSource} subtitle="Year the citation was received, not the paper's publication year">
          <Areas data={a?.citationsByYear} series={[{ key: 'count', name: 'Citations' }, { key: 'cumulative', name: 'Cumulative' }]} />
        </ChartCard>
        <ChartCard title="Faculty-wise publications" loading={an.loading && !a} empty={!a?.facultyPublications?.length} height={Math.max(260, (a?.facultyPublications?.length || 0) * 34)} source="Portal database">
          <Bars layout="vertical" data={a?.facultyPublications} series={[{ key: 'scopus', name: 'In Scopus' }, { key: 'papers', name: 'All papers' }]} />
        </ChartCard>
        <ChartCard title={`Faculty-wise citations (${srcLabel})`} loading={an.loading && !a} empty={!a?.facultyCitations?.some((x) => x.citations != null)} height={Math.max(260, (a?.facultyCitations?.length || 0) * 34)} source={srcLabel}>
          <Bars layout="vertical" data={a?.facultyCitations?.filter((x) => x.citations != null)} series={[{ key: 'citations', name: 'Citations' }]} />
        </ChartCard>
        <ChartCard title={`Faculty-wise h-index (${srcLabel})`} loading={an.loading && !a} empty={!a?.facultyHIndex?.some((x) => x.hIndex != null)} subtitle="Portal-calculated from stored citation counts" height={Math.max(260, (a?.facultyHIndex?.length || 0) * 34)}>
          <Bars layout="vertical" data={a?.facultyHIndex?.filter((x) => x.hIndex != null)} series={[{ key: 'hIndex', name: 'h-index' }]} />
        </ChartCard>
        <ChartCard title="Scopus indexing status" loading={an.loading && !a} empty={!a?.indexingDistribution?.some((d) => d.value)} source="Scopus records; Web of Science is not available">
          <Donut data={a?.indexingDistribution?.filter((d) => d.value)} />
        </ChartCard>
        <ChartCard title="Journal quartile distribution" loading={an.loading && !a} empty={!a?.quartiles?.available} emptyHint={a?.quartiles?.note} subtitle={a?.quartiles?.available ? a.quartiles.note : undefined} source="SCImago Journal Rank">
          <Bars data={['Q1', 'Q2', 'Q3', 'Q4'].map((k) => ({ name: k, value: a?.quartiles?.[k] }))} series={[{ key: 'value', name: 'Journal papers' }]} />
        </ChartCard>
        <ChartCard title="Publication types" loading={an.loading && !a} empty={!a?.publicationTypes?.length} source="Provider metadata">
          <Donut data={a?.publicationTypes?.slice(0, 6)} />
        </ChartCard>
        <ChartCard title="Publisher distribution" loading={an.loading && !a} empty={!a?.publishers?.length} height={320} source="Crossref / OpenAlex" subtitle="Top publishers by paper count">
          <Bars layout="vertical" data={a?.publishers?.slice(0, 10)} series={[{ key: 'value', name: 'Papers' }]} />
        </ChartCard>
        <ChartCard title="Research domains" loading={an.loading && !a} empty={!a?.researchAreas?.length} height={320} source="OpenAlex topics / Semantic Scholar fields">
          <Bars layout="vertical" data={a?.researchAreas?.slice(0, 10)} series={[{ key: 'value', name: 'Papers' }]} />
        </ChartCard>
        <ChartCard title="International collaboration" loading={an.loading && !a} empty={a?.internationalCollaboration?.papers == null} height={320} source={a?.internationalCollaboration?.source}
          subtitle={a?.internationalCollaboration?.papers != null ? `${a.internationalCollaboration.papers} of ${a.internationalCollaboration.papersWithCountryData} papers with country data have a co-author outside India` : undefined}>
          <Bars layout="vertical" data={a?.internationalCollaboration?.topCountries} series={[{ key: 'value', name: 'Papers' }]} />
        </ChartCard>
        <Card title="Department productivity" subtitle="Raw counts are not a measure of individual research quality">
          {a ? (
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div><dt className="text-xs text-ink-soft">Faculty</dt><dd className="mt-1 text-xl font-semibold">{a.productivity.facultyCount}</dd></div>
              <div><dt className="text-xs text-ink-soft">Unique papers</dt><dd className="mt-1 text-xl font-semibold">{a.productivity.uniquePublications}</dd></div>
              <div><dt className="text-xs text-ink-soft">Papers / faculty</dt><dd className="mt-1 text-xl font-semibold">{dec(a.productivity.papersPerFaculty)}</dd></div>
              <div className="col-span-3 border-t border-line pt-3 text-xs text-ink-soft">
                {top && <p className="flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5 text-amber-600" />Highest output in selection: <Link className="font-medium text-brand hover:underline" to="/faculty">{top.name}</Link> ({top.papers} papers).</p>}
                <p className="mt-1">Open access: {a.openAccess.yes} of {a.openAccess.known} papers with a known status.</p>
              </div>
            </dl>
          ) : <Skeleton className="h-24 w-full" />}
        </Card>
      </div>

      <div className="mt-4">
        <ChartCard title="Publication trend by faculty" subtitle="Papers per publication year, stacked by faculty (shared papers appear under each author)" loading={trends.loading && !trends.data} empty={!trends.data?.series?.length} height={300} source="Portal database">
          <Bars stacked data={trends.data?.series} x="year" series={(trends.data?.faculty || []).map((f) => ({ key: f, name: f }))} />
        </ChartCard>
      </div>
      <p className="mt-4 text-[11px] text-ink-mute">As of {date(ov.data?.asOf)}. Metrics are computed from stored records; open the <Link className="text-brand hover:underline" to="/definitions">definitions</Link> for how each is calculated.</p>
    </div>
  );
}
