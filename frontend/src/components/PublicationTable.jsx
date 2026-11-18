import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ArrowUp, ArrowDown, ExternalLink, SlidersHorizontal } from 'lucide-react';
import { useApi, useDebounced } from '../hooks/useApi';
import { qs } from '../api/client';
import { Card, ErrorState, EmptyState, Pagination, TableSkeleton, Badge } from './ui/Ui';
import { IndexBadgesCompact } from './IndexingBadges';
import { n, SOURCES } from '../utils/format';

const SORTS = { year: 'Year', title: 'Title', citations: 'Citations', venue: 'Venue' };

/** Server-side searchable / sortable / filterable publication list. basePath is /researchers/:id/publications or /publications */
export default function PublicationTable({ basePath, showFaculty, title = 'Publications' }) {
  const [f, setF] = useState({ q: '', year: '', scopus: '', wos: '', venueType: '', publisher: '', openAccess: '', minCites: '', maxCites: '', verification: '', citeSource: 'scopus', sort: 'year', order: 'desc', page: 1 });
  const [showFilters, setShowFilters] = useState(false);
  const debouncedQ = useDebounced(f.q);
  const debouncedCites = useDebounced(`${f.minCites}|${f.maxCites}`, 500);
  const set = (patch) => setF((s) => ({ ...s, page: 1, ...patch }));
  useEffect(() => { setF((s) => ({ ...s, page: 1 })); }, [basePath]);

  const [minC, maxC] = debouncedCites.split('|');
  const url = `${basePath}${qs({ ...f, q: debouncedQ, minCites: minC, maxCites: maxC, limit: 15 })}`;
  const { data, loading, error, reload } = useApi(url);
  const facets = useApi(`${basePath === '/publications' ? '/publications' : basePath}/facets`);

  const sortBy = (key) => set({ sort: key, order: f.sort === key && f.order === 'desc' ? 'asc' : 'desc', page: f.page });
  const SortIcon = ({ k }) => (f.sort === k ? (f.order === 'desc' ? <ArrowDown className="inline h-3 w-3" /> : <ArrowUp className="inline h-3 w-3" />) : null);
  const srcLabel = useMemo(() => SOURCES.find((s) => s.value === f.citeSource)?.label, [f.citeSource]);

  return (
    <Card title={title} pad={false}
      actions={<button className="btn" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal className="h-3.5 w-3.5" /> Filters</button>}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-mute" />
          <input className="input pl-8" placeholder="Search title, DOI or journal" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search publications" />
        </div>
        <select className="input !w-auto" value={f.citeSource} onChange={(e) => set({ citeSource: e.target.value })} aria-label="Citation source">
          {SOURCES.map((s) => <option key={s.value} value={s.value}>Citations: {s.label}</option>)}
        </select>
      </div>
      {showFilters && (
        <div className="grid grid-cols-2 gap-3 border-b border-line bg-canvas p-3 md:grid-cols-4">
          <label className="text-xs"><span className="label">Year</span>
            <select className="input" value={f.year} onChange={(e) => set({ year: e.target.value })}><option value="">All years</option>{(facets.data?.years || []).map((y) => <option key={y}>{y}</option>)}</select></label>
          <label className="text-xs"><span className="label">Scopus status</span>
            <select className="input" value={f.scopus} onChange={(e) => set({ scopus: e.target.value })}><option value="">Any</option><option value="indexed">Indexed</option><option value="not_found">Not found</option><option value="pending">Verification pending</option></select></label>
          <label className="text-xs"><span className="label">Web of Science</span>
            <select className="input" value={f.wos} onChange={(e) => set({ wos: e.target.value })}><option value="">Any</option><option value="indexed">Indexed</option><option value="not_found">Not found</option><option value="not_checked">Not checked</option></select></label>
          <label className="text-xs"><span className="label">Venue type</span>
            <select className="input" value={f.venueType} onChange={(e) => set({ venueType: e.target.value })}><option value="">Any</option><option value="journal">Journal</option><option value="conference">Conference</option><option value="book">Book / chapter</option><option value="other">Other</option><option value="unknown">Unknown</option></select></label>
          <label className="text-xs"><span className="label">Publisher</span>
            <select className="input" value={f.publisher} onChange={(e) => set({ publisher: e.target.value })}><option value="">Any</option>{(facets.data?.publishers || []).map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="text-xs"><span className="label">Open access</span>
            <select className="input" value={f.openAccess} onChange={(e) => set({ openAccess: e.target.value })}><option value="">Any</option><option value="yes">Open access</option><option value="no">Not open access</option><option value="unknown">Unknown</option></select></label>
          <label className="text-xs"><span className="label">Min citations ({srcLabel})</span><input type="number" min="0" className="input" value={f.minCites} onChange={(e) => set({ minCites: e.target.value })} /></label>
          <label className="text-xs"><span className="label">Max citations ({srcLabel})</span><input type="number" min="0" className="input" value={f.maxCites} onChange={(e) => set({ maxCites: e.target.value })} /></label>
          <label className="text-xs"><span className="label">Verification</span>
            <select className="input" value={f.verification} onChange={(e) => set({ verification: e.target.value })}><option value="">Any</option><option value="auto">Auto-matched</option><option value="pending_review">Pending review</option><option value="verified">Verified</option></select></label>
        </div>
      )}
      {error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : loading && !data ? <TableSkeleton cols={5} /> : !data?.items.length ? <EmptyState title="No publications match" hint="Try clearing a filter or search term." /> : (
        <>
          <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[820px] text-[13px]">
              <thead><tr>
                <th className="th cursor-pointer" onClick={() => sortBy('title')}>Title <SortIcon k="title" /></th>
                {showFaculty && <th className="th">Faculty</th>}
                <th className="th cursor-pointer" onClick={() => sortBy('venue')}>Venue <SortIcon k="venue" /></th>
                <th className="th cursor-pointer" onClick={() => sortBy('year')}>Year <SortIcon k="year" /></th>
                <th className="th">Indexing</th>
                <th className="th cursor-pointer text-right" onClick={() => sortBy('citations')}>Cited by ({srcLabel}) <SortIcon k="citations" /></th>
              </tr></thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p._id} className="hover:bg-canvas/60">
                    <td className="td max-w-md"><Link to={`/publications/${p._id}`} className="font-medium text-brand hover:underline">{p.title}</Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-mute">
                        {p.venueType !== 'unknown' && <Badge>{p.venueType}</Badge>}
                        {p.openAccess === 'yes' && <Badge tone="good">Open access</Badge>}
                        {p.doi && <a className="inline-flex items-center gap-0.5 hover:text-brand" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer">{p.doi}<ExternalLink className="h-3 w-3" /></a>}
                      </div></td>
                    {showFaculty && <td className="td text-xs">{p.faculty.map((x) => x.name).join(', ') || 'N/A'}</td>}
                    <td className="td max-w-[220px] text-ink-soft">{p.venue || 'N/A'}{p.publisher && <div className="text-[11px] text-ink-mute">{p.publisher}</div>}</td>
                    <td className="td tabular-nums">{p.year ?? 'N/A'}</td>
                    <td className="td"><IndexBadgesCompact indexing={p.indexing} /></td>
                    <td className="td text-right tabular-nums">{n(p.citations?.[data.citeSource]?.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onPage={(page) => setF((s) => ({ ...s, page }))} />
        </>
      )}
    </Card>
  );
}
