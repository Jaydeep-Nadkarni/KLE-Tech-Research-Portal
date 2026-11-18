import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ExternalLink, X } from 'lucide-react';
import { useApi, useDebounced } from '../hooks/useApi';
import { api, qs, errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, PageHeader, StatCard, Badge, ErrorState, EmptyState, Notice, Pagination, TableSkeleton } from '../components/ui/Ui';
import { n } from '../utils/format';
import PdfPageButton from '../components/PdfPageButton';

const TONE = { department: 'good', kle_tech: 'info', kle_other: 'info', external: 'neutral', unknown: 'warn', student: 'good', research_scholar: 'good', faculty_other_dept: 'info' };
const TAG_LABEL = { student: 'Student', research_scholar: 'Research scholar', faculty_other_dept: 'Faculty, other department', external: 'External' };

export default function Coauthors() {
  const { isAdmin } = useAuth();
  const [f, setF] = useState({ facultyId: '', class: '', q: '', minPapers: '', page: 1 });
  const q = useDebounced(f.q);
  const set = (p) => setF((s) => ({ ...s, page: 1, ...p }));
  const faculty = useApi('/faculty');
  const { data, loading, error, reload } = useApi(`/admin/coauthors${qs({ ...f, q, limit: 25 })}`);
  const [msg, setMsg] = useState('');

  const tag = async (row, category) => {
    setMsg('');
    try {
      if (!category) await api.delete(`/admin/coauthors/tag${qs({ key: row.key })}`);
      else await api.post('/admin/coauthors/tag', { key: row.key, name: row.name, category });
      reload();
    } catch (e) { setMsg(errMsg(e)); }
  };
  const s = data?.summary, t = data?.totals;
  const CARDS = [['kle_tech', 'KLE Tech, not in department list'], ['kle_other', 'Other KLE institution'], ['external', 'External institution'], ['unknown', 'Affiliation unknown'], ['student', 'Tagged students'], ['research_scholar', 'Tagged research scholars']];

  return (
    <div>
      <PageHeader title="Co-authors" description="Everyone who appears on a department paper besides the faculty themselves, classified by the affiliation recorded on the paper."
        actions={<PdfPageButton title="Co-authors" filename="coauthors" disabled={loading} subtitle={f.facultyId ? `Faculty: ${faculty.data?.items.find((x) => x.id === f.facultyId)?.name}` : 'All department faculty'} />} />
      <Notice>The class describes the <b>affiliation shown on the paper</b> (from OpenAlex), not a person's role. Whether someone is a <b>student or research scholar</b> is not in any data source, so it is only shown after the HOD tags them below. Co-authors on papers without OpenAlex data have no affiliation and show as "unknown".</Notice>
      {error ? <div className="mt-4"><ErrorState message={error} onRetry={reload} /></div> : (<>
        <div data-pdf-group className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {CARDS.map(([k, label]) => (
            <button key={k} className={`card p-4 text-left transition-colors hover:bg-canvas ${f.class === k ? 'ring-2 ring-brand/40' : ''}`} onClick={() => set({ class: f.class === k ? '' : k })} aria-pressed={f.class === k}>
              <p className="text-xs font-medium text-ink-soft">{label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{s ? n(s[k]) : '…'}</p>
            </button>))}
        </div>
        <p className="mt-2 text-[11px] text-ink-mute">{t ? `${n(t.people)} distinct co-authors across ${n(t.papersWithCoauthors)} papers. ${n(t.papersWithSeveralDepartmentFaculty)} papers are shared by two or more department faculty. Affiliation data exists for ${n(t.papersWithAffiliationData)} of ${n(t.papersAnalysed)} papers.` : ''} Click a card to filter.</p>

        <div className="mt-4"><Card pad={false}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-mute" /><input className="input pl-8" placeholder="Search name or institution" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search co-authors" /></div>
            <select className="input !w-auto" value={f.facultyId} onChange={(e) => set({ facultyId: e.target.value })} aria-label="Faculty"><option value="">All faculty</option>{faculty.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <select className="input !w-auto" value={f.class} onChange={(e) => set({ class: e.target.value })} aria-label="Class"><option value="">All classes</option>{Object.entries(data?.labels || {}).filter(([k]) => k !== 'department' || f.facultyId).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select className="input !w-auto" value={f.minPapers} onChange={(e) => set({ minPapers: e.target.value })} aria-label="Minimum papers"><option value="">Any number of papers</option><option value="2">2 or more papers</option><option value="3">3 or more</option><option value="5">5 or more</option></select>
          </div>
          {msg && <div className="p-3"><ErrorState message={msg} /></div>}
          {loading && !data ? <TableSkeleton cols={6} /> : !data?.items.length ? <EmptyState title="No co-authors match" /> : (<>
            <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
              <table className="w-full min-w-[900px] text-[13px]">
                <thead><tr><th className="th">Co-author</th><th className="th">Class</th><th className="th">Institution on paper</th><th className="th text-right">Papers</th><th className="th">Works with</th>{isAdmin && <th className="th">Tag</th>}</tr></thead>
                <tbody>{data.items.map((r) => (
                  <tr key={r.key} className="hover:bg-canvas/60">
                    <td className="td"><span className="font-medium">{r.name}</span>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">{r.years.length > 0 && <span>{r.years[0]}{r.years.at(-1) !== r.years[0] ? `–${r.years.at(-1)}` : ''}</span>}
                        {r.openalexId && <a className="inline-flex items-center gap-0.5 hover:text-brand" href={`https://openalex.org/${r.openalexId}`} target="_blank" rel="noreferrer">OpenAlex<ExternalLink className="h-3 w-3" /></a>}
                        {r.orcid && <a className="inline-flex items-center gap-0.5 hover:text-brand" href={`https://orcid.org/${r.orcid}`} target="_blank" rel="noreferrer">ORCID<ExternalLink className="h-3 w-3" /></a>}</div></td>
                    <td className="td"><Badge tone={TONE[r.class]} title={`Source: ${r.classSource}`}>{r.classLabel}</Badge>{r.tag && <div className="mt-0.5 text-[10px] text-ink-mute">tagged by {r.tag.setBy}</div>}</td>
                    <td className="td max-w-[260px] text-xs text-ink-soft">{r.institutions.length ? r.institutions.slice(0, 3).join('; ') + (r.institutions.length > 3 ? ` +${r.institutions.length - 3}` : '') : <span className="text-ink-mute">N/A</span>}{r.countries.length > 0 && <span className="text-ink-mute"> · {r.countries.join(', ')}</span>}</td>
                    <td className="td text-right tabular-nums font-medium">{r.papers}</td>
                    <td className="td text-xs">{r.faculty.map((x) => <Link key={x.id} to={`/faculty/${x.id}`} className="mr-2 inline-block text-brand hover:underline">{x.name.split(' ')[0]} ({x.papers})</Link>)}</td>
                    {isAdmin && <td className="td"><div className="flex items-center gap-1">
                      <select className="input !w-auto !py-1 text-xs" value={r.tag?.category || ''} onChange={(e) => tag(r, e.target.value)} aria-label={`Tag ${r.name}`}><option value="">{r.tag ? 'Remove tag' : 'Tag as…'}</option>{Object.entries(TAG_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      {r.tag && <button className="rounded p-1 hover:bg-canvas" onClick={() => tag(r, '')} aria-label="Remove tag"><X className="h-3.5 w-3.5" /></button>}</div></td>}
                  </tr>))}</tbody></table></div>
            <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onPage={(page) => setF((x) => ({ ...x, page }))} />
          </>)}
        </Card></div>
        <p className="mt-3 text-[11px] text-ink-mute">The same person can appear twice if a paper lists them under a different spelling and OpenAlex has no record to join them. Name-only entries are merged only when exactly one person shares the surname and first initial.</p>
      </>)}
    </div>
  );
}
