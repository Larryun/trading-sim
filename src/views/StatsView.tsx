import { useMemo } from 'react';
import { useSim } from '../SimContext';
import { colors, tabularNums, pnlColor, fmtMoney, panel, pageWrap } from '../ui';
import { Tile, Th, Td, SectionHeaderRow } from '../components/kit';
import { useContainerWidth } from '../components/useContainerWidth';
import { agentColor, agentStyleLabel } from '../sim/agents';
import type { Agent } from '../sim/types';

interface Row {
  key: string;
  label: string;
  color: string;
  count: number;
  shares: number;
  equity: number;
  start: number;
  realized: number;
  unrealized: number;
  trades: number;
}

// Group key: traders split by style (each personality is its own strategy row).
function rowKey(a: Agent): string {
  return a.type === 'trader' ? `trader:${a.style}` : a.type;
}

export function StatsView() {
  const sim = useSim();
  const { agents, currentPrice, fundamentalValue, eps, valuationMultiple, floatBreakdown, bestBid, bestAsk, tick, totalDividendsPaid, totalFeesPaid, user, stepMs } = sim;

  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    for (const a of agents) {
      const key = rowKey(a);
      const r = m.get(key) ?? { key, label: agentStyleLabel(a), color: agentColor(a), count: 0, shares: 0, equity: 0, start: 0, realized: 0, unrealized: 0, trades: 0 };
      r.count++;
      r.shares += a.shares;
      r.equity += a.cash + a.shares * currentPrice;
      r.start += a.startingCapital;
      r.realized += a.realizedPnl;
      r.unrealized += a.shares * (currentPrice - a.avgCost);
      r.trades += a.tradeCount;
      m.set(key, r);
    }
    return [...m.values()].sort((x, y) => (y.equity - y.start) - (x.equity - x.start));
  }, [agents, currentPrice]);

  const totalTrades = agents.reduce((s, a) => s + a.tradeCount, 0);
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const gapPct = fundamentalValue > 0 ? ((currentPrice - fundamentalValue) / fundamentalValue) * 100 : 0;
  const userEquity = user.cash + user.shares * currentPrice;

  const pnlData = rows.map((r) => ({ label: r.label, pnl: Number((r.equity - r.start).toFixed(0)), color: r.color }));

  return (
    <div style={pageWrap}>
      <p style={{ margin: '0 0 16px', color: colors.muted, fontSize: 13 }}>
        Live market analytics — how order flow, strategy mix, and money flows shape the price. Updates with the running market.
      </p>

      {/* Snapshot tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Tile label="Tick" value={tick.toLocaleString()} />
        <Tile label="Price" value={`$${currentPrice.toFixed(2)}`} color={colors.up} />
        <Tile label={`Fair value (EPS×${valuationMultiple})`} value={`$${fundamentalValue.toFixed(2)}`} color={colors.accent} />
        <Tile label="EPS" value={`$${eps.toFixed(2)}`} color={colors.accent} />
        <Tile label="Price vs fair" value={`${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%`} color={Math.abs(gapPct) < 5 ? colors.up : colors.warn} />
        <Tile label="Spread" value={spread != null ? `$${spread.toFixed(2)}` : '—'} />
        <Tile label="Shares outstanding" value={Math.round(floatBreakdown.total).toLocaleString()} />
        <Tile label="Agents" value={String(agents.length)} />
        <Tile label="Total trades" value={totalTrades.toLocaleString()} />
        <Tile label="Compute" value={`${stepMs.toFixed(2)} ms/tick`} />
      </div>

      {/* Cash flows */}
      <div style={{ ...panel, marginBottom: 16 }}>
        <SectionHeaderRow>Money flows (the market isn't a closed cash loop)</SectionHeaderRow>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <Tile label="Dividends paid in" value={`+$${Math.round(totalDividendsPaid).toLocaleString()}`} color={colors.up} />
          <Tile label="Fees paid to broker" value={`-$${Math.round(totalFeesPaid).toLocaleString()}`} color={colors.down} />
          <Tile label="Net external cash" value={`${totalDividendsPaid - totalFeesPaid >= 0 ? '+' : '-'}$${Math.abs(Math.round(totalDividendsPaid - totalFeesPaid)).toLocaleString()}`} />
        </div>
      </div>

      {/* PnL by strategy */}
      <div style={{ ...panel, marginBottom: 16 }}>
        <SectionHeaderRow>Profit &amp; loss by strategy — who's winning?</SectionHeaderRow>
        <PnlBars data={pnlData} />
      </div>

      {/* Per-strategy table */}
      <div style={panel}>
        <SectionHeaderRow>By strategy</SectionHeaderRow>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, ...tabularNums }}>
            <thead>
              <tr style={{ color: colors.muted, textAlign: 'right' }}>
                <Th align="left">Strategy</Th><Th>Count</Th><Th>Shares</Th><Th>% float</Th><Th>Equity</Th><Th>Total PnL</Th><Th>Return</Th><Th>Realized</Th><Th>Unreal.</Th><Th>Trades</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pnl = r.equity - r.start;
                const ret = r.start > 0 ? (r.equity / r.start - 1) * 100 : 0;
                return (
                  <tr key={r.key} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <Td align="left"><span style={{ color: r.color, fontWeight: 600 }}>{r.label}</span></Td>
                    <Td>{r.count}</Td>
                    <Td>{Math.round(r.shares).toLocaleString()}</Td>
                    <Td>{floatBreakdown.total > 0 ? ((r.shares / floatBreakdown.total) * 100).toFixed(1) : '0'}%</Td>
                    <Td>${Math.round(r.equity).toLocaleString()}</Td>
                    <Td color={pnlColor(pnl)}>{fmtMoney(pnl)}</Td>
                    <Td color={pnlColor(ret)}>{ret >= 0 ? '+' : ''}{ret.toFixed(1)}%</Td>
                    <Td color={pnlColor(r.realized)}>{fmtMoney(r.realized)}</Td>
                    <Td color={pnlColor(r.unrealized)}>{fmtMoney(r.unrealized)}</Td>
                    <Td>{r.trades.toLocaleString()}</Td>
                  </tr>
                );
              })}
              {/* You */}
              <tr style={{ borderTop: `2px solid ${colors.border}` }}>
                <Td align="left"><span style={{ color: colors.user, fontWeight: 600 }}>You</span></Td>
                <Td>1</Td>
                <Td>{Math.round(user.shares).toLocaleString()}</Td>
                <Td>{floatBreakdown.total > 0 ? ((user.shares / floatBreakdown.total) * 100).toFixed(1) : '0'}%</Td>
                <Td>${Math.round(userEquity).toLocaleString()}</Td>
                <Td color={pnlColor(userEquity - user.startingCapital)}>{fmtMoney(userEquity - user.startingCapital)}</Td>
                <Td color={pnlColor(userEquity - user.startingCapital)}>{user.startingCapital > 0 ? `${((userEquity / user.startingCapital - 1) * 100).toFixed(1)}%` : '—'}</Td>
                <Td color={pnlColor(user.realizedPnl)}>{fmtMoney(user.realizedPnl)}</Td>
                <Td color={pnlColor(user.shares * (currentPrice - user.avgCost))}>{fmtMoney(user.shares * (currentPrice - user.avgCost))}</Td>
                <Td>{user.tradeCount.toLocaleString()}</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Plain-SVG P&L-by-strategy bars (no charting lib), zero baseline in the middle.
