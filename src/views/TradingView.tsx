import { useState } from 'react';
import { useSim } from '../SimContext';
import { panel, panelTight, pageWrap, colors, tabularNums, fmtMoney, pnlColor } from '../ui';
import { Stat, Param, SectionHeaderRow } from '../components/kit';
import { PriceChart } from '../components/PriceChart';
import { CandleChart } from '../components/CandleChart';
import { VolumeChart } from '../components/VolumeChart';
import { AgentListPanel } from '../components/AgentListPanel';
import { TradePanel } from '../components/TradePanel';
import { TradeLog } from '../components/TradeLog';
import { NewsFeed } from '../components/NewsFeed';
import { SupplyBar } from '../components/SupplyBar';
import { FloatOwnership } from '../components/FloatOwnership';
import { UserOrderHistory } from '../components/UserOrderHistory';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { TradingQueue } from '../components/TradingQueue';
import { SentimentBreakdown } from '../components/SentimentBreakdown';

const toggleBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 12px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  border: `1px solid ${colors.border}`,
  cursor: 'pointer',
  background: active ? colors.accent : colors.bg0,
  color: active ? '#fff' : colors.muted,
});

export function TradingView() {
  const sim = useSim();
  const [showParams, setShowParams] = useState(false);

  const spread = sim.bestBid != null && sim.bestAsk != null ? sim.bestAsk - sim.bestBid : null;
  // Equity must include the mark value of open options — the premium already left cash.
  const userEquity = sim.user.cash + sim.user.shares * sim.currentPrice + sim.userOptionValue;
  const userPnl = userEquity - sim.user.startingCapital;
  const gapPct = sim.fundamentalValue > 0 ? ((sim.currentPrice - sim.fundamentalValue) / sim.fundamentalValue) * 100 : 0;
  const halfLife = Math.round(Math.log(0.5) / Math.log(sim.sentimentDecay));

  return (
    <div style={pageWrap}>
      {/* Ticker strip — always-visible live snapshot */}
      <div style={{ ...panelTight, display: 'flex', alignItems: 'center', gap: 22, marginBottom: 8, overflowX: 'auto' }}>
        <Stat label="Price" value={`$${sim.currentPrice.toFixed(2)}`} color={colors.text} />
        <Stat label="Fair (EPS×mult)" value={`$${sim.fundamentalValue.toFixed(2)}`} color={colors.accent} title="Fair value = EPS × valuation multiple" />
        <Stat label="Px vs fair" value={`${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%`} color={Math.abs(gapPct) < 5 ? colors.up : '#f59e0b'} />
        <Stat label="Spread" value={spread != null ? `$${spread.toFixed(2)}` : '—'} />
        <Stat label="Sentiment" value={sim.sentiment.toFixed(2)} color={pnlColor(sim.sentiment)} />
        <Stat label="Tick" value={sim.tick.toLocaleString()} />
        <div style={{ width: 1, alignSelf: 'stretch', background: colors.border }} />
        <Stat label="Your equity" value={`$${Math.round(userEquity).toLocaleString()}`} />
        <Stat label="Your P&L" value={fmtMoney(userPnl)} color={pnlColor(userPnl)} />
      </div>

      {/* Toolbar — run/pause + view controls + parameters toggle */}
      <div style={{ ...panelTight, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => sim.setRunning((r) => !r)}
          style={{ padding: '7px 20px', fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer', background: sim.running ? colors.down : colors.up, color: '#fff' }}
        >
          {sim.running ? '⏸ Pause' : '▶ Run'}
        </button>

        <label style={{ fontSize: 12, color: colors.muted, display: 'flex', alignItems: 'center', gap: 8 }} title="Delay between ticks — 0 = as fast as possible">
          Speed
          <input type="range" min={0} max={1000} step={10} value={sim.tickMs} onChange={(e) => sim.setTickMs(Number(e.target.value))} />
          <span style={{ ...tabularNums, width: 52, color: colors.text }}>{sim.tickMs === 0 ? 'max' : `${sim.tickMs}ms`}</span>
        </label>

        <label style={{ fontSize: 12, color: colors.muted, display: 'flex', alignItems: 'center', gap: 8 }}>
          Bars
          <input type="range" min={1} max={60} step={1} value={sim.barInterval} onChange={(e) => sim.setBarInterval(Number(e.target.value))} />
          <span style={{ ...tabularNums, width: 44, color: colors.text }}>{sim.barInterval}t</span>
        </label>

        <div style={{ display: 'flex', gap: 6 }}>
          <button style={toggleBtn(sim.chartType === 'candle')} onClick={() => sim.setChartType('candle')}>Candles</button>
          <button style={toggleBtn(sim.chartType === 'line')} onClick={() => sim.setChartType('line')}>Line</button>
        </div>

        <button style={toggleBtn(showParams)} onClick={() => setShowParams((s) => !s)}>Parameters {showParams ? '▲' : '▾'}</button>

        <span style={{ ...tabularNums, marginLeft: 'auto', fontSize: 11, color: colors.muted }} title="Average compute time of one simulation tick">
          {sim.stepMs.toFixed(2)} ms/tick
        </span>
      </div>

      {/* Parameters drawer — grouped, aligned, collapsed by default */}
      {showParams && (
        <div style={{ ...panel, marginBottom: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
          <div>
            <SectionHeaderRow>Economics</SectionHeaderRow>
            <div style={{ display: 'grid', gap: 8 }}>
              <Param label="Dividend" min={0} max={6} step={0.5} value={sim.dividendYieldPct} onChange={sim.setDividendYieldPct} format={(v) => `${v.toFixed(1)}%/yr`} title="Annual dividend yield, paid quarterly (external cash into the market)" />
              <Param label="Taker fee" min={0} max={50} step={1} value={sim.feeBps} onChange={sim.setFeeBps} format={(v) => `${v} bps`} title="Fee the aggressor pays per trade (leaves the market)" />
            </div>
          </div>
          <div>
            <SectionHeaderRow>Sentiment</SectionHeaderRow>
            <div style={{ display: 'grid', gap: 8 }}>
              <Param label="Mood persist" min={8} max={40} step={1} value={halfLife} onChange={(v) => sim.setSentimentDecay(Math.pow(0.5, 1 / v))} format={(v) => `${v}t ½-life`} title="How long the mood lingers (half-life in ticks). Stable across the whole range." />
            </div>
          </div>
        </div>
      )}

      {/* Charts: price on top, buy/sell order flow below */}
      <div style={{ ...panel, marginBottom: 8 }}>
        <SectionHeaderRow right={<span style={{ fontSize: 10, color: colors.muted }}>{sim.barInterval}t bars</span>}>Price &amp; Volume</SectionHeaderRow>
        {sim.chartType === 'candle' ? <CandleChart bars={sim.bars} /> : <PriceChart bars={sim.bars} />}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
          <VolumeChart volumeBars={sim.volumeBars} />
        </div>
      </div>

      {/* Share supply + ownership by strategy */}
      <div style={{ ...panel, marginBottom: 8 }}>
        <SectionHeaderRow>Share supply &amp; ownership</SectionHeaderRow>
        <SupplyBar floatBreakdown={sim.floatBreakdown} />
        <div style={{ marginTop: 10 }}>
          <FloatOwnership agents={sim.agents} totalFloat={sim.floatBreakdown.total} userShares={sim.user.shares} />
        </div>
      </div>

      {/* Agents + trade panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)', gap: 8, marginBottom: 8 }}>
        <div style={panel}>
          <AgentListPanel
            agents={sim.agents}
            currentPrice={sim.currentPrice}
            addAgent={sim.addAgent}
            removeAgent={sim.removeAgent}
            updateAgentParams={sim.updateAgentParams}
            getPnlSpark={sim.getPnlSpark}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={panel}>
            <TradePanel
              submitUserOrder={sim.submitUserOrder}
              user={sim.user}
              currentPrice={sim.currentPrice}
              bestBid={sim.bestBid}
              bestAsk={sim.bestAsk}
              unrealizedPnl={sim.unrealizedPnl}
              lastFill={sim.lastUserFill}
              orderNote={sim.lastOrderNote}
              userCanShort={sim.userCanShort}
              setUserCanShort={sim.setUserCanShort}
              userMargin={sim.userMargin}
              spark={sim.getPnlSpark('user')}
              optionValue={sim.userOptionValue}
            />
          </div>
          <div style={panel}>
            <TradingQueue orders={sim.myLimitOrders} onCancel={sim.cancelUserOrders} />
          </div>
          <div style={panel}>
            <OrderBookPanel bids={sim.bookDepth.bids} asks={sim.bookDepth.asks} />
          </div>
        </div>
      </div>

      {/* User order history */}
      <div style={{ ...panel, marginBottom: 8 }}>
        <UserOrderHistory orders={sim.userOrders} />
      </div>

      {/* News/sentiment + trade log */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={panel}>
          <NewsFeed
            sentimentSeries={sim.sentimentSeries}
            sentiment={sim.sentiment}
            autoNews={sim.autoNews}
            triggerEvent={sim.triggerEvent}
            toggleAutoNews={sim.toggleAutoNews}
          />
          <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 10, paddingTop: 10 }}>
            <SentimentBreakdown
              breakdown={sim.sentimentBreakdown}
              recentPrices={sim.recentPrices}
              currentPrice={sim.currentPrice}
              fundamentalValue={sim.fundamentalValue}
            />
          </div>
        </div>
        <div style={panel}>
          <TradeLog trades={sim.trades} agents={sim.agents} />
        </div>
      </div>
    </div>
  );
}
