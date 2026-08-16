import { useMemo, useState } from 'react';
import { useSim } from '../SimContext';
import { panel, pageWrap } from '../ui';

export function OptionsView() {
  const sim = useSim();
  const [qty, setQty] = useState(1);

  // Group the chain by strike so calls sit left, puts right, on one row.
  const rows = useMemo(() => {
    const byStrike = new Map<number, { strike: number; call?: typeof sim.optionChain[number]; put?: typeof sim.optionChain[number] }>();
    for (const c of sim.optionChain) {
      const r = byStrike.get(c.strike) ?? { strike: c.strike };
      if (c.type === 'call') r.call = c; else r.put = c;
      byStrike.set(c.strike, r);
    }
    return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  }, [sim.optionChain]);

  const spot = sim.currentPrice;

  return (
    <div style={pageWrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
          Trade calls and puts (cash-settled at expiry). The <b>dealer</b> takes the other side and
          <b> delta-hedges in the stock</b> — so your buying creates real hedging flow (a gamma squeeze).
        </p>
        <label style={{ marginLeft: 'auto', fontSize: 13, color: '#bbb', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={sim.optionsEnabled} onChange={(e) => sim.enableOptions(e.target.checked)} />
          Options market enabled
        </label>
      </div>

      {!sim.optionsEnabled && <div style={{ ...panel, color: '#888' }}>Enable the options market above to trade the chain.</div>}

      {sim.optionsEnabled && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Tile label="Spot" value={`$${spot.toFixed(2)}`} color="#4ade80" />
            <Tile label="Ticks to expiry" value={sim.ticksToExpiry.toLocaleString()} />
            <Tile label="Your option P&L" value={fmt(sim.optionPnl)} color={sim.optionPnl >= 0 ? '#4ade80' : '#f87171'} />
            <Tile label="Contract size" value="×100 shares" />
            <label style={{ ...panel, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#888' }}>Trade size (contracts)</span>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                style={{ background: '#0f0f1e', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '4px 8px', fontSize: 15 }} />
            </label>
          </div>

          <div style={{ ...panel, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
              <thead>
                <tr style={{ color: '#888' }}>
                  <th colSpan={4} style={{ padding: 6, color: '#4ade80', borderBottom: '1px solid #2a2a3a' }}>CALLS</th>
                  <th style={{ padding: 6, borderBottom: '1px solid #2a2a3a' }}>Strike</th>
                  <th colSpan={4} style={{ padding: 6, color: '#f87171', borderBottom: '1px solid #2a2a3a' }}>PUTS</th>
                </tr>
                <tr style={{ color: '#666', fontSize: 11 }}>
                  <Th>δ</Th><Th>Pos</Th><Th>Price</Th><Th>Trade</Th>
                  <Th>$</Th>
                  <Th>Trade</Th><Th>Price</Th><Th>Pos</Th><Th>δ</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const atm = Math.abs(r.strike - spot) < Math.abs(rows[0].strike - spot) + 0.01 && Math.min(...rows.map((x) => Math.abs(x.strike - spot))) === Math.abs(r.strike - spot);
                  return (
                    <tr key={r.strike} style={{ borderTop: '1px solid #1f1f2e', background: atm ? '#1a1a2e' : undefined }}>
                      <Td>{r.call ? r.call.delta.toFixed(2) : '—'}</Td>
                      <Td color={r.call && r.call.userQty ? '#22d3ee' : '#666'}>{r.call?.userQty || 0}</Td>
                      <Td>{r.call ? `$${r.call.price.toFixed(2)}` : '—'}</Td>
                      <Td>{r.call && <TradeButtons onBuy={() => sim.tradeOption(r.call!.id, qty)} onSell={() => sim.tradeOption(r.call!.id, -qty)} canSell={!!r.call.userQty} />}</Td>
                      <Td><b style={{ color: '#eee' }}>{r.strike}</b></Td>
                      <Td>{r.put && <TradeButtons onBuy={() => sim.tradeOption(r.put!.id, qty)} onSell={() => sim.tradeOption(r.put!.id, -qty)} canSell={!!r.put.userQty} />}</Td>
                      <Td>{r.put ? `$${r.put.price.toFixed(2)}` : '—'}</Td>
                      <Td color={r.put && r.put.userQty ? '#22d3ee' : '#666'}>{r.put?.userQty || 0}</Td>
                      <Td>{r.put ? r.put.delta.toFixed(2) : '—'}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
              Buy = long the option (limited by cash). Sell = close your long. At expiry each contract cash-settles
              to its intrinsic value. Watch the market chart: heavy call buying makes the short-gamma dealer buy stock
              as price rises — an accelerating squeeze.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TradeButtons({ onBuy, onSell, canSell }: { onBuy: () => void; onSell: () => void; canSell: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <button onClick={onBuy} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>B</button>
      <button onClick={onSell} disabled={!canSell} style={{ background: canSell ? '#dc2626' : '#333', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: canSell ? 'pointer' : 'default', fontSize: 11 }}>S</button>
    </span>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ ...panel, padding: 12 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? '#eee', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '4px 6px', fontWeight: 500 }}>{children}</th>;
}
function Td({ children, color }: { children: React.ReactNode; color?: string }) {
  return <td style={{ padding: '4px 6px', color: color ?? '#ddd' }}>{children}</td>;
}

function fmt(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : a.toFixed(0);
  return `${v >= 0 ? '+' : '-'}$${s}`;
}
