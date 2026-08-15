import { useMemo } from 'react';
import { useSim } from '../SimContext';
import { panel, pageWrap } from '../ui';
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS, explainDecision, type Verdict } from '../sim/agents';
import type { Agent, AgentType, MarketState } from '../sim/types';

const AGENT_TYPES: AgentType[] = ['noise', 'momentum', 'meanReversion', 'news', 'value', 'fomoHerd', 'whale', 'panicSeller', 'marketMaker'];

const VERDICT_STYLE: Record<Verdict, { label: string; color: string }> = {
  buy: { label: 'WOULD BUY', color: '#4ade80' },
  sell: { label: 'WOULD SELL', color: '#f87171' },
  hold: { label: 'HOLDS', color: '#888' },
  quote: { label: 'QUOTES BOTH', color: '#2dd4bf' },
};

export function AgentDecisionsView() {
  const sim = useSim();
  const market: MarketState = useMemo(
    () => ({ priceHistory: sim.recentPrices, tick: sim.tick, sentiment: sim.sentiment, fundamentalValue: sim.fundamentalValue }),
    [sim.recentPrices, sim.tick, sim.sentiment, sim.fundamentalValue],
  );

  // One representative agent per type present, to explain that type's live decision.
  const reps = useMemo(() => {
    const byType = new Map<AgentType, { agent: Agent; count: number }>();
    for (const a of sim.agents) {
      const e = byType.get(a.type);
      if (e) e.count++;
      else byType.set(a.type, { agent: a, count: 1 });
    }
    return AGENT_TYPES.filter((t) => byType.has(t)).map((t) => ({ type: t, ...byType.get(t)! }));
  }, [sim.agents]);

  return (
    <div style={pageWrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
          How each kind of trader decides, right now — the live signals it reads and what it would do this instant.
        </p>
        <span style={{ fontSize: 12, color: '#666' }}>
          price <span style={{ color: '#4ade80' }}>${sim.currentPrice.toFixed(2)}</span> · fair{' '}
          <span style={{ color: '#22d3ee' }}>${sim.fundamentalValue.toFixed(2)}</span> · sentiment{' '}
          <span style={{ color: sim.sentiment >= 0 ? '#4ade80' : '#f87171' }}>{sim.sentiment.toFixed(2)}</span>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {reps.map(({ type, agent, count }) => {
          const ex = explainDecision(agent, market);
          const vs = VERDICT_STYLE[ex.verdict];
          const color = AGENT_TYPE_COLORS[type];
          return (
            <div key={type} style={{ ...panel }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
                <span style={{ fontWeight: 700, fontSize: 14, color }}>{AGENT_TYPE_LABELS[type]}</span>
                <span style={{ fontSize: 11, color: '#666' }}>×{count}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: vs.color, border: `1px solid ${vs.color}55`, borderRadius: 5, padding: '2px 8px' }}>
                  {vs.label}
                </span>
              </div>

              <div style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic', marginBottom: 8 }}>{ex.rule}</div>

              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', fontSize: 12, marginBottom: 8 }}>
                {ex.signals.map((s) => (
                  <div key={s.label} style={{ display: 'contents' }}>
                    <span style={{ color: '#777' }}>{s.label}</span>
                    <span style={{ textAlign: 'right', color: s.lean > 0 ? '#4ade80' : s.lean < 0 ? '#f87171' : '#ddd', fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12, color: '#bbb', borderTop: '1px solid #2a2a3a', paddingTop: 8 }}>{ex.detail}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
