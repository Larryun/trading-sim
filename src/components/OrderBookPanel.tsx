import type { BookLevel, RestingUserOrder } from '../sim/orderBook';

interface Props {
  bids: BookLevel[];
  asks: BookLevel[];
  myOrders: RestingUserOrder[];
}

const USER = '#a78bfa';

export function OrderBookPanel({ bids, asks, myOrders }: Props) {
  // Max size across shown levels, to scale the depth bars.
  const maxSize = Math.max(1, ...bids.map((l) => l.size), ...asks.map((l) => l.size));
  const spread = bids[0] && asks[0] ? asks[0].price - bids[0].price : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {/* All resting limit orders, aggregated by price level */}
      <div>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#ccc' }}>Order Book</h4>
        <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
          <Header />
          {/* asks: show worst-to-best so the best ask sits just above the spread */}
          {[...asks].reverse().map((l) => (
            <Level key={`a${l.price}`} level={l} side="sell" maxSize={maxSize} />
          ))}
          <div style={{ textAlign: 'center', color: '#666', padding: '3px 0', borderBlock: '1px solid #2a2a3a' }}>
            spread {spread != null ? `$${spread.toFixed(2)}` : '—'}
          </div>
          {bids.map((l) => (
            <Level key={`b${l.price}`} level={l} side="buy" maxSize={maxSize} />
          ))}
          {bids.length === 0 && asks.length === 0 && <div style={{ color: '#666', padding: 8 }}>Book is empty.</div>}
        </div>
        <div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>
          <span style={{ color: USER }}>◆</span> = your resting size at that level
        </div>
      </div>

      {/* The user's own resting limit orders */}
      <div>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#ccc' }}>My Resting Orders ({myOrders.length})</h4>
        <div style={{ fontFamily: 'monospace', fontSize: 11, border: '1px solid #2a2a3a', borderRadius: 6, background: '#0f0f1e', maxHeight: 220, overflowY: 'auto' }}>
          <div style={{ display: 'flex', padding: '4px 10px', color: '#666', borderBottom: '1px solid #2a2a3a' }}>
            <span style={{ width: 48 }}>side</span>
            <span style={{ flex: 1, textAlign: 'right' }}>price</span>
            <span style={{ flex: 1, textAlign: 'right' }}>size</span>
          </div>
          {myOrders.length === 0 && <div style={{ color: '#666', padding: 10 }}>No resting orders.</div>}
          {myOrders.map((o) => (
            <div key={`${o.kind}${o.id}`} style={{ display: 'flex', padding: '3px 10px', borderBottom: '1px solid #1a1a2a' }}>
              <span style={{ width: 64, color: o.side === 'buy' ? '#4ade80' : '#f87171' }}>
                {o.side.toUpperCase()}{o.kind === 'stop' ? ' STOP' : ''}
              </span>
              <span style={{ flex: 1, textAlign: 'right', color: '#eee' }}>${o.price.toFixed(2)}</span>
              <span style={{ flex: 1, textAlign: 'right', color: '#ddd' }}>{o.size.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div style={{ display: 'flex', padding: '2px 6px', color: '#666' }}>
      <span style={{ width: 70 }}>price</span>
      <span style={{ width: 60, textAlign: 'right' }}>size</span>
      <span style={{ flex: 1 }} />
    </div>
  );
}

function Level({ level, side, maxSize }: { level: BookLevel; side: 'buy' | 'sell'; maxSize: number }) {
  const color = side === 'buy' ? '#4ade80' : '#f87171';
  const barPct = (level.size / maxSize) * 100;
  const hasUser = level.userSize > 1e-6;
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', padding: '2px 6px' }}>
      {/* depth bar */}
      <div style={{ position: 'absolute', right: 0, top: 1, bottom: 1, width: `${barPct}%`, background: `${color}22`, borderRadius: 3 }} />
      <span style={{ width: 70, color, zIndex: 1 }}>${level.price.toFixed(2)}</span>
      <span style={{ width: 60, textAlign: 'right', color: '#ddd', zIndex: 1 }}>{level.size.toFixed(0)}</span>
      <span style={{ flex: 1, textAlign: 'right', zIndex: 1, color: USER }}>
        {hasUser ? `◆ ${level.userSize.toFixed(0)}` : ''}
      </span>
    </div>
  );
}
