import { useMemo, useState, useEffect, useRef } from 'react';
import { Search, ArrowUp, ArrowDown, ExternalLink, RefreshCw, Loader2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api, errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, PageHeader, StatCard, Badge, ErrorState, Notice, TableSkeleton, EmptyState } from '../components/ui/Ui';
import { ChartCard, Bars } from '../components/charts/Charts';
import { n } from '../utils/format';
import PdfPageButton from '../components/PdfPageButton';

const COLS = [['title', 'Journal'], ['papers', 'Papers'], ['citeScore', 'CiteScore'], ['sjr', 'SJR'], ['snip', 'SNIP'], ['quartile', 'Quartile'], ['scopusStatus', 'Scopus source']];
const val = (r, k) => (['citeScore', 'sjr', 'snip', 'quartile'].includes(k) ? r[k]?.value ?? null : r[k]);

function Metric({ m, d = 2 }) {
  if (!m) return <span className="text-ink-mute">N/A</span>;
  return <span title={`${m.source}, reporting year ${m.year}`}>{typeof m.value === 'number' ? m.value.toFixed(d) : m.value}<span className="ml-1 text-[10px] text-ink-mute">{m.year}</span></span>;
}

function RefreshButton({ onDone }) {
  const [s, setS] = useState({ busy: false, msg: '' });
  const t = useRef();
  useEffect(() => () => clearInterval(t.current), []);
  const run = async () => {
    setS({ busy: true, msg: 'Starting…' });
    try {
      const { data } = await api.post('/sync/journals', {});
      t.current = setInterval(async () => {
        const j = (await api.get(`/sync/jobs/${data.job._id}`)).data.job;
        if (j.status === 'running' || j.status === 'queued') setS({ busy: true, msg: `${j.progress?.done || 0}/${j.progress?.total || '?'} journals` });
        else { clearInterval(t.current); setS({ busy: false, msg: j.status === 'completed' ? 'Metrics refreshed' : `Failed: ${j.error}` }); onDone(); }
      }, 2500);
    } catch (e) { setS({ busy: false, msg: errMsg(e) }); }
  };
  return <div className="flex items-center gap-2">{s.msg && <span className="text-xs text-ink-soft">{s.msg}</span>}<button className="btn" onClick={run} disabled={s.busy}>{s.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh from Scopus</button></div>;
}

export default function Journals() {
  const { isAdmin } = useAuth();
  const { data, loading, error, reload } = useApi('/admin/journal-analytics');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'papers', dir: 'desc' });
  const rows = useMemo(() => {
    const items = (data?.items || []).filter((r) => !q || (r.title + ' ' + (r.publisher || '')).toLowerCase().includes(q.toLowerCase()));
    return [...items].sort((a, b) => {
      const x = val(a, sort.key), y = val(b, sort.key);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; // N/A always last
      return (x > y ? 1 : x < y ? -1 : 0) * (sort.dir === 'asc' ? 1 : -1);
    });
  }, [data, q, sort]);
  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const sm = data?.summary;

  return (
    <div>
      <PageHeader title="Journals" description="Journals the faculty have published in, with Scopus CiteScore, SJR and SNIP. Quartiles need a SCImago import and are never estimated."
        actions={<><PdfPageButton title="Journals" filename="journals" disabled={loading} subtitle="CiteScore, SJR, SNIP (Scopus); quartiles (SCImago)" />{isAdmin && <RefreshButton onDone={reload} />}</>} />
      {error ? <ErrorState message={error} onRetry={reload} /> : (<>
        <div data-pdf-group className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard loading={loading && !data} label="Journals" value={n(sm?.journals)} hint="With an ISSN on record" />
          <StatCard loading={loading && !data} label="Found in Scopus" value={n(sm?.foundInScopus)} source="Scopus Serial Title API" />
          <StatCard loading={loading && !data} label="No Scopus source for ISSN" value={n(sm?.notFoundByIssn)} hint="Not proof of non-indexing" />
          <StatCard loading={loading && !data} label="With quartile" value={sm?.withQuartile ? n(sm.withQuartile) : 'N/A'} source={sm?.withQuartile ? 'SCImago' : undefined} hint={sm?.withQuartile ? undefined : 'No SCImago import yet'} />
        </div>
        {data && !data.metricsAvailability.quartile && <div className="mt-4"><Notice tone="warn">{data.metricsAvailability.reason} To enable quartiles, import a SCImago Journal Rank file: <code className="rounded bg-white px-1">node src/scripts/importScimago.js &lt;file.csv&gt; &lt;year&gt;</code>.</Notice></div>}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ChartCard title="Papers by journal CiteScore band" subtitle="Bands are a portal grouping of the latest Scopus CiteScore, not quartiles" loading={loading && !data} empty={!data?.citeScoreBands?.length} source="Scopus Serial Title API" height={220}>
            <Bars data={data?.citeScoreBands} series={[{ key: 'value', name: 'Papers' }]} />
          </ChartCard>
          <ChartCard title="Top publishers" loading={loading && !data} empty={!data?.publishers?.length} source="Crossref / OpenAlex" height={220}>
            <Bars layout="vertical" data={data?.publishers?.slice(0, 6)} series={[{ key: 'value', name: 'Papers' }]} />
          </ChartCard>
        </div>
        <div className="mt-4">
          <Card pad={false} title="Journal metrics">
            <div className="border-b border-line p-3"><div className="relative max-w-sm"><Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-mute" /><input className="input pl-8" placeholder="Search journal or publisher" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search journals" /></div></div>
            {loading && !data ? <TableSkeleton cols={6} /> : !rows.length ? <EmptyState title="No journals" hint="Run a journal refresh, or check the search term." /> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-[13px]">
                <thead><tr>{COLS.map(([k, label]) => <th key={k} className={`th cursor-pointer select-none ${['papers', 'citeScore', 'sjr', 'snip'].includes(k) ? 'text-right' : ''}`} onClick={() => sortBy(k)}>{label} {sort.key === k && (sort.dir === 'desc' ? <ArrowDown className="inline h-3 w-3" /> : <ArrowUp className="inline h-3 w-3" />)}</th>)}</tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas/60">
                    <td className="td max-w-sm"><span className="font-medium">{r.title}</span><div className="text-[11px] text-ink-mute">{r.publisher || 'Publisher N/A'} · ISSN {r.issn.join(', ')}</div>{r.subjectAreas.length > 0 && <div className="text-[11px] text-ink-mute">{r.subjectAreas.slice(0, 3).join(' · ')}</div>}</td>
                    <td className="td text-right tabular-nums">{r.papers}<div className="text-[11px] text-ink-mute">{r.scopusPapers} in Scopus</div></td>
                    <td className="td text-right tabular-nums"><Metric m={r.citeScore} d={1} /></td>
                    <td className="td text-right tabular-nums"><Metric m={r.sjr} d={3} /></td>
                    <td className="td text-right tabular-nums"><Metric m={r.snip} d={3} /></td>
                    <td className="td">{r.quartile ? <Badge tone="info" title={`${r.quartile.source}, ${r.quartile.year}`}>{r.quartile.value}</Badge> : <span className="text-ink-mute">N/A</span>}</td>
                    <td className="td">{r.scopusStatus === 'found' ? <div><Badge tone="good">Found</Badge>{r.coverage?.start && <div className="mt-0.5 text-[11px] text-ink-mute">Coverage {r.coverage.start}–{r.coverage.end || 'now'}</div>}{r.scopusUrl && <a className="inline-flex items-center gap-0.5 text-[11px] text-brand hover:underline" href={r.scopusUrl} target="_blank" rel="noreferrer">Scopus source<ExternalLink className="h-3 w-3" /></a>}</div> : <Badge tone="neutral" title="Scopus returned no source for this ISSN">No source found</Badge>}</td>
                  </tr>))}</tbody></table></div>)}
          </Card>
        </div>
        <p className="mt-3 text-[11px] text-ink-mute">CiteScore, SJR and SNIP are each shown with their reporting year, which differs from a paper's publication year. Journal Impact Factor and Journal Citation Indicator need a Clarivate licence and are not available. Conference proceedings are excluded.</p>
      </>)}
    </div>
  );
}
