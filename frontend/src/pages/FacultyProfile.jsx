import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { RefreshCw, Loader2, ExternalLink, Download } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api, qs, errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, PageHeader, StatCard, Badge, ErrorState, Notice, Skeleton } from '../components/ui/Ui';
import { ChartCard, Bars, Areas, Donut } from '../components/charts/Charts';
import PublicationTable from '../components/PublicationTable';
import ScholarCard from '../components/ScholarCard';
import PdfPageButton from '../components/PdfPageButton';
import { n, dec, dateTime, ago } from '../utils/format';

const ID_TONE = { verified: 'good', unverified: 'warn', conflict: 'bad', rejected: 'neutral' };
const idLink = { scopus: (v) => `https://www.scopus.com/authid/detail.uri?authorId=${v}`, orcid: (v) => `https://orcid.org/${v}`, scholar: (v) => `https://scholar.google.com/citations?user=${v}` };
const YEARS = Array.from({ length: new Date().getFullYear() - 2009 }, (_, i) => new Date().getFullYear() - i);

function SyncButton({ id, onDone }) {
  const [state, setState] = useState({ busy: false, msg: '' });
  const timer = useRef();
  useEffect(() => () => clearInterval(timer.current), []);
  const run = async () => {
    setState({ busy: true, msg: 'Starting…' });
    try {
      const { data } = await api.post(`/sync/researcher/${id}`);
      timer.current = setInterval(async () => {
        const j = (await api.get(`/sync/jobs/${data.job._id}`)).data.job;
        if (j.status === 'completed' || j.status === 'failed') {
          clearInterval(timer.current);
          setState({ busy: false, msg: j.status === 'completed' ? 'Sync complete' : `Sync failed: ${j.error}` });
          onDone();
        } else setState({ busy: true, msg: 'Synchronizing…' });
      }, 2500);
    } catch (e) { setState({ busy: false, msg: errMsg(e) }); }
  };
  return (<div className="flex items-center gap-2">{state.msg && <span className="text-xs text-ink-soft">{state.msg}</span>}
    <button className="btn" onClick={run} disabled={state.busy}>{state.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now</button></div>);
}

export default function FacultyProfile() {
  const { id } = useParams();
  const { isAdmin, user, canViewAll: canViewAllUsers } = useAuth();
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const prof = useApi(`/researchers/${id}/profile`);
  const met = useApi(`/researchers/${id}/metrics${qs({ yearFrom, yearTo })}`);
  const col = useApi(`/researchers/${id}/collaborations`);
  const ca = useApi(`/researchers/${id}/coauthors?limit=10`);
  const sch = useApi(`/researchers/${id}/scholar`);
  const reload = () => { prof.reload(); met.reload(); col.reload(); sch.reload(); ca.reload(); };
  const sp = sch.data?.profile;
  const spNote = sch.data ? (sch.data.status === 'api' ? 'Via API' : sch.data.status === 'manual_verified' ? 'Manual, verified' : sch.data.status === 'manual_pending' ? 'Manual, unverified' : 'Unavailable') : undefined;

  if (prof.error) return <ErrorState message={prof.error} onRetry={prof.reload} />;
  const f = prof.data?.faculty;
  const m = met.data?.metrics;
  const L = met.loading && !m;
  const ids = prof.data?.identifiers?.filter((i) => ['scopus', 'orcid', 'scholar'].includes(i.type) && i.status !== 'rejected') || [];
  const lastSync = f && Object.values(f.sync || {}).map((s) => s.lastSuccessAt).filter(Boolean).sort().at(-1);
  const oa = f?.profiles?.openalex;

  return (
    <div>
      <PageHeader title={f?.name || 'Loading…'} description={f ? `${f.designation} · ${f.department}` : undefined}
        actions={f && <>
          <PdfPageButton title={`${f.name}: research profile`} filename={`profile-${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} disabled={met.loading || sch.loading} subtitle={`${f.designation}   |   ${f.email}${yearFrom || yearTo ? `   |   Calendar years ${yearFrom || 'start'} to ${yearTo || 'present'}` : ''}`} />
          <a className="btn" href={`/api/reports/export${qs({ type: 'faculty', format: 'pdf', facultyId: id, yearFrom, yearTo })}`} title="Publication table as PDF"><Download className="h-3.5 w-3.5" /> Table PDF</a>
          <a className="btn" href={`/api/reports/ieee${qs({ format: 'pdf', facultyId: id, yearFrom, yearTo })}`} title="Publication list in IEEE reference format (PDF)"><Download className="h-3.5 w-3.5" /> IEEE PDF</a>
          <a className="btn" href={`/api/reports/export${qs({ type: 'faculty', format: 'xlsx', facultyId: id, yearFrom, yearTo })}`}><Download className="h-3.5 w-3.5" /> Excel</a>
          {isAdmin && <SyncButton id={id} onDone={reload} />}
        </>} />

      <Card title="Researcher identity" subtitle={f ? `${f.email} · Last synchronized ${ago(lastSync)}` : undefined}>
        {!f ? <Skeleton className="h-16 w-full" /> : (
          <div className="grid gap-4 md:grid-cols-2">
            <table className="w-full text-[13px]"><tbody>
              {ids.map((i) => (
                <tr key={i._id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 text-xs capitalize text-ink-soft">{i.type === 'scholar' ? 'Google Scholar' : i.type === 'orcid' ? 'ORCID' : 'Scopus Author ID'}</td>
                  <td className="py-2 pr-3"><a className="inline-flex items-center gap-1 text-brand hover:underline" href={idLink[i.type](i.value)} target="_blank" rel="noreferrer">{i.value}<ExternalLink className="h-3 w-3" /></a></td>
                  <td className="py-2"><Badge tone={ID_TONE[i.status]} title={i.note}>{i.status === 'conflict' ? 'Conflict: needs admin' : i.status}</Badge></td>
                </tr>))}
            </tbody></table>
            <div className="space-y-2 text-xs text-ink-soft">
              <p><span className="font-medium text-ink">Profile verification:</span> <Badge tone={f.profileVerification === 'verified' ? 'good' : 'warn'}>{f.profileVerification}</Badge></p>
              <p><span className="font-medium text-ink">Sync:</span> {['scopus', 'orcid', 'openalex', 'googlescholar'].map((k) => { const s = f.sync?.[k]; return <Badge key={k} tone={s?.status === 'success' ? 'good' : s?.status === 'failed' ? 'bad' : 'neutral'} title={s?.error}>{k}: {s?.status || 'not run'}</Badge>; })}</p>
              <p><span className="font-medium text-ink">Affiliation (OpenAlex):</span> {oa?.institutions?.join(', ') || 'N/A'}</p>
              <p><span className="font-medium text-ink">Google Scholar:</span> {spNote || 'checking…'}{f.scholarProfileUrl && <> · <a className="text-brand hover:underline" href={f.scholarProfileUrl} target="_blank" rel="noreferrer">open profile</a></>}. Details below.</p>
            </div>
          </div>
        )}
        {ids.some((i) => i.status === 'conflict') && <div className="mt-3"><Notice tone="warn">One or more identifiers conflict with another faculty member. Automated lookups using them are paused until an administrator verifies the correct owner.</Notice></div>}
      </Card>

      <div className="my-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-2">Research metrics</h2>
        <select className="input !w-auto" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} aria-label="From calendar year"><option value="">From year</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select>
        <select className="input !w-auto" value={yearTo} onChange={(e) => setYearTo(e.target.value)} aria-label="To calendar year"><option value="">To year</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select>
        {(yearFrom || yearTo) && <span className="text-xs text-ink-mute">Calendar years (publication year)</span>}
      </div>
      {met.error ? <ErrorState message={met.error} onRetry={met.reload} /> : (
        <div data-pdf-group className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <StatCard loading={L} label="Total publications" value={n(m?.totalPublications)} hint="Unique across sources" />
          <StatCard loading={L} label="Scopus publications" value={n(m?.scopusPublications)} source="Scopus" />
          <StatCard loading={L} label="Web of Science publications" value={n(m?.webOfSciencePublications)} source="Web of Science" hint={m?.webOfScienceCoverage?.checked ? `${m.webOfScienceCoverage.checked} of ${m.webOfScienceCoverage.total} papers checked` : 'Not checked yet'} />
          <StatCard loading={L} label="Citations" value={n(m?.citations?.webofscience?.total)} source="Web of Science" hint={m?.citations?.webofscience ? `${m.citations.webofscience.papersWithData} papers` : 'Not available yet'} />
          <StatCard loading={L} label="Citations" value={n(m?.citations?.scopus?.total)} source="Scopus" hint={m?.citations?.scopus ? `${dec(m.citations.scopus.perPaper, 2)} per paper` : undefined} />
          <StatCard loading={L} label="Citations" value={n(m?.citations?.openalex?.total)} source="OpenAlex" hint={m?.citations?.openalex ? `${dec(m.citations.openalex.perPaper, 2)} per paper` : undefined} />
          <StatCard loading={L} label="Citations" value={n(m?.citations?.semanticscholar?.total)} source="Semantic Scholar" hint={m?.citations?.semanticscholar ? `${m.citations.semanticscholar.papersWithData} papers covered` : undefined} />
          <StatCard loading={L} label="Citations" value={n(sp?.totalCitations?.all)} source="Google Scholar" hint={spNote} />
          <StatCard loading={L} label="h-index" value={n(sp?.hIndex?.all)} source="Google Scholar" hint={spNote} />
          <StatCard loading={L} label="i10-index" value={n(sp?.i10Index?.all)} source="Google Scholar" hint={spNote} />
          <StatCard loading={L} label="h-index" value={n(m?.indices?.scopus?.h)} source="Scopus data" hint="Portal-calculated" />
          <StatCard loading={L} label="i10-index" value={n(m?.indices?.scopus?.i10)} source="Scopus data" hint="Portal-calculated" />
          <StatCard loading={L} label="h-index" value={n(m?.providerReported?.hIndex)} source="OpenAlex" hint="Provider-reported, all years" />
          <StatCard loading={L} label="Open-access papers" value={n(m?.openAccess?.yes)} hint={m ? `of ${m.openAccess.known} with known status` : undefined} />
          <StatCard loading={L} label="International collaborations" value={n(m?.internationalCollaboration?.papers)} source="OpenAlex" hint={m?.internationalCollaboration?.papersWithCountryData ? `of ${m.internationalCollaboration.papersWithCountryData} papers` : 'No country data'} />
          {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => <StatCard key={q} loading={L} label={`${q} publications`} value={m?.quartiles?.available ? n(m.quartiles[q]) : 'N/A'} source={m?.quartiles?.available ? 'SCImago' : undefined} hint={m?.quartiles?.available ? undefined : 'Needs SCImago import'} />)}
          <StatCard loading={L} label="Publications this year" value={n(m?.thisYear)} />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Publications by year" loading={L} empty={!m?.pubsByYear.length} source="Portal database"><Bars data={m?.pubsByYear} x="year" series={[{ key: 'count', name: 'Publications' }]} /></ChartCard>
        <ChartCard title="Citations by year and cumulative growth" loading={L} empty={!m?.citationsByYear.length} source={m?.citationsByYearSource} subtitle="Year the citation was received"><Areas data={m?.citationsByYear} series={[{ key: 'count', name: 'Citations in year' }, { key: 'cumulative', name: 'Cumulative' }]} /></ChartCard>
        <ChartCard title="Indexed publication distribution" loading={L} empty={!m?.indexingDistribution.some((d) => d.value)} source="Scopus records"><Donut data={m?.indexingDistribution.filter((d) => d.value)} /></ChartCard>
        <ChartCard title="Journal quartile distribution" loading={L} empty={!m?.quartiles.available} emptyHint={m?.quartiles.note} source="SCImago Journal Rank" subtitle={m?.quartiles.available ? m.quartiles.note : undefined}>
          <Bars data={['Q1', 'Q2', 'Q3', 'Q4'].map((k) => ({ name: k, value: m?.quartiles[k] }))} series={[{ key: 'value', name: 'Journal papers' }]} />
        </ChartCard>
        <ChartCard title="Publication types" loading={L} empty={!m?.publicationTypes.length} source="Provider metadata"><Donut data={m?.publicationTypes.slice(0, 6)} /></ChartCard>
        <ChartCard title="Research areas" loading={L} empty={!m?.researchAreas.length} source="OpenAlex / Semantic Scholar" emptyHint="No research-field data for these papers yet."><Bars layout="vertical" data={m?.researchAreas.slice(0, 8)} series={[{ key: 'value', name: 'Papers' }]} /></ChartCard>
      </div>

      <div className="mt-6"><ScholarCard id={id} sc={sch.data} canEdit={isAdmin || user.faculty === id} isAdmin={isAdmin} reload={reload} /></div>

      <div className="mt-6"><PublicationTable basePath={`/researchers/${id}/publications`} title="Publications" /></div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Top collaborating countries" subtitle="Countries of co-author institutions (excluding India)">
          {col.loading && !col.data ? <Skeleton className="h-20 w-full" /> : !col.data?.international?.topCountries?.length ? <p className="text-sm text-ink-mute">N/A: no country data available.</p> :
            <div className="flex flex-wrap gap-1.5">{col.data.international.topCountries.map((c) => <Badge key={c.name} tone="info">{c.name} · {c.value}</Badge>)}</div>}
        </Card>
        <Card title="Frequent co-authors" subtitle={ca.data ? `${ca.data.total} distinct co-authors. Class = affiliation on the paper.` : undefined}
          actions={canViewAllUsers && <Link className="text-xs text-brand hover:underline" to="/coauthors">All co-authors</Link>}>
          {ca.loading && !ca.data ? <Skeleton className="h-20 w-full" /> : !ca.data?.items?.length ? <p className="text-sm text-ink-mute">N/A: no co-author data for this person's papers.</p> :
            <>
              <div className="mb-2 flex flex-wrap gap-1.5">{Object.entries(ca.data.summary).filter(([, v]) => v > 0).map(([k, v]) => <Badge key={k} tone={k === 'department' ? 'good' : k === 'unknown' ? 'warn' : 'neutral'}>{ca.data.labels[k]}: {v}</Badge>)}</div>
              <ul className="space-y-1 text-[13px]">{ca.data.items.slice(0, 10).map((c) => <li key={c.key} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{c.name} <span className="text-[11px] text-ink-mute">{c.classLabel}</span></span><span className="tabular-nums text-ink-soft">{c.papers}</span></li>)}</ul>
            </>}
        </Card>
      </div>
      {m?.indices?.scopus && <p className="mt-3 text-[11px] text-ink-mute">{m.indices.scopus.source}. Last metrics calculation: {dateTime(met.data.asOf)}.</p>}
    </div>
  );
}
