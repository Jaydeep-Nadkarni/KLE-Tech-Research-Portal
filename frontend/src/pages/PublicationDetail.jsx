import { useParams, Link } from 'react-router-dom';
import { ExternalLink, FileDown } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { Card, PageHeader, Badge, ErrorState, Skeleton, Notice } from '../components/ui/Ui';
import { IndexBadge, INDEX_META } from '../components/IndexingBadges';
import { n, dateTime, SOURCES } from '../utils/format';

const Row = ({ label, children }) => (
  <div className="grid grid-cols-[150px_1fr] gap-3 border-b border-line py-2 text-[13px] last:border-0"><dt className="text-xs font-medium text-ink-soft">{label}</dt><dd className="min-w-0 break-words">{children ?? <span className="text-ink-mute">N/A</span>}</dd></div>
);

const latestOf = (ms, name) => ms.filter((m) => m.metric === name && !m.category).sort((a, b) => b.year - a.year)[0];

function JournalRanking({ jr, pubYear }) {
  if (!jr.applicable) return <Card title="Journal ranking"><Notice>{jr.note}</Notice></Card>;
  const ms = jr.metrics || [];
  const row = (label, m, fmt = (v) => v) => (
    <div key={label} className="flex items-start justify-between gap-3"><dt className="text-ink-soft">{label}</dt>
      <dd className="text-right">{m ? <><span className="font-medium tabular-nums">{fmt(m.value)}</span><span className="block text-[11px] text-ink-mute" title={m.source}>{m.year} · {m.source.replace(' API', '').replace(' file', '')}</span></> : <span className="text-ink-mute">N/A</span>}</dd></div>
  );
  const quartiles = ms.filter((m) => m.metric === 'SJR Quartile');
  return (
    <Card title="Journal ranking" subtitle={jr.journal?.title}>
      {!jr.available ? <p className="text-sm text-ink-mute">N/A. {jr.note}</p> : (
        <dl className="space-y-2.5 text-[13px]">
          {row('CiteScore', latestOf(ms, 'CiteScore'))}
          {row('SJR', latestOf(ms, 'SJR') && ms.filter((m) => m.metric === 'SJR').sort((a, b) => b.year - a.year)[0])}
          {row('SNIP', latestOf(ms, 'SNIP'))}
          {row('Best quartile', ms.filter((m) => m.metric === 'SJR Best Quartile').sort((a, b) => b.year - a.year)[0])}
          {quartiles.length > 0 && <div className="border-t border-line pt-2"><p className="mb-1 text-[11px] font-medium text-ink-soft">Quartile by subject category</p>{quartiles.sort((a, b) => b.year - a.year).map((q, i) => <div key={i} className="flex justify-between text-xs"><span>{q.category} <span className="text-ink-mute">({q.year})</span></span><Badge tone="info">{q.value}</Badge></div>)}</div>}
          <div className="flex justify-between"><dt className="text-ink-soft">Impact Factor</dt><dd className="text-ink-mute" title="Needs a Clarivate licence">N/A</dd></div>
          {jr.journal?.subjectAreas?.length > 0 && <div className="border-t border-line pt-2 text-xs text-ink-soft">{jr.journal.subjectAreas.join(' · ')}</div>}
          {jr.journal?.coverage?.start && <p className="text-[11px] text-ink-mute">Scopus coverage {jr.journal.coverage.start}–{jr.journal.coverage.end || 'present'}{pubYear && jr.publicationYearCoveredByScopus === false ? ` (this paper's year, ${pubYear}, is outside coverage)` : ''}.</p>}
          {!ms.some((m) => m.metric === 'SJR Best Quartile') && <p className="text-[11px] text-ink-mute">Quartile N/A: no SCImago data imported. Metric years differ from this paper's publication year.</p>}
        </dl>)}
      {jr.note && jr.available && <p className="mt-2 text-[11px] text-ink-mute">{jr.note}</p>}
    </Card>
  );
}

export default function PublicationDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useApi(`/publications/${id}`);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <div className="space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-48 w-full" /></div>;
  const p = data.publication;
  const pages = p.pages || p.articleNumber;

  return (
    <div>
      <PageHeader title={p.title} description={[p.venue, p.year].filter(Boolean).join(' · ')}
        actions={<>
          {p.doi && <a className="btn" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> DOI</a>}
          {p.pdfUrl && <a className="btn" href={p.pdfUrl} target="_blank" rel="noreferrer"><FileDown className="h-3.5 w-3.5" /> Open-access PDF</a>}
        </>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Abstract">{p.abstract ? <p className="text-[13px] leading-relaxed text-ink-soft">{p.abstract}</p> : <p className="text-sm text-ink-mute">N/A: no provider returned an abstract (Scopus abstracts need an entitlement this key does not have).</p>}</Card>
          <Card title="Bibliographic details">
            <dl>
              <Row label="Authors">{p.authors?.length ? p.authors.map((a) => a.name).join('; ') : undefined}{p.authors?.length === 1 && <span className="ml-1 text-xs text-ink-mute">(first author only; full list unavailable from Scopus at this access level)</span>}</Row>
              <Row label="Faculty authors">{data.faculty.map((f) => <span key={f.id} className="mr-3 inline-block"><Link className="text-brand hover:underline" to={`/faculty/${f.id}`}>{f.name}</Link>{f.authorPosition ? <span className="text-xs text-ink-mute"> (author #{f.authorPosition})</span> : <span className="text-xs text-ink-mute"> (position unknown)</span>}</span>)}</Row>
              <Row label="DOI">{p.doi}</Row>
              <Row label="Journal / conference">{p.venue}</Row>
              <Row label="Publication type">{[p.type, p.venueType !== 'unknown' && `(${p.venueType})`].filter(Boolean).join(' ') || undefined}</Row>
              <Row label="Publisher">{p.publisher}</Row>
              <Row label="Publication date">{p.date || (p.year && String(p.year))}</Row>
              <Row label="Volume / issue">{[p.volume, p.issue].filter(Boolean).join(' / ') || undefined}</Row>
              <Row label="Pages / article no.">{pages}</Row>
              <Row label="ISSN">{p.issn?.join(', ') || undefined}</Row>
              <Row label="ISBN">{p.isbn?.join(', ') || undefined}</Row>
              <Row label="Keywords">{p.keywords?.length ? p.keywords.join(', ') : undefined}</Row>
              <Row label="Research fields">{p.fields?.length ? p.fields.join(', ') : undefined}</Row>
              <Row label="Open access"><Badge tone={p.openAccess === 'yes' ? 'good' : 'neutral'}>{p.openAccess === 'unknown' ? 'Unknown' : p.openAccess === 'yes' ? 'Open access' : 'Not open access'}</Badge></Row>
              <Row label="Scopus EID">{p.eid}</Row>
              <Row label="Last updated">{dateTime(p.updatedAt)}</Row>
            </dl>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Indexing and listing" subtitle="Each source is checked independently">
            <ul className="space-y-2.5">
              {Object.keys(INDEX_META).map((k) => (
                <li key={k} className="text-xs"><div className="flex items-center justify-between gap-2"><span className="text-ink-soft">{INDEX_META[k].role}</span><IndexBadge source={k} state={p.indexing?.[k]} /></div>
                  {p.indexing?.[k]?.evidence && <p className="mt-0.5 text-[11px] text-ink-mute">{p.indexing[k].evidence}</p>}</li>
              ))}
            </ul>
          </Card>
          <Card title="Citations by provider" subtitle="Separate figures; never added together">
            <ul className="space-y-1.5 text-[13px]">
              {SOURCES.map((s) => { const c = p.citations?.[s.value]; return <li key={s.value} className="flex justify-between"><span className="text-ink-soft">{s.label}</span><span className="tabular-nums font-medium">{n(c?.count)}{c?.via === 'manual' && <span className="ml-1 text-xs font-normal text-ink-mute">(manual)</span>}{c?.influential != null && <span className="ml-1 text-xs font-normal text-ink-mute">({c.influential} influential)</span>}</span></li>; })}
            </ul>
          </Card>
          <JournalRanking jr={data.journalRanking} pubYear={p.year} />
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Source records and provenance">
          <ul className="space-y-1.5 text-[13px]">{data.sources.map((s, i) => <li key={i} className="flex items-center justify-between gap-3"><span><Badge tone="info">{s.provider}</Badge> <span className="text-xs text-ink-mute">{s.externalId}</span></span><span className="flex items-center gap-2 text-xs text-ink-mute">{dateTime(s.fetchedAt)}{s.url && <a href={s.url} target="_blank" rel="noreferrer" className="text-brand" aria-label="Open source record"><ExternalLink className="h-3.5 w-3.5" /></a>}</span></li>)}</ul>
        </Card>
        <Card title="Verification and match history">
          <ul className="space-y-2 text-xs">{data.faculty.map((f) => <li key={f.id}><span className="font-medium">{f.name}</span>: <Badge tone={f.verificationStatus === 'verified' ? 'good' : 'neutral'}>{f.verificationStatus}</Badge> match confidence {f.matchConfidence != null ? Math.round(f.matchConfidence * 100) + '%' : 'N/A'}<div className="text-ink-mute">via {f.matchedBy?.join(', ')}</div></li>)}</ul>
          {data.citationHistory.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer text-ink-soft">Citation snapshots ({data.citationHistory.length})</summary>
            <ul className="mt-1 space-y-0.5 text-ink-mute">{data.citationHistory.map((s, i) => <li key={i}>{dateTime(s.retrievedAt)} · {s.provider}: {s.count}</li>)}</ul></details>}
        </Card>
      </div>
    </div>
  );
}
