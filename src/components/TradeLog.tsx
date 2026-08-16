import { memo, useMemo  } from 'react';
import type { Agent, Trade } from '../sim/types';
import { AGENT_TYPE_COLORS } from '../sim/agents';
import { colors, mono, tabularNums } from '../ui';
import { SectionHeaderRow } from './kit';

interface Props {
  trades: Trade[];
  agents: Agent[];
}

const USER_COLOR = colors.user;

export const TradeLog = memo(function TradeLog({ trades, agents }: Props) {
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  // Resolve an owner id to a display name + color (by agent type).
  const resolve = (id: string): { label: string; color: string } => {
    if (id === 'user') return { label: 'YOU', color: USER_COLOR };
    const a = byId.get(id);
    if (a) return { label: a.name, color: AGENT_TYPE_COLORS[a.type] };
    return { label: id, color: colors.muted }; // e.g. an agent that was since removed
  };

  return (
    <div>
      <SectionHeaderRow>Trade Log</SectionHeaderRow>
      <div
        style={{
          maxHeight: 200,
          overflowY: 'auto',
          fontSize: 12,
          fontFamily: mono,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          background: colors.bg0,
        }}
      >
        {trades.length === 0 && <div style={{ padding: 12, color: colors.muted }}>No trades yet…</div>}
        {trades.map((t) => {
          const isUser = t.buyerId === 'user' || t.sellerId === 'user';
          // The aggressor crossed the spread; the counterparty was resting (usually a maker).
          const aggressor = resolve(t.side === 'buy' ? t.buyerId : t.sellerId);
          const counterparty = resolve(t.side === 'buy' ? t.sellerId : t.buyerId);
          return (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderBottom: `1px solid ${colors.bg2}`,
                background: isUser ? colors.bg2 : 'transparent',
              }}
            >
              <span style={{ ...tabularNums, color: colors.muted, width: 40 }}>#{t.tick}</span>
              <span style={{ color: t.side === 'buy' ? colors.up : colors.down, width: 34 }}>{t.side.toUpperCase()}</span>
              <span style={{ ...tabularNums, color: colors.text, width: 48, textAlign: 'right' }}>{t.size.toFixed(1)}</span>
              <span style={{ ...tabularNums, color: colors.text, width: 56, textAlign: 'right' }}>${t.price.toFixed(2)}</span>
              {/* aggressor (bold) took liquidity from the counterparty (dim maker) */}
              <span style={{ flex: 1, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ color: aggressor.color, fontWeight: 600 }}>{aggressor.label}</span>
                <span style={{ color: colors.muted }}> ← </span>
                <span style={{ color: counterparty.color, opacity: 0.75 }}>{counterparty.label}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
