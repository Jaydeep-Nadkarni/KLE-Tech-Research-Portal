import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Download, ArrowDown, ArrowUp, GitCompare } from 'lucide-react';
import { useApi, useDebounced } from '../hooks/useApi';
import { qs } from '../api/client';
import { Card, PageHeader, ErrorState, EmptyState, Pagination, TableSkeleton, Badge, Notice } from '../components/ui/Ui';
import { ChartCard, Lines, Bars } from '../components/charts/Charts';
import { n, ago, SOURCES } from '../utils/format';
import PdfPageButton from '../components/PdfPageButton';

const YEARS = Array.from({ length: new Date().getFullYear() - 2009 }, (_, i) => new Date().getFullYear() - i);
const COLS = [
  ['name', 'Faculty'], ['totalPapers', 'Total papers'], ['scopusPapers', 'Scopus papers'], ['webOfSciencePapers', 'WoS papers'],
  ['citations', 'Citations'], ['hIndex', 'h-index'], ['i10Index', 'i10-index'], ['q1', 'Q1'], ['q2', 'Q2'], ['q3', 'Q3'], ['q4', 'Q4'], ['lastSynchronized', 'Last synced'],
];
const SORTABLE = new Set(['name', 'totalPapers', 'scopusPapers', 'citations', 'hIndex', 'i10Index', 'lastSynchronized']);

