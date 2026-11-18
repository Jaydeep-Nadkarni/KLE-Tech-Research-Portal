import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Upload, Pencil, UserX, UserCheck } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api, errMsg } from '../api/client';
import { Card, PageHeader, ErrorState, Badge, Modal, Field, TableSkeleton, Notice } from '../components/ui/Ui';

const DESIGNATIONS = ['Professor', 'Associate Professor', 'Assistant Professor'];
const ID_TONE = { verified: 'good', unverified: 'warn', conflict: 'bad', rejected: 'neutral' };

function AddModal({ onClose, onDone }) {
  const [v, setV] = useState({ name: '', designation: 'Assistant Professor', email: '', scopus: '', orcid: '', scholar: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim())); const { data } = await api.post('/faculty', body); onDone(data.validation); onClose(); }
    catch (x) { setErr(errMsg(x) + (x.response?.data?.details ? ': ' + Object.keys(x.response.data.details).join(', ') : '')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add faculty member" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <ErrorState message={err} />}
        <Field label="Full name"><input className="input" required value={v.name} onChange={set('name')} /></Field>
        <Field label="Designation"><select className="input" value={v.designation} onChange={set('designation')}>{DESIGNATIONS.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Official email"><input type="email" className="input" required value={v.email} onChange={set('email')} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Scopus Author ID"><input className="input" value={v.scopus} onChange={set('scopus')} /></Field>
          <Field label="ORCID"><input className="input" placeholder="0000-0000-0000-0000" value={v.orcid} onChange={set('orcid')} /></Field>
          <Field label="Google Scholar ID"><input className="input" value={v.scholar} onChange={set('scholar')} /></Field>
        </div>
        <p className="text-[11px] text-ink-mute">Identifiers are validated for format and checked for conflicts with other faculty before use.</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>Add faculty</button></div>
      </form>
    </Modal>
  );
}

function EditModal({ row, onClose, onDone }) {
  const detail = useApi(`/faculty/${row.id}`);
  const [v, setV] = useState({ name: row.name, designation: row.designation, department: row.department, email: row.email });
  const [idv, setIdv] = useState({ type: 'scopus', value: '' });
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const save = async (e) => { e.preventDefault(); setErr(''); try { await api.put(`/faculty/${row.id}`, v); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); } };
  const addId = async () => {
    setErr(''); setMsg('');
    try { const { data } = await api.post(`/faculty/${row.id}/identifiers`, idv); setMsg(data.identifier.status === 'conflict' ? 'Saved, but it conflicts with another faculty member. See the verification queue.' : 'Identifier saved as unverified.'); setIdv({ ...idv, value: '' }); detail.reload(); onDone(); }
    catch (x) { setErr(errMsg(x)); }
  };
  const resolve = async (id, action) => { try { await api.post(`/faculty/identifiers/${id}/resolve`, { action }); detail.reload(); onDone(); } catch (x) { setErr(errMsg(x)); } };
  return (
    <Modal title={`Edit ${row.name}`} onClose={onClose} wide>
      {err && <div className="mb-3"><ErrorState message={err} /></div>}
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        <Field label="Full name"><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Designation"><select className="input" value={v.designation} onChange={(e) => setV({ ...v, designation: e.target.value })}>{DESIGNATIONS.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Department"><input className="input" value={v.department} onChange={(e) => setV({ ...v, department: e.target.value })} /></Field>
        <Field label="Email"><input type="email" className="input" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <div className="col-span-2 flex justify-end"><button className="btn btn-primary">Save details</button></div>
      </form>
      <h2 className="mb-2 mt-4 border-t border-line pt-4">Researcher identifiers</h2>
      <table className="w-full text-[13px]"><tbody>
        {(detail.data?.identifiers || []).filter((i) => ['scopus', 'orcid', 'scholar'].includes(i.type)).map((i) => (
          <tr key={i._id} className="border-b border-line"><td className="py-1.5 text-xs capitalize text-ink-soft">{i.type}</td><td className="py-1.5">{i.value}</td><td className="py-1.5"><Badge tone={ID_TONE[i.status]} title={i.note}>{i.status}</Badge></td>
            <td className="py-1.5 text-right">{['unverified', 'conflict'].includes(i.status) && <button className="btn" onClick={() => resolve(i._id, 'verify')}>Verify</button>}</td></tr>))}
      </tbody></table>
      <div className="mt-3 flex items-end gap-2">
        <Field label="Add / replace"><select className="input" value={idv.type} onChange={(e) => setIdv({ ...idv, type: e.target.value })}><option value="scopus">Scopus ID</option><option value="orcid">ORCID</option><option value="scholar">Google Scholar ID</option></select></Field>
        <div className="flex-1"><Field label="Value"><input className="input" value={idv.value} onChange={(e) => setIdv({ ...idv, value: e.target.value })} /></Field></div>
        <button className="btn" onClick={addId} disabled={idv.value.length < 3}>Save identifier</button>
      </div>
      {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}
    </Modal>
  );
}

