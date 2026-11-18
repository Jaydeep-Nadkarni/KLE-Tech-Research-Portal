import { useState } from 'react';
import { ShieldCheck, Check, X } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api, errMsg } from '../api/client';
import { Card, PageHeader, ErrorState, EmptyState, Badge, Skeleton, Notice } from '../components/ui/Ui';
import { dateTime } from '../utils/format';

function ConflictTask({ t, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const resolve = async (identId, action) => {
    const holder = t.identifiers.find((i) => i._id === identId)?.faculty?.name;
    if (!window.confirm(action === 'verify' ? `Confirm that this ${t.payload.identifierType.toUpperCase()} belongs to ${holder}? The other holders will be marked rejected.` : `Reject this identifier for ${holder}?`)) return;
    setBusy(true); setErr('');
    try { await api.post(`/faculty/identifiers/${identId}/resolve`, { action }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Card title={`Identifier conflict: ${t.payload.identifierType.toUpperCase()} ${t.payload.value}`} subtitle={`Opened ${dateTime(t.createdAt)}`}>
      <p className="mb-3 text-[13px] text-ink-soft">The same identifier was supplied for more than one faculty member. Automated lookups with it are paused. Check the identifier against the researcher's public profile, then choose the rightful owner.</p>
      {err && <div className="mb-2"><ErrorState message={err} /></div>}
      <table className="w-full text-[13px]"><tbody>
        {t.identifiers.map((i) => (
          <tr key={i._id} className="border-t border-line">
            <td className="py-2 font-medium">{i.faculty?.name}</td>
            <td className="py-2"><Badge tone={i.status === 'verified' ? 'good' : i.status === 'rejected' ? 'neutral' : 'bad'}>{i.status}</Badge></td>
            <td className="py-2 text-right">
              {i.status === 'conflict' && <div className="flex justify-end gap-2">
                <button className="btn btn-primary" disabled={busy} onClick={() => resolve(i._id, 'verify')}><Check className="h-3.5 w-3.5" /> Belongs to this person</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => resolve(i._id, 'reject')}><X className="h-3.5 w-3.5" /> Not theirs</button></div>}
            </td>
          </tr>))}
      </tbody></table>
      <p className="mt-2 text-[11px] text-ink-mute">After resolving, add the correct identifier for the other person under Faculty management, then run a sync.</p>
    </Card>
  );
}

function DuplicateTask({ t, onDone }) {
  const dismiss = async () => { await api.post(`/admin/tasks/${t._id}/dismiss`, { note: 'Reviewed: distinct records' }); onDone(); };
  return (
    <Card title="Possible duplicate publication" subtitle={`Opened ${dateTime(t.createdAt)}`} actions={<button className="btn" onClick={dismiss}>Mark as distinct</button>}>
      <p className="text-[13px]"><b>Incoming ({t.payload.incoming?.provider}):</b> {t.payload.incoming?.title} <span className="text-ink-mute">{t.payload.incoming?.year} · {t.payload.incoming?.doi || 'no DOI'}</span></p>
      <p className="mt-2 text-xs font-medium text-ink-soft">Similar existing records</p>
      <ul className="mt-1 space-y-1 text-[13px]">{t.payload.candidates?.map((c) => <li key={c.id}>{c.title} <span className="text-xs text-ink-mute">{c.doi || 'no DOI'}</span></li>)}</ul>
      <p className="mt-2 text-[11px] text-ink-mute">The portal never merges fuzzy title matches automatically. They were kept separate and flagged here.</p>
    </Card>
  );
}

function AuthorMatchTask({ t, onDone }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const fac = t.faculty[0];
  const link = async (c) => {
    if (!window.confirm(`Link OpenAlex profile ${c.openalexId} (${c.name}, ${c.worksCount} works) to ${fac?.name}? Their OpenAlex publications will be imported on the next sync.`)) return;
    setBusy(true); setErr('');
    try { await api.post(`/faculty/${fac.id}/identifiers`, { type: 'openalex', value: c.openalexId }); await api.post(`/admin/tasks/${t._id}/dismiss`, { note: `Linked OpenAlex ${c.openalexId}` }); onDone(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const dismiss = async () => { await api.post(`/admin/tasks/${t._id}/dismiss`, { note: 'No candidate is this person' }); onDone(); };
  return (
    <Card title={`Possible OpenAlex profile for ${fac?.name}`} subtitle={`Opened ${dateTime(t.createdAt)}`} actions={<button className="btn" onClick={dismiss}>None of these</button>}>
      <p className="mb-3 text-[13px] text-ink-soft">OpenAlex has no profile for this person's ORCID, so papers only reach the portal through Scopus. These profiles were found by name search. Linking the wrong person would attach their papers to {fac?.name}, so check each one before linking.</p>
      {err && <div className="mb-2"><ErrorState message={err} /></div>}
      <table className="w-full text-[13px]"><tbody>{t.payload.candidates.map((c) => (
        <tr key={c.openalexId} className="border-t border-line"><td className="py-2"><span className="font-medium">{c.name}</span>{c.kleAffiliation && <> <Badge tone="good">KLE affiliation</Badge></>}<div className="text-[11px] text-ink-mute">{c.openalexId} · {c.worksCount} works · {c.citedByCount} citations · {c.institutions.join(', ') || 'no institution'}{c.orcid ? ` · ORCID ${c.orcid}` : ''}</div></td>
          <td className="py-2 text-right"><a className="btn mr-2" href={`https://openalex.org/${c.openalexId}`} target="_blank" rel="noreferrer">View</a><button className="btn btn-primary" disabled={busy} onClick={() => link(c)}>Link profile</button></td></tr>))}</tbody></table>
    </Card>
  );
}

export default function Verification() {
  const { data, loading, error, reload } = useApi('/admin/tasks?status=open');
  return (
    <div>
      <PageHeader title="Verification queue" description="Items the portal could not safely decide on its own. Nothing here is merged or trusted until you review it." />
      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <Skeleton className="h-40 w-full" /> : !data?.items.length ? (
        <Card><EmptyState icon={ShieldCheck} title="Nothing to review" hint="Identifier conflicts and uncertain duplicates will appear here." /></Card>
      ) : (
        <div className="space-y-4">
          {data.items.some((t) => t.type === 'identifier_conflict') && <Notice tone="warn">Conflicting identifiers can attach one person's papers to someone else. Resolve these first.</Notice>}
          {data.items.map((t) => t.type === 'identifier_conflict' ? <ConflictTask key={t._id} t={t} onDone={reload} /> : t.type === 'uncertain_author_match' ? <AuthorMatchTask key={t._id} t={t} onDone={reload} /> : <DuplicateTask key={t._id} t={t} onDone={reload} />)}
        </div>
      )}
    </div>
  );
}
