import { useState } from 'react';
import type { AgentAccount, Side } from '../sim/types';
import type { UserFill } from '../hooks/useSimulation';

interface Props {
  submitUserOrder: (side: Side, size: number, limitPrice?: number) => void;
  cancelUserOrders: () => void;
  user: AgentAccount;
  currentPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  restingOrders: number;
  unrealizedPnl: number;
  lastFill: UserFill;
}

const btn = (bg: string): React.CSSProperties => ({
  flex: 1,
  padding: '10px 0',
  fontSize: 15,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  color: '#fff',
  background: bg,
});

export function TradePanel({ submitUserOrder, cancelUserOrders, user, currentPrice, bestBid, bestAsk, restingOrders, unrealizedPnl, lastFill }: Props) {
  const [size, setSize] = useState(100);
  const [useLimit, setUseLimit] = useState(false);
  const [limitPrice, setLimitPrice] = useState(currentPrice);

  // Seed the limit price from the live market when the user turns limit on, so
  // it isn't a stale value that rests far from the current price.
  const toggleLimit = (on: boolean) => {
    setUseLimit(on);
    if (on) setLimitPrice(Number(currentPrice.toFixed(2)));
  };

  const equity = user.cash + user.shares * currentPrice;

  // Slippage: how far the average fill price moved from the pre-trade price.
  const slippagePct = lastFill ? ((lastFill.avgPrice - lastFill.priceBefore) / lastFill.priceBefore) * 100 : 0;

  const submit = (side: Side) => submitUserOrder(side, size, useLimit ? limitPrice : undefined);

  return (
    <div>
      <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Your Trades</h3>

      {/* Live top of book */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 10, color: '#888' }}>
        <span>bid <span style={{ color: '#4ade80' }}>{bestBid != null ? `$${bestBid.toFixed(2)}` : '—'}</span></span>
        <span>spread <span style={{ color: '#ddd' }}>{bestBid != null && bestAsk != null ? `$${(bestAsk - bestBid).toFixed(2)}` : '—'}</span></span>
        <span>ask <span style={{ color: '#f87171' }}>{bestAsk != null ? `$${bestAsk.toFixed(2)}` : '—'}</span></span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[10, 100, 1000].map((preset) => (
          <button
            key={preset}
            onClick={() => setSize(preset)}
            style={{
              flex: 1,
              padding: '6px 0',
              fontSize: 12,
              borderRadius: 5,
              border: '1px solid #333',
              cursor: 'pointer',
              background: size === preset ? '#333' : '#1a1a2e',
              color: '#ddd',
            }}
          >
            {preset}
          </button>
        ))}
      </div>

      <input
        type="number"
        min={1}
        value={size}
        onChange={(e) => setSize(Math.max(0, Number(e.target.value)))}
        style={{
          width: '100%',
          padding: '8px 10px',
          marginBottom: 8,
          borderRadius: 6,
          border: '1px solid #333',
          background: '#0f0f1e',
          color: '#eee',
          boxSizing: 'border-box',
        }}
      />

      {/* Order type: market (take now) vs limit (rest in the book) */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#aaa', marginBottom: 8 }}>
        <input type="checkbox" checked={useLimit} onChange={(e) => toggleLimit(e.target.checked)} />
        Limit order
        {useLimit && (
          <input
            type="number"
            step={0.01}
            value={limitPrice}
            onChange={(e) => setLimitPrice(Math.max(0.01, Number(e.target.value)))}
            style={{ marginLeft: 'auto', width: 90, padding: '5px 8px', borderRadius: 6, border: '1px solid #333', background: '#0f0f1e', color: '#eee' }}
          />
        )}
      </label>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button style={btn('#16a34a')} onClick={() => submit('buy')}>{useLimit ? 'Buy limit' : 'Buy'}</button>
        <button style={btn('#dc2626')} onClick={() => submit('sell')}>{useLimit ? 'Sell limit' : 'Sell'}</button>
      </div>

      <button
        onClick={cancelUserOrders}
        disabled={restingOrders === 0}
        style={{ width: '100%', padding: '6px 0', marginBottom: 12, fontSize: 12, borderRadius: 6, border: '1px solid #333', background: '#1a1a2e', color: restingOrders ? '#aaa' : '#555', cursor: restingOrders ? 'pointer' : 'default' }}
      >
        {restingOrders > 0 ? `Cancel my resting orders (${restingOrders})` : 'No resting orders'}
      </button>

      {/* What the most recent order actually executed at (incl. slippage). */}
      {lastFill && (
        <div
          style={{
            fontSize: 12,
            padding: '8px 10px',
            marginBottom: 14,
            borderRadius: 6,
            background: '#0f0f1e',
            border: '1px solid #2a2a3a',
          }}
        >
          <div style={{ color: '#aaa', marginBottom: 2 }}>
            Last {lastFill.side}: <span style={{ color: '#eee' }}>{lastFill.size.toFixed(1)} sh</span> @{' '}
            <span style={{ color: '#eee' }}>${lastFill.avgPrice.toFixed(2)}</span> avg
          </div>
          <div style={{ color: '#888' }}>
            (pre-trade ${lastFill.priceBefore.toFixed(2)} · slippage{' '}
            <span style={{ color: slippagePct >= 0 ? '#4ade80' : '#f87171' }}>
              {slippagePct >= 0 ? '+' : ''}{slippagePct.toFixed(2)}%
            </span>
            )
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, lineHeight: 1.9 }}>
        <Row label="Price" value={`$${currentPrice.toFixed(2)}`} />
        <Row label="Position" value={`${user.shares.toFixed(0)} sh`} />
        <Row label="Avg cost" value={user.shares !== 0 ? `$${user.avgCost.toFixed(2)}` : '—'} />
        <Row label="Cash" value={`$${user.cash.toFixed(2)}`} />
        <Row
          label="Unrealized PnL"
          value={fmtSigned(unrealizedPnl)}
          color={unrealizedPnl >= 0 ? '#4ade80' : '#f87171'}
        />
        <Row
          label="Realized PnL"
          value={fmtSigned(user.realizedPnl)}
          color={user.realizedPnl >= 0 ? '#4ade80' : '#f87171'}
        />
        <Row label="Equity" value={`$${equity.toFixed(2)}`} />
      </div>
    </div>
  );
}

function fmtSigned(v: number): string {
  return `${v >= 0 ? '+' : ''}$${v.toFixed(2)}`;
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: color ?? '#eee', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
