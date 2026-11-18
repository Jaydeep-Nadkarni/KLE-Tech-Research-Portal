import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { PALETTE } from '../../utils/format';
import { Card, EmptyState, Skeleton } from '../ui/Ui';

const TICK = { fill: '#4a5666', fontSize: 11 };
const axis = { stroke: '#cfd6de', tickLine: false, tick: TICK };
const tip = { contentStyle: { border: '1px solid #e3e7ec', borderRadius: 6, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.06)' }, cursor: { fill: 'rgba(31,78,121,.06)' } };

export function ChartCard({ title, subtitle, source, loading, empty, emptyHint, height = 260, children, className }) {
  return (
    <Card title={title} subtitle={subtitle} className={className}>
      {loading ? <Skeleton className="w-full" style={{ height }} /> : empty ? <EmptyState title="Not available" hint={emptyHint || 'No data for the current selection.'} />
        : <div style={{ height }}>{children}</div>}
      {source && !loading && !empty && <p className="mt-2 text-[11px] text-ink-mute">Source: {source}</p>}
    </Card>
  );
}

export function Bars({ data, x = 'name', series, stacked, layout = 'horizontal' }) {
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout={layout} margin={{ top: 4, right: 8, left: vertical ? 8 : -12, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f4" vertical={vertical} horizontal={!vertical} />
        {vertical ? <><XAxis type="number" {...axis} allowDecimals={false} /><YAxis type="category" dataKey={x} width={130} {...axis} interval={0} /></>
          : <><XAxis dataKey={x} {...axis} /><YAxis {...axis} allowDecimals={false} /></>}
        <Tooltip {...tip} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => <Bar isAnimationActive={false} key={s.key} dataKey={s.key} name={s.name || s.key} stackId={stacked ? 'a' : undefined} fill={s.color || PALETTE[i % PALETTE.length]} radius={stacked ? 0 : [2, 2, 0, 0]} maxBarSize={vertical ? 16 : 32} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Areas({ data, x = 'year', series }) {
  return (
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f4" vertical={false} />
        <XAxis dataKey={x} {...axis} /><YAxis {...axis} allowDecimals={false} />
        <Tooltip {...tip} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => <Area isAnimationActive={false} key={s.key} type="monotone" dataKey={s.key} name={s.name || s.key} stroke={s.color || PALETTE[i]} fill={s.color || PALETTE[i]} fillOpacity={0.12} strokeWidth={2} />)}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Lines({ data, x = 'year', series }) {
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="#eef1f4" vertical={false} />
        <XAxis dataKey={x} {...axis} /><YAxis {...axis} allowDecimals={false} />
        <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => <Line isAnimationActive={false} key={s.key} type="monotone" dataKey={s.key} name={s.name || s.key} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex h-full items-center gap-4">
      <div className="h-full min-w-0 flex-1">
        <ResponsiveContainer>
          <PieChart>
            <Pie isAnimationActive={false} data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={1} stroke="#fff">
              {data.map((d, i) => <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip {...tip} formatter={(v, name) => [`${v} (${total ? Math.round((v / total) * 100) : 0}%)`, name]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-44 shrink-0 space-y-1.5 text-xs">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="truncate" title={d.name}>{d.name}</span></span>
            <span className="font-medium tabular-nums">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
