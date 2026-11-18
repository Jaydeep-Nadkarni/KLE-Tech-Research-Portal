import { useState } from 'react';
import { Download } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, PageHeader, Field, Notice } from '../components/ui/Ui';
import { SOURCES } from '../utils/format';

const YEARS = Array.from({ length: new Date().getFullYear() - 2009 }, (_, i) => new Date().getFullYear() - i);

function IeeeCard({ canViewAll, faculty }) {
  const [v, setV] = useState({ format: 'pdf', facultyId: '', yearFrom: '', yearTo: '', venueType: '', scopusOnly: false, sort: 'year' });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const href = `/api/reports/ieee${qs({ ...v, scopusOnly: v.scopusOnly ? 'true' : '' })}`;
  return (
    <Card className="mt-6" title="Publication list in IEEE format" subtitle="IEEE reference style (numbered, initials first, quoted titles, italic venue). Ready to paste into a report or import into a reference manager.">
      <div className="grid gap-4 sm:grid-cols-2">
        {canViewAll && <Field label="Faculty"><select className="input" value={v.facultyId} onChange={set('facultyId')}><option value="">All faculty (each paper once)</option>{faculty?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>}
        <Field label="Format"><select className="input" value={v.format} onChange={set('format')}><option value="pdf">PDF (.pdf)</option><option value="docx">Word (.docx)</option><option value="txt">Plain text (.txt)</option><option value="bib">BibTeX (.bib, IEEEtran)</option></select></Field>
        <Field label="From calendar year"><select className="input" value={v.yearFrom} onChange={set('yearFrom')}><option value="">Start</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></Field>
        <Field label="To calendar year"><select className="input" value={v.yearTo} onChange={set('yearTo')}><option value="">Present</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></Field>
        <Field label="Paper type"><select className="input" value={v.venueType} onChange={set('venueType')}><option value="">All</option><option value="journal">Journal papers</option><option value="conference">Conference papers</option><option value="book">Book chapters</option></select></Field>
        <Field label="Order"><select className="input" value={v.sort} onChange={set('sort')}><option value="year">Newest first</option><option value="author">By first author</option></select></Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.scopusOnly} onChange={set('scopusOnly')} /> Only papers confirmed in Scopus</label>
      <p className="mt-3 text-[11px] text-ink-mute">Fields no source holds are left out rather than guessed. "et al." is used for more than six authors, and where only the first author is known (Scopus lists just one). Journal names are as recorded, not IEEE abbreviations.</p>
      <div className="mt-4 flex justify-end"><a className="btn btn-primary" href={href}><Download className="h-3.5 w-3.5" /> Download IEEE list</a></div>
    </Card>
  );
}

export default function Reports() {
  const { canViewAll, user } = useAuth();
  const types = useApi('/reports/types');
  const faculty = useApi(canViewAll ? '/faculty' : null);
  const [v, setV] = useState({ type: canViewAll ? 'department' : 'faculty', format: 'pdf', facultyId: '', source: 'scopus', yearFrom: '', yearTo: '' });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const needsFaculty = v.type === 'faculty';
  const available = Object.entries(types.data?.types || {}).filter(([k]) => canViewAll || k === 'faculty');
  const href = `/api/reports/export${qs({ ...v, facultyId: canViewAll ? v.facultyId : user.faculty })}`;
  const blocked = canViewAll && needsFaculty && !v.facultyId;

  return (
    <div>
      <PageHeader title="Reports" description="Download research reports as Excel or CSV. Every file includes its sources, generation date and the definitions used." />
      <div className="max-w-2xl"><Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Report"><select className="input" value={v.type} onChange={set('type')}>{available.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></Field>
          <Field label="Format"><select className="input" value={v.format} onChange={set('format')}><option value="pdf">PDF (.pdf)</option><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></select></Field>
          {canViewAll && <Field label={needsFaculty ? 'Faculty (required)' : 'Faculty (optional)'}><select className="input" value={v.facultyId} onChange={set('facultyId')}><option value="">{needsFaculty ? 'Select…' : 'All faculty'}</option>{faculty.data?.items.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>}
          {['department', 'comparison'].includes(v.type) && <Field label="Citation source"><select className="input" value={v.source} onChange={set('source')}>{SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>}
          <Field label="From calendar year"><select className="input" value={v.yearFrom} onChange={set('yearFrom')}><option value="">Start</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></Field>
          <Field label="To calendar year"><select className="input" value={v.yearTo} onChange={set('yearTo')}><option value="">Present</option>{YEARS.map((y) => <option key={y}>{y}</option>)}</select></Field>
        </div>
        <div className="mt-4"><Notice>Year filters use the publication <b>calendar year</b>, not the academic year. PDFs are A4 landscape with the sources and definitions printed on the report.</Notice></div>
        <div className="mt-4 flex justify-end"><a className={`btn btn-primary ${blocked ? 'pointer-events-none opacity-50' : ''}`} href={blocked ? undefined : href} aria-disabled={blocked}><Download className="h-3.5 w-3.5" /> Download report</a></div>
      </Card>
      <IeeeCard canViewAll={canViewAll} faculty={faculty.data?.items} /></div>
    </div>
  );
}
