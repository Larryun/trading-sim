import { useMemo } from 'react';
import { useSim } from '../SimContext';
import { panel, pageWrap, colors, tabularNums } from '../ui';
import { agentColor, agentStyleLabel, explainDecision, type Verdict } from '../sim/agents';
import type { Agent, MarketState } from '../sim/types';

const VERDICT_STYLE: Record<Verdict, { label: string; color: string }> = {
  buy: { label: 'WOULD BUY', color: colors.up },
  sell: { label: 'WOULD SELL', color: colors.down },
  hold: { label: 'HOLDS', color: colors.muted },
  quote: { label: 'QUOTES BOTH', color: '#2dd4bf' }, // teal = liquidity provision (categorical)
};

export function AgentDecisionsView() {
  const sim = useSim();
  const market: MarketState = useMemo(
    () => ({ priceHistory: sim.recentPrices, tick: sim.tick, sentiment: sim.sentiment, fundamentalValue: sim.fundamentalValue }),
    [sim.recentPrices, sim.tick, sim.sentiment, sim.fundamentalValue],
  );

  // One representative per kind of trader to explain its live decision. Traders are
  // split by STYLE (each personality decides differently), everyone else by type.
  const reps = useMemo(() => {
    const byKind = new Map<string, { agent: Agent; count: number }>();
    for (const a of sim.agents) {
      const key = a.type === 'trader' ? `trader:${a.style}` : a.type;
      const e = byKind.get(key);
      if (e) e.count++;
      else byKind.set(key, { agent: a, count: 1 });
    }
    return [...byKind.entries()].map(([key, v]) => ({ key, ...v }));
  }, [sim.agents]);

  return (
    <div style={pageWrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <p style={{ margin: 0, color: colors.muted, fontSize: 13 }}>
          How each kind of trader decides, right now — the live signals it reads and what it would do this instant.
        </p>
        <span style={{ ...tabularNums, fontSize: 12, color: colors.muted }}>
          price <span style={{ color: colors.up }}>${sim.currentPrice.toFixed(2)}</span> · fair{' '}
          <span style={{ color: colors.accent }}>${sim.fundamentalValue.toFixed(2)}</span> · sentiment{' '}
          <span style={{ color: sim.sentiment >= 0 ? colors.up : colors.down }}>{sim.sentiment.toFixed(2)}</span>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {reps.map(({ key, agent, count }) => {
          const ex = explainDecision(agent, market);
          const vs = VERDICT_STYLE[ex.verdict];
          const color = agentColor(agent);
          return (
            <div key={key} style={{ ...panel }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
                <span style={{ fontWeight: 700, fontSize: 14, color }}>{agentStyleLabel(agent)}</span>
                <span style={{ fontSize: 11, color: colors.muted }}>×{count}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: vs.color, border: `1px solid ${vs.color}55`, borderRadius: 5, padding: '2px 8px' }}>
                  {vs.label}
                </span>
              </div>

              <div style={{ fontSize: 12, color: colors.muted, fontStyle: 'italic', marginBottom: 8 }}>{ex.rule}</div>

              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', fontSize: 12, marginBottom: 8 }}>
                {ex.signals.map((s) => (
                  <div key={s.label} style={{ display: 'contents' }}>
                    <span style={{ color: colors.muted }}>{s.label}</span>
                    <span style={{ ...tabularNums, textAlign: 'right', color: s.lean > 0 ? colors.up : s.lean < 0 ? colors.down : colors.text }}>{s.value}</span>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12, color: colors.muted, borderTop: `1px solid ${colors.border}`, paddingTop: 8 }}>{ex.detail}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