function PnlBars({ data }: { data: { label: string; pnl: number }[] }) {
  const [ref, width] = useContainerWidth();
  const H = 200;
  const PAD_T = 8;
  const PAD_B = 26;
  const plotH = H - PAD_T - PAD_B;
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.pnl)));
  const zeroY = PAD_T + plotH / 2;
  const slot = data.length ? width / data.length : width;
  const bw = Math.min(slot * 0.6, 60);

  return (
    <div ref={ref} style={{ width: '100%', height: H }}>
      <svg width={width} height={H}>
        <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={colors.border} />
        {data.map((d, i) => {
          const cx = slot * (i + 0.5);
          const h = (Math.abs(d.pnl) / maxAbs) * (plotH / 2);
          const up = d.pnl >= 0;
          return (
            <g key={d.label}>
              <rect x={cx - bw / 2} y={up ? zeroY - h : zeroY} width={bw} height={h} fill={pnlColor(d.pnl)} />
              <text x={cx} y={zeroY + (up ? 14 : -6)} textAnchor="middle" fontSize={9} fill={colors.muted}>{d.label.split(' ')[0]}</text>
              <text x={cx} y={up ? zeroY - h - 3 : zeroY + h + 12} textAnchor="middle" fontSize={9} fill={pnlColor(d.pnl)}>{fmtMoney(d.pnl)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