export default function FacultyManage() {
  const { data, loading, error, reload } = useApi('/faculty?includeInactive=true');
  const [modal, setModal] = useState(null);
  const [result, setResult] = useState(null);
  const file = useRef();

  const toggleActive = async (r) => {
    if (r.active && !window.confirm(`Deactivate ${r.name}? Their publication history is kept, but they are excluded from department totals and syncs.`)) return;
    try { await api.put(`/faculty/${r.id}`, { active: !r.active }); reload(); } catch (e) { setResult({ error: errMsg(e) }); }
  };
  const upload = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { const { data: d } = await api.post('/faculty/import', fd); setResult({ imported: d.imported, rejected: d.rejected, conflicts: d.validation.conflicts }); reload(); }
    catch (x) { setResult({ error: errMsg(x) }); }
    file.current.value = '';
  };

  return (
    <div>
      <PageHeader title="Faculty management" description="Add, edit or deactivate faculty and manage their researcher identifiers. All changes are written to the audit log."
        actions={<>
          <input ref={file} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={upload} />
          <button className="btn" onClick={() => file.current.click()}><Upload className="h-3.5 w-3.5" /> Import CSV / Excel</button>
          <button className="btn btn-primary" onClick={() => setModal({ type: 'add' })}><Plus className="h-3.5 w-3.5" /> Add faculty</button>
        </>} />
      {result?.error && <div className="mb-3"><ErrorState message={result.error} /></div>}
      {result && !result.error && <div className="mb-3"><Notice tone={result.rejected?.length || result.conflicts?.length ? 'warn' : 'info'}>Imported {result.imported} faculty.{result.rejected?.length > 0 && ` ${result.rejected.length} row(s) rejected (rows ${result.rejected.map((r) => r.row).join(', ')}).`}{result.conflicts?.length > 0 && ` ${result.conflicts.length} identifier conflict(s) need review in the verification queue.`}</Notice></div>}
      <p className="mb-3 text-[11px] text-ink-mute">CSV/Excel columns: Name, Designation, Email, Google Scholar ID, ORCID, Scopus Author ID.</p>
      <Card pad={false}>
        {error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : loading && !data ? <TableSkeleton cols={5} /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-[13px]">
            <thead><tr><th className="th">Faculty</th><th className="th">Email</th><th className="th">Papers</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead>
            <tbody>{data.items.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'opacity-60'}><td className="td"><Link className="font-medium text-brand hover:underline" to={`/faculty/${r.id}`}>{r.name}</Link><div className="text-[11px] text-ink-mute">{r.designation}</div></td>
                <td className="td text-xs">{r.email}</td><td className="td tabular-nums">{r.totalPapers}</td>
                <td className="td"><Badge tone={r.active ? 'good' : 'neutral'}>{r.active ? 'Active' : 'Deactivated'}</Badge></td>
                <td className="td"><div className="flex justify-end gap-2"><button className="btn" onClick={() => setModal({ type: 'edit', row: r })}><Pencil className="h-3.5 w-3.5" /> Edit</button>
                  <button className="btn" onClick={() => toggleActive(r)}>{r.active ? <><UserX className="h-3.5 w-3.5" /> Deactivate</> : <><UserCheck className="h-3.5 w-3.5" /> Reactivate</>}</button></div></td></tr>))}</tbody></table></div>)}
      </Card>
      {modal?.type === 'add' && <AddModal onClose={() => setModal(null)} onDone={(val) => { reload(); if (val?.conflicts?.length) setResult({ imported: 1, conflicts: val.conflicts }); }} />}
      {modal?.type === 'edit' && <EditModal row={modal.row} onClose={() => setModal(null)} onDone={reload} />}
    </div>
  );
}
