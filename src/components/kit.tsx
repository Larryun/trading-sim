import { colors, mono, tabularNums } from '../ui';

/** A compact labeled stat chip (label above, mono value below). */
export function Stat({ label, value, color, title }: { label: string; value: string; color?: string; title?: string }) {
  return (
    <div title={title} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ ...tabularNums, fontSize: 14, fontWeight: 700, color: color ?? colors.text, whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

/** One aligned parameter row: label · slider · value, in a fixed 3-column grid. */
export function Param({
  label, value, min, max, step, onChange, format, title,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string; title?: string;
}) {
  return (
    <label title={title} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 60px', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ color: colors.muted }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%' }} />
      <span style={{ ...tabularNums, color: colors.text, textAlign: 'right' }}>{format ? format(value) : value}</span>
    </label>
  );
}

/** A section header bar with an optional right-aligned slot. */
export function SectionHeaderRow({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.muted, paddingBottom: 6, marginBottom: 8, borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span>{children}</span>
      {right}
    </div>
  );
}

/**
 * Tiny PnL sparkline. `data` is a bounded series (fixed-capacity ring upstream), so
 * this stays cheap. Auto-scales to its own min/max; a dashed zero line if it straddles 0;
 * line colored green/red by the last value's sign.
 */
export function Sparkline({ data, width = 72, height = 22 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <svg width={width} height={height} />;
  let min = Infinity, max = -Infinity;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  const path = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = data[data.length - 1];
  const stroke = last > 0 ? colors.up : last < 0 ? colors.down : colors.muted;
  const zeroInRange = min < 0 && max > 0;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {zeroInRange && <line x1={0} y1={y(0)} x2={width} y2={y(0)} stroke={colors.border} strokeDasharray="2 2" />}
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.25} />
    </svg>
  );
}

export { colors, mono };
