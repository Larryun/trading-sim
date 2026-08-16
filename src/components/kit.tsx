import { colors, mono, tabularNums, panelTight } from '../ui';

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
 * Tiny P&L sparkline — money made/lost vs breakeven. `data` is total P&L (equity −
 * starting capital) as a bounded series (fixed-capacity ring upstream). The baseline
 * is always **zero** (a dashed breakeven line) and the area between the line and zero
 * is filled green (in profit) or red (at a loss) — so it reads as P&L, not price.
 */
export function Sparkline({ data, width = 72, height = 22 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <svg width={width} height={height} />;
  let min = 0, max = 0; // always include breakeven so 0 is on the chart
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zeroY = y(0);
  const area = `${line} L${x(data.length - 1).toFixed(1)},${zeroY.toFixed(1)} L${x(0).toFixed(1)},${zeroY.toFixed(1)} Z`;
  const last = data[data.length - 1];
  const col = last > 0 ? colors.up : last < 0 ? colors.down : colors.muted;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={area} fill={col} fillOpacity={0.18} stroke="none" />
      <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={colors.border} strokeDasharray="2 2" />
      <path d={line} fill="none" stroke={col} strokeWidth={1.25} />
    </svg>
  );
}

/** Shared input/select style (dark, tokenized). */
export const inputStyle: React.CSSProperties = {
  background: colors.bg0, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 12,
};

/** A stat tile (label + big mono value) — shared by the Stats and Options views. */
export function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ ...panelTight, padding: 12 }}>
      <div style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ ...tabularNums, fontSize: 18, fontWeight: 700, color: color ?? colors.text }}>{value}</div>
    </div>
  );
}

/** Table header / data cells with tokenized colors and tabular numerics. */
export function Th({ children, align = 'right' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return <th style={{ padding: '4px 8px', textAlign: align, fontWeight: 500, color: colors.muted }}>{children}</th>;
}
export function Td({ children, align = 'right', color }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; color?: string }) {
  return <td style={{ ...tabularNums, padding: '4px 8px', textAlign: align, color: color ?? colors.text }}>{children}</td>;
}

export { colors, mono, panelTight };
