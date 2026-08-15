import type { UserOrderRecord } from '../sim/types';

interface Props {
  orders: UserOrderRecord[];
}

export function UserOrderHistory({ orders }: Props) {
  return (
    <div>
      <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Your Order History</h3>
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
        <div style={{ display: 'flex', padding: '6px 12px', color: '#666', borderBottom: '1px solid #2a2a3a', position: 'sticky', top: 0, background: '#0f0f1e' }}>
          <span style={{ width: 44 }}>tick</span>
          <span style={{ width: 44 }}>side</span>
          <span style={{ flex: 1, textAlign: 'right' }}>shares</span>
          <span style={{ flex: 1, textAlign: 'right' }}>price</span>
          <span style={{ flex: 1, textAlign: 'right' }}>gain</span>
        </div>
        {orders.length === 0 && <div style={{ padding: 12, color: '#666' }}>No orders yet — buy or sell to start.</div>}
        {orders.map((o) => (
          <div key={o.id} style={{ display: 'flex', padding: '4px 12px', borderBottom: '1px solid #1a1a2a' }}>
            <span style={{ width: 44, color: '#666' }}>#{o.tick}</span>
            <span style={{ width: 44, color: o.side === 'buy' ? '#4ade80' : '#f87171' }}>{o.side.toUpperCase()}</span>
            <span style={{ flex: 1, textAlign: 'right', color: '#ddd' }}>{o.shares.toFixed(1)}</span>
            <span style={{ flex: 1, textAlign: 'right', color: '#eee' }}>${o.avgPrice.toFixed(2)}</span>
            <span style={{ flex: 1, textAlign: 'right', color: o.side === 'sell' ? (o.gain >= 0 ? '#4ade80' : '#f87171') : '#555' }}>
              {o.side === 'sell' ? `${o.gain >= 0 ? '+' : ''}$${o.gain.toFixed(2)}` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
