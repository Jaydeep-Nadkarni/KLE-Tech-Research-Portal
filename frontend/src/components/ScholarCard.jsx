import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, Upload, CheckCircle2 } from 'lucide-react';
import { api, errMsg } from '../api/client';
import { Card, Badge, Notice, Modal, Field, ErrorState, EmptyState } from './ui/Ui';
import { Bars } from './charts/Charts';
import { n, date } from '../utils/format';

export const SCHOLAR_STATUS = {
  api: { tone: 'good', label: 'Retrieved via API' },
  manual_verified: { tone: 'good', label: 'Manually entered, verified' },
  manual_pending: { tone: 'warn', label: 'Awaiting admin approval' },
  unavailable: { tone: 'neutral', label: 'Unavailable' },
};

const Pair = ({ p, label }) => (
  <tr className="border-b border-line last:border-0">
    <td className="py-2 pr-3 text-xs text-ink-soft">{label}</td>
    <td className="py-2 pr-3 text-right tabular-nums font-medium">{n(p?.all)}</td>
    <td className="py-2 text-right tabular-nums text-ink-soft">{p?.since != null ? `${n(p.since)}` : 'N/A'}</td>
  </tr>
);

function FiguresModal({ id, profile, onClose, onDone }) {
  const [v, setV] = useState({ totalCitations: profile?.totalCitations?.all ?? '', totalCitationsSince: profile?.totalCitations?.since ?? '', hIndex: profile?.hIndex?.all ?? '', hIndexSince: profile?.hIndex?.since ?? '', i10Index: profile?.i10Index?.all ?? '', i10IndexSince: profile?.i10Index?.since ?? '', sinceYear: profile?.totalCitations?.sinceYear ?? new Date().getFullYear() - 5, asOfDate: new Date().toISOString().slice(0, 10), affiliation: profile?.affiliation ?? '', interests: (profile?.interests || []).join(', '), years: (profile?.citationsByYear || []).map((y) => `${y.year}:${y.citations}`).join(', ') });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const numOrU = (x) => (x === '' || x == null ? undefined : Number(x));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const years = v.years.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [y, c] = s.split(':').map(Number); return { year: y, citations: c }; });
      if (years.some((y) => Number.isNaN(y.year) || Number.isNaN(y.citations))) throw new Error('Citations by year must look like 2023:80, 2024:110');
      const body = { totalCitations: Number(v.totalCitations), totalCitationsSince: numOrU(v.totalCitationsSince), hIndex: Number(v.hIndex), hIndexSince: numOrU(v.hIndexSince), i10Index: Number(v.i10Index), i10IndexSince: numOrU(v.i10IndexSince), sinceYear: numOrU(v.sinceYear), asOfDate: v.asOfDate, affiliation: v.affiliation || undefined, interests: v.interests ? v.interests.split(',').map((s) => s.trim()).filter(Boolean) : undefined, citationsByYear: years.length ? years : undefined };
      await api.post(`/researchers/${id}/scholar/profile`, body); onDone(); onClose();
    } catch (x) { setErr(x.response ? errMsg(x) + (x.response.data?.details ? ': ' + JSON.stringify(x.response.data.details) : '') : x.message); } finally { setBusy(false); }
  };
  const num = (k, label, req) => <Field label={label}><input type="number" min="0" className="input" required={req} value={v[k]} onChange={set(k)} /></Field>;
  return (
    <Modal title="Enter Google Scholar figures" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        {err && <ErrorState message={err} />}
        <Notice>Copy the numbers exactly as shown on the public Scholar profile ("Cited by" table). They are stored as <b>manually entered</b> with your name and date.</Notice>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {num('totalCitations', 'Citations (all)', true)}{num('hIndex', 'h-index (all)', true)}{num('i10Index', 'i10-index (all)', true)}
          {num('totalCitationsSince', 'Citations (since year)')}{num('hIndexSince', 'h-index (since year)')}{num('i10IndexSince', 'i10-index (since year)')}
          {num('sinceYear', 'Since year')}
          <Field label="Figures read on"><input type="date" className="input" value={v.asOfDate} onChange={set('asOfDate')} /></Field>
        </div>
        <Field label="Affiliation (as on profile)"><input className="input" value={v.affiliation} onChange={set('affiliation')} /></Field>
        <Field label="Research interests (comma separated)"><input className="input" value={v.interests} onChange={set('interests')} /></Field>
        <Field label="Citations per year (optional, year:count, comma separated)"><input className="input" placeholder="2022:60, 2023:80, 2024:110" value={v.years} onChange={set('years')} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>Save figures</button></div>
      </form>
    </Modal>
  );
}

