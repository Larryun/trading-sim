import type { Agent, Trade } from '../sim/types';
import { AGENT_TYPE_COLORS } from '../sim/agents';

interface Props {
  trades: Trade[];
  agents: Agent[];
}

const USER_COLOR = '#a78bfa';

export function TradeLog({ trades, agents }: Props) {
  const byId = new Map(agents.map((a) => [a.id, a]));

  // Resolve an owner id to a display name + color (by agent type).
  const resolve = (id: string): { label: string; color: string } => {
    if (id === 'user') return { label: 'YOU', color: USER_COLOR };
    const a = byId.get(id);
    if (a) return { label: a.name, color: AGENT_TYPE_COLORS[a.type] };
    return { label: id, color: '#777' }; // e.g. an agent that was since removed
  };

  return (
    <div>
      <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Trade Log</h3>
      <div
        style={{
          maxHeight: 200,
          overflowY: 'auto',
          fontSize: 12,
          fontFamily: 'monospace',
          border: '1px solid #2a2a3a',
          borderRadius: 8,
          background: '#0f0f1e',
        }}
      >
        {trades.length === 0 && <div style={{ padding: 12, color: '#666' }}>No trades yet…</div>}
        {trades.map((t) => {
          const isUser = t.buyerId === 'user' || t.sellerId === 'user';
          // The aggressor is whoever crossed the spread on this trade's side.
          const actor = resolve(t.side === 'buy' ? t.buyerId : t.sellerId);
          return (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 12px',
                borderBottom: '1px solid #1a1a2a',
                background: isUser ? '#1e1e3a' : 'transparent',
              }}
            >
              <span style={{ color: '#666', width: 44 }}>#{t.tick}</span>
              <span style={{ color: t.side === 'buy' ? '#4ade80' : '#f87171', width: 36 }}>{t.side.toUpperCase()}</span>
              <span style={{ color: '#ddd', width: 56, textAlign: 'right' }}>{t.size.toFixed(1)}</span>
              <span style={{ color: '#eee', width: 64, textAlign: 'right' }}>${t.price.toFixed(2)}</span>
              <span style={{ color: actor.color, flex: 1, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {actor.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
