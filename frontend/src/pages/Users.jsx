import { useState } from 'react';
import { Plus, KeyRound, Trash2, Copy, Check } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api, errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, PageHeader, Badge, ErrorState, Modal, Field, TableSkeleton, Notice } from '../components/ui/Ui';
import { dateTime, ago } from '../utils/format';

const ROLE_LABEL = { super_admin: 'Super admin', hod: 'Head of Department', faculty: 'Faculty', viewer: 'Read-only viewer' };
const ROLE_HELP = { super_admin: 'Everything, including managing other super admins', hod: 'Full department access: faculty, sync, reports, users', faculty: 'Sees only their own research profile', viewer: 'Can view all dashboards and reports, cannot change anything' };

function PasswordReveal({ password, onClose, title = 'Password created' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(password); setCopied(true); } catch { /* ignore */ } };
  return (
    <Modal title={title} onClose={onClose}>
      <Notice tone="warn">This password is shown <b>once</b>. It is stored only as a hash and cannot be recovered. Copy it now and share it securely.</Notice>
      <div className="mt-3 flex items-center gap-2"><code className="flex-1 select-all rounded border border-line-strong bg-canvas px-3 py-2 text-[15px]">{password}</code>
        <button className="btn" onClick={copy}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}</button></div>
      <div className="mt-4 flex justify-end"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

function AddModal({ roles, faculty, canSuper, onClose, onDone }) {
  const [v, setV] = useState({ email: '', name: '', role: 'hod', facultyId: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const body = { email: v.email, name: v.name, role: v.role, ...(v.role === 'faculty' ? { facultyId: v.facultyId } : {}), ...(v.password ? { password: v.password } : {}) }; const { data } = await api.post('/users', body); onDone(data); }
    catch (x) { setErr(errMsg(x) + (x.response?.data?.details ? ': ' + Object.keys(x.response.data.details).join(', ') : '')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <ErrorState message={err} />}
        <Field label="Full name"><input className="input" required value={v.name} onChange={set('name')} /></Field>
        <Field label="Email (used to sign in)"><input type="email" className="input" required value={v.email} onChange={set('email')} /></Field>
        <Field label="Role"><select className="input" value={v.role} onChange={set('role')}>{roles.filter((r) => canSuper || r !== 'super_admin').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
        <p className="-mt-1 text-[11px] text-ink-mute">{ROLE_HELP[v.role]}</p>
        {v.role === 'faculty' && <Field label="Faculty member"><select className="input" required value={v.facultyId} onChange={set('facultyId')}><option value="">Select…</option>{faculty.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>}
        <Field label="Password (leave empty to generate one)"><input className="input" type="text" minLength={8} autoComplete="off" value={v.password} onChange={set('password')} placeholder="At least 8 characters" /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>Create user</button></div>
      </form>
    </Modal>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useApi('/users');
  const faculty = useApi('/faculty?includeInactive=true');
  const [modal, setModal] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [msg, setMsg] = useState('');
  const canSuper = me.role === 'super_admin';

  const act = async (fn) => { setMsg(''); try { await fn(); reload(); } catch (e) { setMsg(errMsg(e)); } };
  const toggle = (u) => act(() => api.put(`/users/${u.id}`, { active: !u.active }));
  const changeRole = (u, role) => act(() => api.put(`/users/${u.id}`, { role, ...(role === 'faculty' && !u.faculty ? {} : {}) }));
  const reset = (u) => { if (!window.confirm(`Reset the password for ${u.email}? Their current password stops working immediately.`)) return; act(async () => { const { data: d } = await api.post(`/users/${u.id}/reset-password`, {}); setReveal({ title: `New password for ${u.email}`, password: d.generatedPassword }); }); };
  const remove = (u) => { if (!window.confirm(`Delete ${u.email}? This cannot be undone. (To block sign-in but keep the record, deactivate instead.)`)) return; act(() => api.delete(`/users/${u.id}`)); };

  return (
    <div>
      <PageHeader title="Users" description="Accounts that can sign in to the portal. Add more HODs, read-only viewers or faculty accounts here; no configuration files are involved."
        actions={<button className="btn btn-primary" onClick={() => setModal('add')}><Plus className="h-3.5 w-3.5" /> Add user</button>} />
      {msg && <div className="mb-3"><ErrorState message={msg} /></div>}
      <Card pad={false}>
        {error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : loading && !data ? <TableSkeleton cols={5} /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-[13px]">
            <thead><tr><th className="th">User</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last sign-in</th><th className="th text-right">Actions</th></tr></thead>
            <tbody>{data.items.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'opacity-60'}>
                <td className="td"><span className="font-medium">{u.name}</span>{u.id === me.id && <span className="ml-1 text-[11px] text-ink-mute">(you)</span>}<div className="text-[11px] text-ink-mute">{u.email}{u.facultyName ? ` · ${u.facultyName}` : ''}</div></td>
                <td className="td">{u.id === me.id || (u.role === 'super_admin' && !canSuper)
                  ? <Badge tone="info">{ROLE_LABEL[u.role]}</Badge>
                  : <select className="input !w-auto !py-1 text-xs" value={u.role} onChange={(e) => changeRole(u, e.target.value)} aria-label={`Role for ${u.email}`}>{data.roles.filter((r) => canSuper || r !== 'super_admin').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>}</td>
                <td className="td"><Badge tone={u.active ? 'good' : 'neutral'}>{u.active ? 'Active' : 'Deactivated'}</Badge></td>
                <td className="td text-xs text-ink-soft" title={dateTime(u.lastLoginAt)}>{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
                <td className="td"><div className="flex justify-end gap-2">
                  <button className="btn" onClick={() => reset(u)}><KeyRound className="h-3.5 w-3.5" /> Reset password</button>
                  {u.id !== me.id && <><button className="btn" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</button>
                    <button className="btn btn-danger" onClick={() => remove(u)} aria-label={`Delete ${u.email}`}><Trash2 className="h-3.5 w-3.5" /></button></>}
                </div></td>
              </tr>))}</tbody></table></div>)}
      </Card>
      <p className="mt-3 text-[11px] text-ink-mute">Passwords are stored only as hashes. The last active admin cannot be deactivated or deleted, and you cannot change your own role. Faculty accounts are linked to a faculty member and see only their own data.</p>
      {modal === 'add' && <AddModal roles={data?.roles || []} faculty={faculty.data?.items || []} canSuper={canSuper} onClose={() => setModal(null)} onDone={(d) => { setModal(null); reload(); if (d.generatedPassword) setReveal({ title: `Password for ${d.user.email}`, password: d.generatedPassword }); }} />}
      {reveal && <PasswordReveal title={reveal.title} password={reveal.password} onClose={() => setReveal(null)} />}
    </div>
  );
}
