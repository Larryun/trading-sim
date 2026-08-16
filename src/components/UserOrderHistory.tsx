import type { UserOrderRecord } from '../sim/types';
import { colors, mono, tabularNums } from '../ui';
import { SectionHeaderRow } from './kit';

interface Props {
  orders: UserOrderRecord[];
}

export function UserOrderHistory({ orders }: Props) {
  return (
    <div>
      <SectionHeaderRow>Your Order History</SectionHeaderRow>
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
        <div style={{ display: 'flex', padding: '6px 12px', color: colors.muted, borderBottom: `1px solid ${colors.border}`, position: 'sticky', top: 0, background: colors.bg0 }}>
          <span style={{ width: 44 }}>tick</span>
          <span style={{ width: 44 }}>side</span>
          <span style={{ flex: 1, textAlign: 'right' }}>shares</span>
          <span style={{ flex: 1, textAlign: 'right' }}>price</span>
          <span style={{ flex: 1, textAlign: 'right' }}>gain</span>
        </div>
        {orders.length === 0 && <div style={{ padding: 12, color: colors.muted }}>No orders yet — buy or sell to start.</div>}
        {orders.map((o) => (
          <div key={o.id} style={{ display: 'flex', padding: '4px 12px', borderBottom: `1px solid ${colors.bg2}` }}>
            <span style={{ ...tabularNums, width: 44, color: colors.muted }}>#{o.tick}</span>
            <span style={{ width: 44, color: o.side === 'buy' ? colors.up : colors.down }}>{o.side.toUpperCase()}</span>
            <span style={{ ...tabularNums, flex: 1, textAlign: 'right', color: colors.text }}>{o.shares.toFixed(1)}</span>
            <span style={{ ...tabularNums, flex: 1, textAlign: 'right', color: colors.text }}>${o.avgPrice.toFixed(2)}</span>
            <span style={{ ...tabularNums, flex: 1, textAlign: 'right', color: o.side === 'sell' ? (o.gain >= 0 ? colors.up : colors.down) : colors.muted }}>
              {o.side === 'sell' ? `${o.gain >= 0 ? '+' : ''}$${o.gain.toFixed(2)}` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
