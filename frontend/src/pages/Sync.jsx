import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Loader2, Upload } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api, errMsg } from '../api/client';
import { Card, PageHeader, ErrorState, Badge, Skeleton, Notice, Pagination, EmptyState } from '../components/ui/Ui';
import { dateTime, ago } from '../utils/format';

const TONE = { success: 'good', failed: 'bad', skipped: 'warn', partial: 'warn', unavailable: 'neutral' };
const PROVIDERS = ['scopus', 'orcid', 'openalex', 'googlescholar'];

function WosCard() {
  const st = useApi('/admin/wos/status');
  const ref = useRef();
  const [res, setRes] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const upload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setBusy(true); setErr(''); setRes(null);
    try { const fd = new FormData(); fd.append('file', file); const { data } = await api.post('/admin/wos/import', fd); setRes(data); st.reload(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); ref.current.value = ''; }
  };
  const c = st.data?.coverage;
  return (
    <Card title="Web of Science" subtitle="Needs a Clarivate licence. Indexing is recorded only from a real Web of Science record."
      actions={isAdminHint(<><input ref={ref} type="file" accept=".xls,.xlsx,.txt,.tsv" className="hidden" onChange={upload} /><button className="btn" onClick={() => ref.current.click()} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Import WoS export</button></>)}>
      {!st.data ? <Skeleton className="h-10 w-full" /> : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 text-[13px]">
            <p><Badge tone={st.data.apiConfigured ? 'good' : 'neutral'}>{st.data.apiConfigured ? 'Clarivate API key configured' : 'No Clarivate API key'}</Badge></p>
            <p className="text-xs text-ink-soft">{c.checked ? `${c.indexed} indexed, ${c.notFound} not found, ${c.total - c.checked} not yet checked (of ${c.total} papers).` : `No papers checked yet (${c.total} papers; ${st.data.withDoi} have a DOI).`}</p>
            <p className="text-[11px] text-ink-mute">{st.data.apiConfigured ? 'Each sync checks papers that have a DOI.' : 'Set CLARIVATE_API_KEY (Web of Science Starter API, developer.clarivate.com) to check by DOI during sync, or import an export file.'}</p>
          </div>
          <div className="text-xs text-ink-soft">
            <p className="font-medium text-ink">Importing an export</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4"><li>In Web of Science, search Organization: KLE Technological University (your institution needs access).</li><li>Export, choosing Excel or "Plain text file", record content "Full Record".</li><li>Upload it here. Papers already in the portal are matched by DOI or exact title and marked indexed; the rest are listed, not created.</li></ol>
          </div>
        </div>)}
      {err && <div className="mt-3"><ErrorState message={err} /></div>}
      {res && <div className="mt-3"><Notice tone={res.unmatchedCount ? 'warn' : 'info'}>{res.rows} rows read: {res.matched} matched to portal papers ({res.alreadyIndexed} were already marked), {res.unmatchedCount} not in the portal{res.noTitle ? `, ${res.noTitle} without a title` : ''}.
        {res.unmatched?.length > 0 && <details className="mt-1"><summary className="cursor-pointer">Show unmatched</summary><ul className="mt-1 list-disc pl-4">{res.unmatched.map((u, i) => <li key={i}>{u.title} ({u.year ?? 'no year'}){u.doi ? ` · ${u.doi}` : ''}</li>)}</ul></details>}</Notice></div>}
    </Card>
  );
}
const isAdminHint = (x) => x; // this page is already admin-only

