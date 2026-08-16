// Shared visual tokens for a dense, professional (Bloomberg-ish) look. Inline styles
// only — no CSS framework. Numbers use the mono stack + tabular figures.

export const colors = {
  bg0: '#0d0d18', // page
  bg1: '#16162a', // panel
  bg2: '#1e1e30', // raised / rows
  border: '#2a2a3a',
  text: '#e5e5e5',
  muted: '#8a8a9a',
  up: '#26a269',
  down: '#e5484d',
  accent: '#3b82f6',
};

export const mono = "'SF Mono', ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace";

export const panel: React.CSSProperties = {
  background: colors.bg1,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: 10,
};

export const panelTight: React.CSSProperties = {
  background: colors.bg1,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: 8,
};

export const sectionHeader: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: colors.muted,
  paddingBottom: 6,
  marginBottom: 8,
  borderBottom: `1px solid ${colors.border}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

export const tabularNums: React.CSSProperties = {
  fontFamily: mono,
  fontVariantNumeric: 'tabular-nums',
};

export const pageWrap: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  color: colors.text,
  fontFamily: 'system-ui, sans-serif',
  boxSizing: 'border-box',
};

/** Green/red by sign (up/down), muted at ~0. */
export function pnlColor(v: number, eps = 1e-9): string {
  return v > eps ? colors.up : v < -eps ? colors.down : colors.muted;
}

/** Compact signed money: +$1.2k / -$340. */
export function fmtMoney(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : a.toFixed(0);
  return `${v >= 0 ? '+' : '-'}$${s}`;
}
