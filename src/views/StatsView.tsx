import { useMemo } from 'react';
import { useSim } from '../SimContext';
import { panel, pageWrap } from '../ui';
import { useContainerWidth } from '../components/useContainerWidth';
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS } from '../sim/agents';
import type { AgentType } from '../sim/types';

interface Row {
  type: AgentType;
  count: number;
  shares: number;
  equity: number;
  start: number;
  realized: number;
  unrealized: number;
  trades: number;
}

export function StatsView() {
  const sim = useSim();
  const { agents, currentPrice, fundamentalValue, floatBreakdown, bestBid, bestAsk, tick, totalDividendsPaid, totalFeesPaid, user, stepMs } = sim;

  const rows = useMemo(() => {
    const m = new Map<AgentType, Row>();
    for (const a of agents) {
      const r = m.get(a.type) ?? { type: a.type, count: 0, shares: 0, equity: 0, start: 0, realized: 0, unrealized: 0, trades: 0 };
      r.count++;
      r.shares += a.shares;
      r.equity += a.cash + a.shares * currentPrice;
      r.start += a.startingCapital;
      r.realized += a.realizedPnl;
      r.unrealized += a.shares * (currentPrice - a.avgCost);
      r.trades += a.tradeCount;
      m.set(a.type, r);
    }
    return [...m.values()].sort((x, y) => (y.equity - y.start) - (x.equity - x.start));
  }, [agents, currentPrice]);

  const totalTrades = agents.reduce((s, a) => s + a.tradeCount, 0);
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const gapPct = fundamentalValue > 0 ? ((currentPrice - fundamentalValue) / fundamentalValue) * 100 : 0;
  const userEquity = user.cash + user.shares * currentPrice;

  const pnlData = rows.map((r) => ({ label: AGENT_TYPE_LABELS[r.type], pnl: Number((r.equity - r.start).toFixed(0)), color: AGENT_TYPE_COLORS[r.type] }));

  return (
    <div style={pageWrap}>
      <p style={{ margin: '0 0 16px', color: '#888', fontSize: 13 }}>
        Live market analytics — how order flow, strategy mix, and money flows shape the price. Updates with the running market.
      </p>

      {/* Snapshot tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Tile label="Tick" value={tick.toLocaleString()} />
        <Tile label="Price" value={`$${currentPrice.toFixed(2)}`} color="#4ade80" />
        <Tile label="Fair value" value={`$${fundamentalValue.toFixed(2)}`} color="#22d3ee" />
        <Tile label="Price vs fair" value={`${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%`} color={Math.abs(gapPct) < 5 ? '#4ade80' : '#f59e0b'} />
        <Tile label="Spread" value={spread != null ? `$${spread.toFixed(2)}` : '—'} />
        <Tile label="Shares outstanding" value={Math.round(floatBreakdown.total).toLocaleString()} />
        <Tile label="Agents" value={String(agents.length)} />
        <Tile label="Total trades" value={totalTrades.toLocaleString()} />
        <Tile label="Compute" value={`${stepMs.toFixed(2)} ms/tick`} />
      </div>

      {/* Cash flows */}
      <div style={{ ...panel, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Money flows (the market isn't a closed cash loop)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <Tile label="Dividends paid in" value={`+$${Math.round(totalDividendsPaid).toLocaleString()}`} color="#4ade80" />
          <Tile label="Fees paid to broker" value={`-$${Math.round(totalFeesPaid).toLocaleString()}`} color="#f87171" />
          <Tile label="Net external cash" value={`${totalDividendsPaid - totalFeesPaid >= 0 ? '+' : '-'}$${Math.abs(Math.round(totalDividendsPaid - totalFeesPaid)).toLocaleString()}`} />
        </div>
      </div>

      {/* PnL by strategy */}
      <div style={{ ...panel, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Profit &amp; loss by strategy — who's winning?</h3>
        <PnlBars data={pnlData} />
      </div>

      {/* Float ownership */}
      <div style={{ ...panel, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Who owns the float?</h3>
        <OwnershipBar
          segments={[
            ...rows.map((r) => ({ label: AGENT_TYPE_LABELS[r.type], shares: r.shares, color: AGENT_TYPE_COLORS[r.type] })),
            { label: 'You', shares: user.shares, color: '#a78bfa' },
          ]}
          total={floatBreakdown.total}
        />
      </div>

      {/* Per-strategy table */}
      <div style={panel}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>By strategy</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ color: '#888', textAlign: 'right' }}>
                <Th align="left">Strategy</Th><Th>Count</Th><Th>Shares</Th><Th>% float</Th><Th>Equity</Th><Th>Total PnL</Th><Th>Return</Th><Th>Realized</Th><Th>Unreal.</Th><Th>Trades</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pnl = r.equity - r.start;
                const ret = r.start > 0 ? (r.equity / r.start - 1) * 100 : 0;
                return (
                  <tr key={r.type} style={{ borderTop: '1px solid #2a2a3a' }}>
                    <Td align="left"><span style={{ color: AGENT_TYPE_COLORS[r.type], fontWeight: 600 }}>{AGENT_TYPE_LABELS[r.type]}</span></Td>
                    <Td>{r.count}</Td>
                    <Td>{Math.round(r.shares).toLocaleString()}</Td>
                    <Td>{floatBreakdown.total > 0 ? ((r.shares / floatBreakdown.total) * 100).toFixed(1) : '0'}%</Td>
                    <Td>${Math.round(r.equity).toLocaleString()}</Td>
                    <Td color={pnl >= 0 ? '#4ade80' : '#f87171'}>{fmt(pnl)}</Td>
                    <Td color={ret >= 0 ? '#4ade80' : '#f87171'}>{ret >= 0 ? '+' : ''}{ret.toFixed(1)}%</Td>
                    <Td color={r.realized >= 0 ? '#4ade80' : '#f87171'}>{fmt(r.realized)}</Td>
                    <Td color={r.unrealized >= 0 ? '#4ade80' : '#f87171'}>{fmt(r.unrealized)}</Td>
                    <Td>{r.trades.toLocaleString()}</Td>
                  </tr>
                );
              })}
              {/* You */}
              <tr style={{ borderTop: '2px solid #3a3a4a' }}>
                <Td align="left"><span style={{ color: '#a78bfa', fontWeight: 600 }}>You</span></Td>
                <Td>1</Td>
                <Td>{Math.round(user.shares).toLocaleString()}</Td>
                <Td>{floatBreakdown.total > 0 ? ((user.shares / floatBreakdown.total) * 100).toFixed(1) : '0'}%</Td>
                <Td>${Math.round(userEquity).toLocaleString()}</Td>
                <Td color={userEquity - user.startingCapital >= 0 ? '#4ade80' : '#f87171'}>{fmt(userEquity - user.startingCapital)}</Td>
                <Td color={userEquity - user.startingCapital >= 0 ? '#4ade80' : '#f87171'}>{user.startingCapital > 0 ? `${((userEquity / user.startingCapital - 1) * 100).toFixed(1)}%` : '—'}</Td>
                <Td color={user.realizedPnl >= 0 ? '#4ade80' : '#f87171'}>{fmt(user.realizedPnl)}</Td>
                <Td color={user.shares * (currentPrice - user.avgCost) >= 0 ? '#4ade80' : '#f87171'}>{fmt(user.shares * (currentPrice - user.avgCost))}</Td>
                <Td>{user.tradeCount.toLocaleString()}</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0);
  return `${v >= 0 ? '+' : '-'}$${s}`;
}

// Horizontal stacked bar of share ownership by strategy.
function OwnershipBar({ segments, total }: { segments: { label: string; shares: number; color: string }[]; total: number }) {
  const shown = segments.filter((s) => s.shares > 0.01);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div>
      <div style={{ display: 'flex', height: 16, borderRadius: 6, overflow: 'hidden', border: '1px solid #2a2a3a' }}>
        {shown.map((s) => (
          <div key={s.label} style={{ width: `${pct(s.shares)}%`, background: s.color }} title={`${s.label}: ${Math.round(s.shares).toLocaleString()} (${pct(s.shares).toFixed(1)}%)`} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11, color: '#888', marginTop: 6 }}>
        {shown.map((s) => (
          <span key={s.label}>
            <span style={{ color: s.color }}>■</span> {s.label} {pct(s.shares).toFixed(1)}%
          </span>
        ))}
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
        <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="#555" />
        {data.map((d, i) => {
          const cx = slot * (i + 0.5);
          const h = (Math.abs(d.pnl) / maxAbs) * (plotH / 2);
          const up = d.pnl >= 0;
          return (
            <g key={d.label}>
              <rect x={cx - bw / 2} y={up ? zeroY - h : zeroY} width={bw} height={h} fill={up ? '#4ade80' : '#f87171'} />
              <text x={cx} y={zeroY + (up ? 14 : -6)} textAnchor="middle" fontSize={9} fill="#aaa">{d.label.split(' ')[0]}</text>
              <text x={cx} y={up ? zeroY - h - 3 : zeroY + h + 12} textAnchor="middle" fontSize={9} fill={up ? '#4ade80' : '#f87171'}>{fmt(d.pnl)}</text>
            </g>
          );
        })}
      </svg>
    </div>
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

function Th({ children, align = 'right' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ padding: '4px 8px', textAlign: align, fontWeight: 500 }}>{children}</th>;
}

function Td({ children, align = 'right', color }: { children: React.ReactNode; align?: 'left' | 'right'; color?: string }) {
  return <td style={{ padding: '4px 8px', textAlign: align, color: color ?? '#ddd' }}>{children}</td>;
}