export default function Sync() {
  const status = useApi('/admin/sync-status');
  const jobs = useApi('/sync/jobs?limit=8');
  const [page, setPage] = useState(1);
  const hist = useApi(`/sync/history?page=${page}&limit=15`);
  const [err, setErr] = useState('');
  const running = status.data?.running;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { status.reload(); jobs.reload(); }, 3000);
    return () => clearInterval(t);
  }, [running, status.reload, jobs.reload]);
  useEffect(() => { if (status.data && !running) hist.reload(); }, [running]); // eslint-disable-line

  const runAll = async () => {
    if (!window.confirm('Synchronize all active faculty? This calls the external APIs and uses Scopus quota.')) return;
    setErr('');
    try { await api.post('/sync/all'); status.reload(); jobs.reload(); } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div>
      <PageHeader title="Synchronization" description="Pull the latest publications and citation counts from each provider. Runs are tracked here; every provider call is logged."
        actions={<button className="btn btn-primary" onClick={runAll} disabled={!!running}>{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync all faculty</button>} />
      {err && <div className="mb-3"><ErrorState message={err} /></div>}
      {running && <div className="mb-4"><Notice>Job running: {running.progress.done} of {running.progress.total} faculty done{running.progress.current ? ` · now syncing ${running.progress.current}` : ''}. Triggered by {running.triggeredBy}.</Notice></div>}
      <p className="mb-3 text-xs text-ink-soft">Journal metrics (CiteScore, SJR, SNIP) are refreshed after each full sync, and can also be refreshed from the Journals page.</p>
      <Notice tone="warn">Automatic scheduling (BullMQ + Redis) is not enabled yet. Synchronization runs only when triggered here or from a faculty profile.</Notice>

      <div className="mt-4"><WosCard /></div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Last successful sync by provider" pad={false} className="xl:col-span-2">
          {status.error ? <div className="p-4"><ErrorState message={status.error} onRetry={status.reload} /></div> : !status.data ? <div className="p-4"><Skeleton className="h-32 w-full" /></div> : (
            <div className="overflow-x-auto"><table className="w-full text-[13px]">
              <thead><tr><th className="th">Faculty</th>{PROVIDERS.map((p) => <th key={p} className="th capitalize">{p}</th>)}</tr></thead>
              <tbody>{status.data.faculty.map((f) => (
                <tr key={f.id}><td className="td font-medium">{f.name}</td>
                  {PROVIDERS.map((p) => { const s = f.providers[p]; return <td key={p} className="td">{s ? <div><Badge tone={TONE[s.status] || 'neutral'} title={s.error}>{s.status || 'unknown'}</Badge><div className="mt-0.5 text-[11px] text-ink-mute">{s.lastSuccessAt ? `${ago(s.lastSuccessAt)} · ${s.count ?? 0} records` : 'never succeeded'}</div>{s.error && <div className="max-w-[200px] truncate text-[11px] text-red-700" title={s.error}>{s.error}</div>}</div> : <span className="text-xs text-ink-mute">not run</span>}</td>; })}
                </tr>))}</tbody></table></div>)}
        </Card>
        <Card title="Recent jobs" pad={false}>
          {!jobs.data?.items.length ? <EmptyState title="No jobs yet" /> : <ul className="divide-y divide-line">{jobs.data.items.map((j) => (
            <li key={j._id} className="px-4 py-2.5 text-xs"><div className="flex items-center justify-between"><span className="font-medium">{j.scope === 'all' ? 'All faculty' : j.faculty?.name}</span><Badge tone={j.status === 'completed' ? 'good' : j.status === 'failed' ? 'bad' : 'info'}>{j.status}</Badge></div>
              <div className="text-ink-mute">{dateTime(j.startedAt || j.createdAt)} · {j.progress.done}/{j.progress.total} · {j.triggeredBy}</div>{j.error && <div className="text-red-700">{j.error}</div>}</li>))}</ul>}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Provider call history" pad={false}>
          {!hist.data ? <div className="p-4"><Skeleton className="h-24 w-full" /></div> : !hist.data.items.length ? <EmptyState title="No history yet" /> : (
            <><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-[13px]">
              <thead><tr><th className="th">When</th><th className="th">Faculty</th><th className="th">Provider</th><th className="th">Status</th><th className="th text-right">Fetched</th><th className="th">Details</th></tr></thead>
              <tbody>{hist.data.items.map((l) => (
                <tr key={l._id}><td className="td whitespace-nowrap text-xs">{dateTime(l.finishedAt)}</td><td className="td">{l.faculty}</td><td className="td capitalize">{l.provider}</td>
                  <td className="td"><Badge tone={TONE[l.status]}>{l.status}</Badge></td><td className="td text-right tabular-nums">{l.fetched ?? '–'}</td><td className="td max-w-xs text-xs text-ink-soft">{l.message || (l.created != null ? `${l.created} new, ${l.updated} updated` : '')}</td></tr>))}</tbody></table></div>
              <Pagination page={hist.data.page} pages={Math.ceil(hist.data.total / hist.data.limit)} total={hist.data.total} limit={hist.data.limit} onPage={setPage} /></>)}
        </Card>
      </div>
    </div>
  );
}