function ImportModal({ id, onClose, onDone }) {
  const ref = useRef();
  const [res, setRes] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const upload = async (e) => {
    e.preventDefault(); const f = ref.current.files[0]; if (!f) return;
    setBusy(true); setErr('');
    try { const fd = new FormData(); fd.append('file', f); const { data } = await api.post(`/researchers/${id}/scholar/import`, fd); setRes(data); onDone(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Import Scholar publication list" onClose={onClose}>
      <form onSubmit={upload} className="space-y-3">
        {err && <ErrorState message={err} />}
        <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-soft"><li>Open the faculty member's Google Scholar profile.</li><li>Tick the box at the top of the article list to select all (use "Show more" first to load every article).</li><li>Choose <b>Export</b>, then <b>CSV</b> or <b>BibTeX</b>, and save the file.</li><li>Upload it here. Papers already in the portal are matched, not duplicated.</li></ol>
        <input ref={ref} type="file" accept=".csv,.bib,.bibtex,.txt" className="input" required />
        {res && <Notice>{res.total} papers read: {res.matchedExisting} matched to existing records, {res.created} added as new{res.skipped ? `, ${res.skipped} skipped` : ''}. Uncertain title matches are in the verification queue.</Notice>}
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={busy}>Import</button></div>
      </form>
      <p className="mt-2 text-[11px] text-ink-mute">Scholar's export has no citation counts unless a "Cited by" column is present. Imported papers are marked Google Scholar: Listed, and never Scopus-indexed.</p>
    </Modal>
  );
}

export default function ScholarCard({ id, sc, canEdit, isAdmin, reload }) {
  const [modal, setModal] = useState(null);
  const [msg, setMsg] = useState('');
  if (!sc) return null;
  const p = sc.profile;
  const st = SCHOLAR_STATUS[sc.status];
  const approve = async () => { try { await api.post(`/researchers/${id}/scholar/approve`); reload(); } catch (e) { setMsg(errMsg(e)); } };

  return (
    <Card title="Google Scholar" subtitle="Google offers no official API. Data is retrieved through a licensed provider or entered by hand, and always labelled."
      actions={<>
        {sc.profileUrl && <a className="btn" href={sc.profileUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open profile</a>}
        {canEdit && <button className="btn" onClick={() => setModal('figures')}><Pencil className="h-3.5 w-3.5" /> {p ? 'Update figures' : 'Enter figures'}</button>}
        {isAdmin && <button className="btn" onClick={() => setModal('import')}><Upload className="h-3.5 w-3.5" /> Import publications</button>}
      </>}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={st.tone}>{st.label}</Badge>
        {p?.mode === 'api' && <span className="text-ink-mute">Retrieved {date(p.retrievedAt)}</span>}
        {p?.mode === 'manual' && <span className="text-ink-mute">Entered by {p.enteredBy}; figures read on {p.asOfDate}{p.verifiedBy ? `; verified by ${p.verifiedBy} on ${date(p.lastVerifiedAt)}` : ''}</span>}
        {sc.status === 'manual_pending' && isAdmin && <button className="btn" onClick={approve}><CheckCircle2 className="h-3.5 w-3.5" /> Approve figures</button>}
        {msg && <span className="text-red-700">{msg}</span>}
      </div>

      {!p ? (
        <div>
          <EmptyState title="No Google Scholar data yet" hint={sc.apiConfigured ? 'Run a sync to retrieve this profile.' : 'No API provider is configured (set SERPAPI_API_KEY to enable one). Citations, h-index and i10-index can be entered manually from the public profile, and publications imported from a Scholar export.'} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div>
            <table className="w-full text-[13px]"><thead><tr><th className="pb-1 text-left text-[11px] font-semibold uppercase text-ink-soft"> </th><th className="pb-1 text-right text-[11px] font-semibold uppercase text-ink-soft">All</th><th className="pb-1 text-right text-[11px] font-semibold uppercase text-ink-soft">Since {p.totalCitations?.sinceYear ?? p.hIndex?.sinceYear ?? '…'}</th></tr></thead>
              <tbody><Pair p={p.totalCitations} label="Citations" /><Pair p={p.hIndex} label="h-index" /><Pair p={p.i10Index} label="i10-index" /></tbody></table>
            <p className="mt-2 text-[11px] text-ink-mute">Reported by Google Scholar, not calculated by this portal.</p>
          </div>
          <div className="space-y-2 text-[13px]">
            <p><span className="text-xs font-medium text-ink-soft">Name on profile: </span>{p.name || 'N/A'}</p>
            <p><span className="text-xs font-medium text-ink-soft">Affiliation: </span>{p.affiliation || 'N/A'}</p>
            {p.emailNote && <p><span className="text-xs font-medium text-ink-soft">Email: </span>{p.emailNote}</p>}
            <div><span className="text-xs font-medium text-ink-soft">Interests: </span>{p.interests?.length ? <span className="inline-flex flex-wrap gap-1 align-middle">{p.interests.map((i) => <Badge key={i}>{i}</Badge>)}</span> : 'N/A'}</div>
            {p.coAuthors?.length > 0 && <div><span className="text-xs font-medium text-ink-soft">Co-authors: </span><span className="text-xs">{p.coAuthors.map((c) => c.name).join(', ')}</span></div>}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-ink-soft">Citations per year</p>
            {p.citationsByYear?.length ? <div style={{ height: 150 }}><Bars data={p.citationsByYear} x="year" series={[{ key: 'citations', name: 'Citations' }]} /></div> : <p className="text-xs text-ink-mute">N/A</p>}
          </div>
        </div>
      )}

      {sc.publicationsListed > 0 && (
        <details className="mt-4 text-[13px]"><summary className="cursor-pointer text-sm font-medium">Publications listed on Google Scholar ({sc.publicationsListed})</summary>
          <table className="mt-2 w-full text-[13px]"><thead><tr><th className="th">Title</th><th className="th">Year</th><th className="th text-right">Cited by (Scholar)</th></tr></thead>
            <tbody>{sc.publications.map((x) => <tr key={x._id}><td className="td"><Link className="text-brand hover:underline" to={`/publications/${x._id}`}>{x.title}</Link></td><td className="td tabular-nums">{x.year ?? 'N/A'}</td><td className="td text-right tabular-nums">{n(x.citations?.googlescholar?.count)}</td></tr>)}</tbody></table>
        </details>)}
      {sc.history?.length > 1 && <details className="mt-3 text-xs"><summary className="cursor-pointer text-ink-soft">Metric history ({sc.history.length} snapshots)</summary>
        <ul className="mt-1 space-y-0.5 text-ink-mute">{sc.history.map((h, i) => <li key={i}>{date(h.retrievedAt)} · {h.mode}: {n(h.metrics?.totalCitations?.all)} citations, h-index {n(h.metrics?.hIndex?.all)}, i10 {n(h.metrics?.i10Index?.all)}</li>)}</ul></details>}

      {modal === 'figures' && <FiguresModal id={id} profile={p} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'import' && <ImportModal id={id} onClose={() => setModal(null)} onDone={reload} />}
    </Card>
  );
}