export default function FacultyList() {
  const [f, setF] = useState({ q: '', designation: '', source: 'scopus', yearFrom: '', yearTo: '', sort: 'totalPapers', order: 'desc', page: 1 });
  const [picked, setPicked] = useState([]);
  const q = useDebounced(f.q);
  const set = (p) => setF((s) => ({ ...s, page: 1, ...p }));
  const { data, loading, error, reload } = useApi(`/admin/faculty-comparison${qs({ ...f, q, limit: 25 })}`);
  const cmp = useApi(picked.length >= 2 ? `/admin/faculty-comparison${qs({ ids: picked.join(','), source: f.source, yearFrom: f.yearFrom, yearTo: f.yearTo, limit: 50 })}` : null);
  const srcLabel = SOURCES.find((s) => s.value === f.source).label;

  const sortBy = (k) => SORTABLE.has(k) && set({ sort: k, order: f.sort === k && f.order === 'desc' ? 'asc' : 'desc', page: 1 });
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const compareSeries = useMemo(() => {
    if (!cmp.data) return { rows: [], names: [] };
    const years = new Set(); cmp.data.series.forEach((s) => Object.keys(s.byYear).forEach((y) => years.add(Number(y))));
    return { names: cmp.data.series.map((s) => s.name), rows: [...years].sort().map((y) => ({ year: y, ...Object.fromEntries(cmp.data.series.map((s) => [s.name, s.byYear[y] || 0])) })) };
  }, [cmp.data]);

  return (
    <div>
      <PageHeader title="Faculty" description="Compare faculty research output. Counts of publications are not a definitive measure of research quality."
        actions={<><PdfPageButton title="Faculty comparison" filename="faculty-comparison" disabled={loading} subtitle={`Citations: ${srcLabel}${f.yearFrom || f.yearTo ? `   |   Calendar years ${f.yearFrom || 'start'} to ${f.yearTo || 'present'}` : ''}`} />
          <a className="btn" href={`/api/reports/export${qs({ type: 'comparison', format: 'pdf', source: f.source, yearFrom: f.yearFrom, yearTo: f.yearTo })}`}><Download className="h-3.5 w-3.5" /> Table PDF</a>
          <a className="btn" href={`/api/reports/export${qs({ type: 'comparison', format: 'xlsx', source: f.source, yearFrom: f.yearFrom, yearTo: f.yearTo })}`}><Download className="h-3.5 w-3.5" /> Excel</a></>} />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-mute" /><input className="input pl-8" placeholder="Search faculty" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search faculty" /></div>
          <select className="input !w-auto" value={f.designation} onChange={(e) => set({ designation: e.target.value })} aria-label="Designation"><option value="">All designations</option>{['Professor', 'Associate Professor', 'Assistant Professor'].map((d) => <option key={d}>{d}</option>)}</select>
          <select className="input !w-auto" value={f.source} onChange={(e) => set({ source: e.target.value })} aria-label="Citation source">{SOURCES.map((s) => <option key={s.value} value={s.value}>Citations: {s.label}</option>)}</select>
          <select className="input !w-auto" value={f.yearFrom} onChange={(e) => set({ yearFrom: e.target.value })} aria-label="From year"><option value="">From year</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select>
          <select className="input !w-auto" value={f.yearTo} onChange={(e) => set({ yearTo: e.target.value })} aria-label="To year"><option value="">To year</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select>
        </div>
        {error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : loading && !data ? <TableSkeleton cols={8} /> : !data?.items.length ? <EmptyState title="No faculty match" /> : (
          <>
            <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
              <table className="w-full min-w-[1000px] text-[13px]">
                <thead><tr>
                  <th className="th w-8"><span className="sr-only">Select</span></th>
                  {COLS.map(([k, label]) => (
                    <th key={k} className={`th ${SORTABLE.has(k) ? 'cursor-pointer select-none' : ''} ${k !== 'name' && k !== 'lastSynchronized' ? 'text-right' : ''}`} onClick={() => sortBy(k)}
                      title={k === 'citations' ? `Citations from ${srcLabel}` : k === 'hIndex' || k === 'i10Index' ? (f.source === 'googlescholar' ? 'Reported by Google Scholar profiles' : `Portal-calculated from ${srcLabel} counts`) : ['q1', 'q2', 'q3', 'q4'].includes(k) ? 'SCImago best quartile of the journal (journal papers only); N/A until SCImago data is imported' : undefined}>
                      {label}{k === 'citations' && ` (${srcLabel})`} {f.sort === k && (f.order === 'desc' ? <ArrowDown className="inline h-3 w-3" /> : <ArrowUp className="inline h-3 w-3" />)}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className="hover:bg-canvas/60">
                      <td className="td"><input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Compare ${r.name}`} /></td>
                      <td className="td"><Link to={`/faculty/${r.id}`} className="font-medium text-brand hover:underline">{r.name}</Link><div className="text-[11px] text-ink-mute">{r.designation}</div></td>
                      <td className="td text-right tabular-nums">{n(r.totalPapers)}</td>
                      <td className="td text-right tabular-nums">{n(r.scopusPapers)}</td>
                      <td className={`td text-right tabular-nums ${r.webOfSciencePapers == null ? 'text-ink-mute' : ''}`}>{n(r.webOfSciencePapers)}</td>
                      <td className="td text-right tabular-nums">{n(r.citations)}</td>
                      <td className="td text-right tabular-nums">{n(r.hIndex)}</td>
                      <td className="td text-right tabular-nums">{n(r.i10Index)}</td>
                      {['q1', 'q2', 'q3', 'q4'].map((k) => <td key={k} className={`td text-right tabular-nums ${r[k] == null ? 'text-ink-mute' : ''}`}>{n(r[k])}</td>)}
                      <td className="td whitespace-nowrap text-xs text-ink-soft">{ago(r.lastSynchronized)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={Math.ceil(data.total / data.limit)} total={data.total} limit={data.limit} onPage={(page) => setF((s) => ({ ...s, page }))} />
          </>
        )}
      </Card>
      <p className="mt-2 text-[11px] text-ink-mute">{f.source === 'googlescholar' ? 'Google Scholar figures are the ones shown on each profile (API-retrieved or manually entered); N/A means none has been recorded.' : `h-index and i10-index are portal-calculated from the stored ${srcLabel} citation counts of each person's papers.`} Quartiles and Web of Science counts are N/A until that data is loaded.</p>

      <div className="mt-6">
        <h2 className="mb-3 flex items-center gap-2"><GitCompare className="h-4 w-4" /> Compare faculty</h2>
        {picked.length < 2 ? <Notice>Tick two or more faculty in the table to compare their publications by year, citations and h-index.</Notice> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Publications per year" loading={cmp.loading && !cmp.data} empty={!compareSeries.rows.length} source="Portal database" className="lg:col-span-2">
              <Lines data={compareSeries.rows} series={compareSeries.names.map((name) => ({ key: name, name }))} />
            </ChartCard>
            <ChartCard title={`Citations (${srcLabel})`} loading={cmp.loading && !cmp.data} empty={!cmp.data?.items.some((i) => i.citations != null)} height={220} source={srcLabel}>
              <Bars data={cmp.data?.items} x="name" series={[{ key: 'citations', name: 'Citations' }]} />
            </ChartCard>
            <ChartCard title={`h-index (${srcLabel}, portal-calculated)`} loading={cmp.loading && !cmp.data} empty={!cmp.data?.items.some((i) => i.hIndex != null)} height={220}>
              <Bars data={cmp.data?.items} x="name" series={[{ key: 'hIndex', name: 'h-index' }, { key: 'i10Index', name: 'i10-index' }]} />
            </ChartCard>
          </div>
        )}
      </div>
    </div>
  );
}
