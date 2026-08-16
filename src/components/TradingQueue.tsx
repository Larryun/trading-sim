import type { RestingUserOrder } from '../sim/orderBook';
import { colors, tabularNums } from '../ui';
import { SectionHeaderRow } from './kit';

/**
 * The user's live order queue: resting limit orders and dormant stop orders (both
 * persist across ticks until they fill / trigger), with a cancel-all affordance.
 */
export function TradingQueue({ orders, onCancel }: { orders: RestingUserOrder[]; onCancel: () => void }) {
  const sorted = [...orders].sort((a, b) => b.price - a.price);
  return (
    <div>
      <SectionHeaderRow
        right={
          <button onClick={onCancel} disabled={orders.length === 0}
            style={{ fontSize: 10, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '2px 8px', background: colors.bg2, color: orders.length ? '#f87171' : '#555', cursor: orders.length ? 'pointer' : 'default' }}>
            Cancel all
          </button>
        }
      >Order queue ({orders.length})</SectionHeaderRow>

      {orders.length === 0 && <div style={{ fontSize: 11, color: colors.muted }}>No working orders. Limit &amp; stop orders rest here until they fill or trigger.</div>}

      {orders.length > 0 && (
        <div style={{ ...tabularNums, fontSize: 11 }}>
          <div style={{ display: 'flex', color: colors.muted, paddingBottom: 3 }}>
            <span style={{ width: 90 }}>type</span>
            <span style={{ flex: 1, textAlign: 'right' }}>trigger/limit</span>
            <span style={{ flex: 1, textAlign: 'right' }}>size</span>
          </div>
          {sorted.map((o) => (
            <div key={`${o.kind}${o.id}`} style={{ display: 'flex', padding: '2px 0', borderTop: `1px solid ${colors.bg2}` }}>
              <span style={{ width: 90, color: o.side === 'buy' ? colors.up : colors.down }}>
                {o.side.toUpperCase()} {o.kind === 'stop' ? 'STOP' : 'LIMIT'}
              </span>
              <span style={{ flex: 1, textAlign: 'right', color: colors.text }}>${o.price.toFixed(2)}</span>
              <span style={{ flex: 1, textAlign: 'right', color: colors.text }}>{o.size.toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
