import { AlertTriangle, Inbox, ChevronLeft, ChevronRight, X, Info } from 'lucide-react';
import { useEffect } from 'react';

export function Card({ title, subtitle, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-mute">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Skeleton({ className = 'h-4 w-full', style }) { return <div className={`skeleton ${className}`} style={style} />; }

export function StatCard({ label, value, source, hint, loading }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      {loading ? <Skeleton className="mt-2 h-7 w-20" /> : (
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${value === 'N/A' ? 'text-ink-mute' : ''}`}>{value}</p>
      )}
      {(source || hint) && !loading && (
        <p className="mt-1 text-[11px] leading-snug text-ink-mute">{source && <span className="font-medium text-ink-soft">{source}</span>}{source && hint ? ' · ' : ''}{hint}</p>
      )}
    </div>
  );
}

const TONES = {
  neutral: 'bg-canvas text-ink-soft border-line',
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200',
  info: 'bg-brand-tint text-brand border-brand/20',
};
export function Badge({ tone = 'neutral', children, title }) {
  return <span title={title} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

export function EmptyState({ title = 'No data', hint, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <Icon className="h-6 w-6 text-ink-mute" strokeWidth={1.5} />
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      {hint && <p className="max-w-sm text-xs text-ink-mute">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex items-start gap-3 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1"><p className="font-medium">Could not load this data</p><p className="text-xs">{message}</p></div>
      {onRetry && <button className="btn" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Notice({ children, tone = 'info' }) {
  return (
    <div className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${TONES[tone]}`}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><div>{children}</div>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h1>{title}</h1>{description && <p className="mt-1 max-w-3xl text-[13px] text-ink-soft">{description}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Pagination({ page, pages, total, limit, onPage }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1, to = Math.min(total, page * limit);
  return (
    <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-ink-soft">
      <span>{from}–{to} of {total.toLocaleString('en-IN')}</span>
      <div className="flex items-center gap-1">
        <button className="btn !px-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        <span className="px-2">Page {page} of {pages}</span>
        <button className="btn !px-1.5" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card w-full ${wide ? 'max-w-2xl' : 'max-w-md'} shadow-xl`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2>{title}</h2>
          <button className="rounded p-1 hover:bg-canvas" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }) { return <div><label className="label">{label}</label>{children}</div>; }

export function TableSkeleton({ rows = 6, cols = 6 }) {
  return <div className="space-y-2 p-4">{Array.from({ length: rows }).map((_, i) => <div key={i} className="flex gap-3">{Array.from({ length: cols }).map((__, j) => <Skeleton key={j} className="h-5 flex-1" />)}</div>)}</div>;
}
