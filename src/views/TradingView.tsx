import { useSim } from '../SimContext';
import { panel, pageWrap } from '../ui';
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

const toggleBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 12px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  border: '1px solid #333',
  cursor: 'pointer',
  background: active ? '#2563eb' : '#0f0f1e',
  color: active ? '#fff' : '#aaa',
});

export function TradingView() {
  const sim = useSim();

  return (
    <div style={pageWrap}>
      {/* Simulation loop controls */}
      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => sim.setRunning((r) => !r)}
          style={{
            padding: '8px 18px',
            fontWeight: 600,
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            background: sim.running ? '#dc2626' : '#16a34a',
            color: '#fff',
          }}
        >
          {sim.running ? 'Pause' : 'Run'}
        </button>

        <label style={{ fontSize: 13, color: '#bbb', display: 'flex', alignItems: 'center', gap: 8 }} title="Delay between ticks — 0 = as fast as possible (render stays capped at ~15fps)">
          Speed
          <input type="range" min={0} max={1000} step={10} value={sim.tickMs}
            onChange={(e) => sim.setTickMs(Number(e.target.value))} />
          <span style={{ width: 74, color: '#eee' }}>{sim.tickMs === 0 ? 'max' : `${sim.tickMs} ms`}</span>
        </label>

        <label style={{ fontSize: 13, color: '#bbb', display: 'flex', alignItems: 'center', gap: 8 }}>
          Bar size
          <input type="range" min={1} max={60} step={1} value={sim.barInterval}
            onChange={(e) => sim.setBarInterval(Number(e.target.value))} />
          <span style={{ width: 66, color: '#eee' }}>{sim.barInterval} ticks</span>
        </label>

        <div style={{ display: 'flex', gap: 6 }}>
          <button style={toggleBtn(sim.chartType === 'candle')} onClick={() => sim.setChartType('candle')}>Candles</button>
          <button style={toggleBtn(sim.chartType === 'line')} onClick={() => sim.setChartType('line')}>Line</button>
        </div>

        <label style={{ fontSize: 13, color: '#bbb', display: 'flex', alignItems: 'center', gap: 8 }} title="Annual dividend yield, paid quarterly (fresh cash entering the market from the company)">
          Dividend
          <input type="range" min={0} max={6} step={0.5} value={sim.dividendYieldPct}
            onChange={(e) => sim.setDividendYieldPct(Number(e.target.value))} />
          <span style={{ width: 74, color: '#eee' }}>{sim.dividendYieldPct.toFixed(1)}%/yr</span>
        </label>

        <label style={{ fontSize: 13, color: '#bbb', display: 'flex', alignItems: 'center', gap: 8 }} title="Fee the taker pays per trade (goes to the broker, leaves the market)">
          Fee
          <input type="range" min={0} max={50} step={1} value={sim.feeBps}
            onChange={(e) => sim.setFeeBps(Number(e.target.value))} />
          <span style={{ width: 56, color: '#eee' }}>{sim.feeBps} bps</span>
        </label>

        <label style={{ fontSize: 13, color: '#bbb', display: 'flex', alignItems: 'center', gap: 8 }} title="How long the mood lingers: its half-life in ticks. Higher = regimes last longer. Stable across the whole range — the loop can't run away.">
          Mood persistence
          <input type="range" min={8} max={40} step={1}
            value={Math.round(Math.log(0.5) / Math.log(sim.sentimentDecay))}
            onChange={(e) => sim.setSentimentDecay(Math.pow(0.5, 1 / Number(e.target.value)))} />
          <span style={{ width: 78, color: '#eee' }}>{Math.round(Math.log(0.5) / Math.log(sim.sentimentDecay))}t half-life</span>
        </label>

        <span style={{ fontSize: 11, color: '#777' }} title="Average compute time of one simulation tick">
          {sim.stepMs.toFixed(2)} ms/tick
        </span>

        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#4ade80' }}>${sim.currentPrice.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: '#22d3ee' }} title="Fundamental value — the 'true' value, moved permanently by news">
            fair ${sim.fundamentalValue.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Share supply */}
      <div style={{ ...panel, marginBottom: 10 }}>
        <SupplyBar floatBreakdown={sim.floatBreakdown} />
      </div>

      {/* Who owns the float? — ownership by strategy */}
      <div style={{ ...panel, marginBottom: 10 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#ccc' }}>Who owns the float?</h4>
        <FloatOwnership agents={sim.agents} totalFloat={sim.floatBreakdown.total} userShares={sim.user.shares} />
      </div>

      {/* Charts: price on top, buy/sell order flow below */}
      <div style={{ ...panel, marginBottom: 10 }}>
        {sim.chartType === 'candle' ? <CandleChart bars={sim.bars} /> : <PriceChart bars={sim.bars} />}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #2a2a3a' }}>
          <VolumeChart volumeBars={sim.volumeBars} />
        </div>
      </div>

      {/* Agents + trade panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
        <div style={panel}>
          <AgentListPanel
            agents={sim.agents}
            currentPrice={sim.currentPrice}
            addAgent={sim.addAgent}
            removeAgent={sim.removeAgent}
            updateAgentParams={sim.updateAgentParams}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={panel}>
            <TradePanel
              submitUserOrder={sim.submitUserOrder}
              cancelUserOrders={sim.cancelUserOrders}
              user={sim.user}
              currentPrice={sim.currentPrice}
              bestBid={sim.bestBid}
              bestAsk={sim.bestAsk}
              restingOrders={sim.userRestingOrders}
              unrealizedPnl={sim.unrealizedPnl}
              lastFill={sim.lastUserFill}
              orderNote={sim.lastOrderNote}
            />
          </div>
          {/* Order book + your resting orders, split below Your Trades */}
          <div style={panel}>
            <OrderBookPanel bids={sim.bookDepth.bids} asks={sim.bookDepth.asks} myOrders={sim.myLimitOrders} />
          </div>
        </div>
      </div>

      {/* User order history */}
      <div style={{ ...panel, marginBottom: 10 }}>
        <UserOrderHistory orders={sim.userOrders} />
      </div>

      {/* News/sentiment + trade log */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={panel}>
          <NewsFeed
            sentimentSeries={sim.sentimentSeries}
            sentiment={sim.sentiment}
            autoNews={sim.autoNews}
            triggerEvent={sim.triggerEvent}
            toggleAutoNews={sim.toggleAutoNews}
          />
        </div>
        <div style={panel}>
          <TradeLog trades={sim.trades} agents={sim.agents} />
        </div>
      </div>
    </div>
  );
}
