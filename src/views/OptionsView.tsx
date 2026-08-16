import { useMemo, useState } from 'react';
import { useSim } from '../SimContext';
import { colors, tabularNums, panel, pageWrap, fmtMoney } from '../ui';
import { Tile, Th, Td, inputStyle, SectionHeaderRow } from '../components/kit';
import { OpenInterestChart } from '../components/OpenInterestChart';

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
  const oiRows = rows.map((r) => ({
    strike: r.strike,
    callOi: r.call?.openInterest ?? 0,
    putOi: r.put?.openInterest ?? 0,
    callGamma: r.call?.gamma ?? 0,
    putGamma: r.put?.gamma ?? 0,
  }));
  const totalOi = oiRows.reduce((s, r) => s + r.callOi + r.putOi, 0);

  return (
    <div style={pageWrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <p style={{ margin: 0, color: colors.muted, fontSize: 13, maxWidth: 780 }}>
          Trade calls and puts (cash-settled at expiry). The <b>dealer</b> is a built-in counterparty
          (not an agent you add): it <b>writes every option</b> bought here — by you and by the
          speculator agents — and then <b>delta-hedges in the stock</b>, buying as its exposure rises
          and selling as it falls. That hedging flow hits the same order book, which is how a
          <b> gamma squeeze</b> (or pinning) emerges. Its position and P&amp;L are shown below.
        </p>
        <label style={{ marginLeft: 'auto', fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={sim.optionsEnabled} onChange={(e) => sim.enableOptions(e.target.checked)} />
          Options market enabled
        </label>
      </div>

      {!sim.optionsEnabled && <div style={{ ...panel, color: colors.muted }}>Enable the options market above to trade the chain.</div>}

      {sim.optionsEnabled && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Tile label="Spot" value={`$${spot.toFixed(2)}`} color={colors.up} />
            <Tile label="Ticks to expiry" value={sim.ticksToExpiry.toLocaleString()} />
            <Tile label="Your option P&L" value={fmtMoney(sim.optionPnl)} color={sim.optionPnl >= 0 ? colors.up : colors.down} />
            <Tile label="Implied vol" value={`${(sim.dealerState.impliedVol * 100).toFixed(0)}%`} title="Annualized vol used to price the chain — tracks recent realized volatility plus a risk premium" />
            <Tile label="Dealer hedge" value={`${Math.round(sim.dealerState.shares).toLocaleString()} sh`}
              color={sim.dealerState.shares >= 0 ? colors.up : colors.down}
              title="The dealer's stock position, held to offset the options it has written. It buys/sells the underlying as this target moves — the source of gamma flow." />
            <Tile label="Dealer P&L" value={fmtMoney(sim.dealerState.pnl)} color={sim.dealerState.pnl >= 0 ? colors.up : colors.down}
              title="Premium collected minus hedging losses and expiry payouts. Delta-hedging a short-gamma book loses money on the hedges — the premium is what pays for it." />
            <label style={{ ...panel, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: colors.muted }}>Trade size (contracts)</span>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                style={{ ...inputStyle }} />
            </label>
          </div>

          {/* Open interest by strike — where dealer hedging pressure concentrates */}
          <div style={{ ...panel, marginBottom: 12 }}>
            <SectionHeaderRow right={<span style={{ ...tabularNums, fontSize: 10, color: colors.muted }}>total OI {totalOi.toLocaleString()} contracts</span>}>
              Open interest by strike
            </SectionHeaderRow>
            <OpenInterestChart rows={oiRows} spot={spot} />
          </div>

          <div style={{ ...panel, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, ...tabularNums, textAlign: 'center' }}>
              <thead>
                <tr style={{ color: colors.muted }}>
                  <th colSpan={4} style={{ padding: 6, color: colors.up, borderBottom: `1px solid ${colors.border}` }}>CALLS</th>
                  <th style={{ padding: 6, borderBottom: `1px solid ${colors.border}` }}>Strike</th>
                  <th colSpan={4} style={{ padding: 6, color: colors.down, borderBottom: `1px solid ${colors.border}` }}>PUTS</th>
                </tr>
                <tr style={{ color: colors.muted, fontSize: 11 }}>
                  <Th align="center">δ</Th><Th align="center">Pos</Th><Th align="center">Price</Th><Th align="center">Trade</Th>
                  <Th align="center">$</Th>
                  <Th align="center">Trade</Th><Th align="center">Price</Th><Th align="center">Pos</Th><Th align="center">δ</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const atm = Math.abs(r.strike - spot) < Math.abs(rows[0].strike - spot) + 0.01 && Math.min(...rows.map((x) => Math.abs(x.strike - spot))) === Math.abs(r.strike - spot);
                  return (
                    <tr key={r.strike} style={{ borderTop: `1px solid ${colors.border}`, background: atm ? colors.bg2 : undefined }}>
                      <Td align="center">{r.call ? r.call.delta.toFixed(2) : '—'}</Td>
                      <Td align="center" color={r.call && r.call.userQty ? colors.accent : colors.muted}>{r.call?.userQty || 0}</Td>
                      <Td align="center">{r.call ? `$${r.call.price.toFixed(2)}` : '—'}</Td>
                      <Td align="center">{r.call && <TradeButtons onBuy={() => sim.tradeOption(r.call!.id, qty)} onSell={() => sim.tradeOption(r.call!.id, -qty)} canSell={!!r.call.userQty} />}</Td>
                      <Td align="center"><b style={{ color: colors.text }}>{r.strike}</b></Td>
                      <Td align="center">{r.put && <TradeButtons onBuy={() => sim.tradeOption(r.put!.id, qty)} onSell={() => sim.tradeOption(r.put!.id, -qty)} canSell={!!r.put.userQty} />}</Td>
                      <Td align="center">{r.put ? `$${r.put.price.toFixed(2)}` : '—'}</Td>
                      <Td align="center" color={r.put && r.put.userQty ? colors.accent : colors.muted}>{r.put?.userQty || 0}</Td>
                      <Td align="center">{r.put ? r.put.delta.toFixed(2) : '—'}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>
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
      <button onClick={onBuy} style={{ background: colors.up, color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>B</button>
      <button onClick={onSell} disabled={!canSell} style={{ background: canSell ? colors.down : colors.border, color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: canSell ? 'pointer' : 'default', fontSize: 11 }}>S</button>
    </span>
  );
}
