import { useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { UserCog, KeyRound, UsersRound, Library, LayoutDashboard, Users, FileText, ShieldCheck, RefreshCw, Settings2, Download, BookOpen, LogOut, Menu, X, ChevronRight, UserCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api, errMsg } from '../../api/client';
import { Modal, Field, ErrorState, Notice } from '../ui/Ui';

const ROLE_LABEL = { super_admin: 'Super Admin', hod: 'Head of Department', faculty: 'Faculty', viewer: 'Read-only viewer' };

function nav(user, canViewAll, isAdmin) {
  const items = [];
  if (canViewAll) items.push({ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }, { to: '/faculty', label: 'Faculty', icon: Users });
  else items.push({ to: `/faculty/${user.faculty}`, label: 'My research profile', icon: UserCircle });
  items.push({ to: '/publications', label: 'Publications', icon: FileText });
  if (canViewAll) items.push({ to: '/journals', label: 'Journals', icon: Library }, { to: '/coauthors', label: 'Co-authors', icon: UsersRound });
  if (isAdmin) items.push({ to: '/verification', label: 'Verification', icon: ShieldCheck }, { to: '/sync', label: 'Synchronization', icon: RefreshCw }, { to: '/manage', label: 'Faculty management', icon: Settings2 }, { to: '/users', label: 'Users', icon: UserCog });
  items.push({ to: '/reports', label: 'Reports', icon: Download }, { to: '/definitions', label: 'Definitions', icon: BookOpen });
  return items;
}

const CRUMBS = { users: 'Users', coauthors: 'Co-authors', journals: 'Journals', faculty: 'Faculty', publications: 'Publications', verification: 'Verification', sync: 'Synchronization', manage: 'Faculty management', reports: 'Reports', definitions: 'Definitions' };

function Breadcrumbs({ override }) {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return <span className="text-ink-soft">Dashboard</span>;
  return (
    <nav className="flex items-center gap-1 text-[13px] text-ink-soft" aria-label="Breadcrumb">
      <Link to="/" className="hover:text-ink">Home</Link>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-ink-mute" />
          {i === parts.length - 1 ? <span className="font-medium text-ink">{CRUMBS[p] || (override ?? 'Details')}</span> : <Link to={'/' + parts.slice(0, i + 1).join('/')} className="hover:text-ink">{CRUMBS[p] || 'Details'}</Link>}
        </span>
      ))}
    </nav>
  );
}

function ChangePassword({ onClose }) {
  const [v, setV] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [err, setErr] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (v.newPassword !== v.confirm) return setErr('The new passwords do not match');
    setBusy(true);
    try { await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }); setDone(true); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Change your password" onClose={onClose}>
      {done ? <><Notice>Password changed. Use the new one next time you sign in.</Notice><div className="mt-4 flex justify-end"><button className="btn btn-primary" onClick={onClose}>Close</button></div></> : (
        <form onSubmit={submit} className="space-y-3">
          {err && <ErrorState message={err} />}
          <Field label="Current password"><input type="password" className="input" required autoComplete="current-password" value={v.currentPassword} onChange={set('currentPassword')} /></Field>
          <Field label="New password (at least 8 characters)"><input type="password" className="input" required minLength={8} autoComplete="new-password" value={v.newPassword} onChange={set('newPassword')} /></Field>
          <Field label="Repeat new password"><input type="password" className="input" required minLength={8} autoComplete="new-password" value={v.confirm} onChange={set('confirm')} /></Field>
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>Change password</button></div>
        </form>)}
    </Modal>
  );
}

export default function Layout() {
  const { user, logout, canViewAll, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const items = nav(user, canViewAll, isAdmin);

  const side = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-brand text-[13px] font-bold text-white">KLE</div>
        <div className="leading-tight"><p className="text-[13px] font-semibold">Research Portal</p><p className="text-[11px] text-ink-mute">KLE Technological University</p></div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
            className={({ isActive }) => `flex items-center gap-2.5 rounded px-3 py-2 text-[13px] font-medium ${isActive ? 'bg-brand-tint text-brand' : 'text-ink-soft hover:bg-canvas hover:text-ink'}`}>
            <Icon className="h-4 w-4" strokeWidth={1.75} />{label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-line p-3 text-[11px] leading-snug text-ink-mute">Data from Scopus, OpenAlex, ORCID, Crossref and Semantic Scholar. Counts are shown per source.</div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-white lg:block">{side}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">{side}</aside></div>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded p-1.5 hover:bg-canvas lg:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
            <Breadcrumbs />
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block"><p className="text-[13px] font-medium">{user.facultyName || (user.name === ROLE_LABEL[user.role] ? user.email : user.name)}</p><p className="text-[11px] text-ink-mute">{ROLE_LABEL[user.role]}</p></div>
            <button className="btn" onClick={() => setPw(true)} title="Change your password"><KeyRound className="h-3.5 w-3.5" /><span className="hidden md:inline"> Password</span></button>
            <button className="btn" onClick={logout}><LogOut className="h-3.5 w-3.5" /> Sign out</button>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 lg:p-6"><Outlet /></main>
        {pw && <ChangePassword onClose={() => setPw(false)} />}
      </div>
    </div>
  );
}
