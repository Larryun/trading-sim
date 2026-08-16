import type { FloatBreakdown } from '../hooks/useSimulation';
import { colors, tabularNums } from '../ui';

interface Props {
  floatBreakdown: FloatBreakdown;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export function SupplyBar({ floatBreakdown }: Props) {
  const { total, agents, user, dealer } = floatBreakdown;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 13, color: colors.muted }}>
        Shares outstanding <span style={{ color: colors.text, fontWeight: 600, ...tabularNums }}>{fmt(total)}</span>
        <span style={{ color: colors.muted, marginLeft: 8, fontSize: 11 }}>(held entirely by participants — no backstop)</span>
      </div>

      {/* Ownership breakdown bar: agents vs you */}
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
          {/* Widths are clamped at 0: a short position holds NEGATIVE shares, which would
              otherwise render as a negative width and silently distort the bar. */}
          <div style={{ width: `${Math.max(0, pct(agents))}%`, background: '#60a5fa' }} title={`Agents: ${fmt(agents)}`} />
          <div style={{ width: `${Math.max(0, pct(dealer))}%`, background: '#eab308' }} title={`Options dealer (hedge inventory): ${fmt(dealer)}`} />
          <div style={{ width: `${Math.max(0, pct(user))}%`, background: colors.user }} title={`You: ${fmt(user)}`} />
        </div>
        {/* Fixed grid slots so the legend doesn't reflow between one and two lines as the
            numbers gain/lose digits. */}
        {/* Always render all three entries — a conditional row would appear and disappear
            as the dealer's hedge crossed zero, changing this panel's height every few ticks. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '2px 12px', fontSize: 11, color: colors.muted, marginTop: 4, ...tabularNums }}>
          <span style={{ whiteSpace: 'nowrap' }}><span style={{ color: '#60a5fa' }}>■</span> agents {fmt(agents)} ({pct(agents).toFixed(0)}%)</span>
          <span style={{ whiteSpace: 'nowrap' }}><span style={{ color: '#eab308' }}>■</span> dealer {fmt(dealer)} ({pct(dealer).toFixed(1)}%)</span>
          <span style={{ whiteSpace: 'nowrap' }}><span style={{ color: colors.user }}>■</span> you {fmt(user)} ({pct(user).toFixed(1)}%)</span>
        </div>
      </div>
    </div>
  );
}
