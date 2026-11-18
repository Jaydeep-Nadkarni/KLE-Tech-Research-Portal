import { useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { errMsg } from '../api/client';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(email, password); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden flex-col justify-between bg-brand p-12 text-white lg:flex">
        <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded bg-white/15 text-sm font-bold">KLE</div><span className="text-sm font-medium">KLE Technological University</span></div>
        <div>
          <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">Faculty Research Intelligence &amp; Analytics</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/75">Publications, citations and indexing status for every faculty member, gathered from Scopus, OpenAlex, ORCID, Crossref and Semantic Scholar, with the source of every number shown.</p>
        </div>
        <p className="text-xs text-white/55">Citation counts are reported per source and are never combined.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div><h1>Sign in</h1><p className="mt-1 text-[13px] text-ink-soft">Use your university email address.</p></div>
          {error && <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 p-2.5 text-xs text-red-800" role="alert"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
          <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="label" htmlFor="pw">Password</label><input id="pw" type="password" required autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <button className="btn btn-primary w-full !py-2" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Sign in</button>
        </form>
      </div>
    </div>
  );
}
