import { useMemo } from 'react';
import { agentColor, agentStyleLabel } from '../sim/agents';
import type { Agent } from '../sim/types';

interface Segment {
  label: string;
  shares: number;
  color: string;
}

/**
 * "Who owns the float?" — a stacked bar of share ownership by strategy (traders
 * split by style), plus the user. Shared between the market and stats views.
 */
export function FloatOwnership({
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
    list.push({ label: 'You', shares: userShares, color: '#a78bfa' });
    return list;
  }, [agents, userShares]);

  const shown = segments.filter((s) => s.shares > 0.01);
  const pct = (n: number) => (totalFloat > 0 ? (n / totalFloat) * 100 : 0);

  return (
    <div>
      <div style={{ display: 'flex', height: 16, borderRadius: 6, overflow: 'hidden', border: '1px solid #2a2a3a' }}>
        {shown.map((s) => (
          <div key={s.label} style={{ width: `${pct(s.shares)}%`, background: s.color }} title={`${s.label}: ${Math.round(s.shares).toLocaleString()} (${pct(s.shares).toFixed(1)}%)`} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11, color: '#888', marginTop: 6 }}>
        {shown.map((s) => (
          <span key={s.label}>
            <span style={{ color: s.color }}>■</span> {s.label} {pct(s.shares).toFixed(1)}%
          </span>
        ))}
      </div>
    </div>
  );
}
