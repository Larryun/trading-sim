import { memo, useMemo  } from 'react';
import { agentColor, agentStyleLabel } from '../sim/agents';
import type { Agent } from '../sim/types';
import { colors, tabularNums } from '../ui';

interface Segment {
  label: string;
  shares: number;
  color: string;
}

/**
 * "Who owns the float?" — a stacked bar of share ownership by strategy (traders
 * split by style), plus the user. Shared between the market and stats views.
 */
export const FloatOwnership = memo(function FloatOwnership({
  agents,
  currentPrice: _currentPrice,
  totalFloat,
  userShares,
}: {
  agents: Agent[];
  currentPrice?: number;
  totalFloat: number;
  userShares: number;
}) {
  const segments = useMemo<Segment[]>(() => {
    const m = new Map<string, Segment>();
    for (const a of agents) {
      const key = a.type === 'trader' ? `trader:${a.style}` : a.type;
      const seg = m.get(key) ?? { label: agentStyleLabel(a), color: agentColor(a), shares: 0 };
      seg.shares += a.shares;
      m.set(key, seg);
    }
    const list = [...m.values()].sort((x, y) => y.shares - x.shares);
    list.push({ label: 'You', shares: userShares, color: colors.user });
    return list;
  }, [agents, userShares]);

  // Show EVERY cohort that exists, including ones at zero or net short. Filtering by
  // `shares > 0` made entries appear and disappear as holdings crossed zero, which
  // changed the number of legend rows — and therefore the panel's height — every few
  // ticks, shifting everything below it. A stable row count is what stops the jitter.
  const shown = segments;
  const pct = (n: number) => (totalFloat > 0 ? (n / totalFloat) * 100 : 0);

  return (
    <div>
      <div style={{ display: 'flex', height: 16, borderRadius: 6, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
        {shown.map((s) => (
          // Short (negative) holdings contribute no width rather than a negative one.
          <div key={s.label} style={{ width: `${Math.max(0, pct(s.shares))}%`, background: s.color }} title={`${s.label}: ${Math.round(s.shares).toLocaleString()} (${pct(s.shares).toFixed(1)}%)`} />
        ))}
      </div>
      {/* Fixed-width GRID slots, not flex-wrap: with wrapping, an item jumps between one
          and two lines every time a percentage gains or loses a digit, so the legend
          visibly jitters as the market moves. Tabular figures keep each number's width
          constant too. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '3px 12px', fontSize: 11, color: colors.muted, marginTop: 6, ...tabularNums }}>
        {shown.map((s) => (
          <span key={s.label} style={{ display: 'flex', gap: 5, alignItems: 'baseline', minWidth: 0 }} title={`${s.label}: ${Math.round(s.shares).toLocaleString()}`}>
            <span style={{ color: s.color, flex: '0 0 auto' }}>■</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span style={{ marginLeft: 'auto', flex: '0 0 auto', color: s.shares < 0 ? colors.down : colors.text }}>{pct(s.shares).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
});
