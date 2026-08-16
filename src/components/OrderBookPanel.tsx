import type { BookLevel } from '../sim/orderBook';
import { SectionHeaderRow } from './kit';

interface Props {
  bids: BookLevel[];
  asks: BookLevel[];
}

const USER = '#a78bfa';

export function OrderBookPanel({ bids, asks }: Props) {
  // Max size across shown levels, to scale the depth bars.
  const maxSize = Math.max(1, ...bids.map((l) => l.size), ...asks.map((l) => l.size));
  const spread = bids[0] && asks[0] ? asks[0].price - bids[0].price : null;

  return (
    <div>
      <SectionHeaderRow right={<span style={{ fontSize: 10, color: USER }}>◆ your size</span>}>Order Book</SectionHeaderRow>
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
