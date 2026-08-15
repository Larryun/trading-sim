import { useSimulation } from './hooks/useSimulation';
import { PriceChart } from './components/PriceChart';
import { CandleChart } from './components/CandleChart';
import { VolumeChart } from './components/VolumeChart';
import { AgentListPanel } from './components/AgentListPanel';
import { TradePanel } from './components/TradePanel';
import { TradeLog } from './components/TradeLog';
import { NewsFeed } from './components/NewsFeed';
import { SupplyBar } from './components/SupplyBar';
import { UserOrderHistory } from './components/UserOrderHistory';
import { OrderBookPanel } from './components/OrderBookPanel';

const panel: React.CSSProperties = {
  background: '#16162a',
  border: '1px solid #2a2a3a',
  borderRadius: 10,
  padding: 18,
};

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

export default function App() {
  const sim = useSimulation();

  return (
    <div
      style={{
        width: '100%',
        padding: 20,
        color: '#e5e5e5',
        fontFamily: 'system-ui, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Trading Price Simulator</h1>
        <p style={{ margin: '4px 0 0', color: '#888', fontSize: 13 }}>
          Watch how order flow from capital-constrained agents — and your own trades — moves price
          through a limit order book with a fixed share supply.
        </p>
      </header>

      {/* Simulation loop controls */}
      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
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

        <label style={{ fontSize: 13, color: '#bbb', display: 'flex', alignItems: 'center', gap: 8 }}>
          Speed
          <input type="range" min={50} max={1000} step={50} value={sim.tickMs}
            onChange={(e) => sim.setTickMs(Number(e.target.value))} />
          <span style={{ width: 66, color: '#eee' }}>{sim.tickMs} ms</span>
        </label>

        <label style={{ fontSize: 13, color: '#bbb', display: 'flex', alignItems: 'center', gap: 8 }}>
          Bar size
          <input type="range" min={1} max={20} step={1} value={sim.barInterval}
            onChange={(e) => sim.setBarInterval(Number(e.target.value))} />
          <span style={{ width: 66, color: '#eee' }}>{sim.barInterval} ticks</span>
        </label>

        <div style={{ display: 'flex', gap: 6 }}>
          <button style={toggleBtn(sim.chartType === 'candle')} onClick={() => sim.setChartType('candle')}>Candles</button>
          <button style={toggleBtn(sim.chartType === 'line')} onClick={() => sim.setChartType('line')}>Line</button>
        </div>

        <label style={{ fontSize: 13, color: '#bbb', display: 'flex', alignItems: 'center', gap: 8 }} title="Cash paid per share to holders every 50 ticks — fresh money entering the market">
          Dividend
          <input type="range" min={0} max={1} step={0.02} value={sim.dividendPerShare}
            onChange={(e) => sim.setDividendPerShare(Number(e.target.value))} />
          <span style={{ width: 74, color: '#eee' }}>${sim.dividendPerShare.toFixed(2)}/sh</span>
        </label>

        <div style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 700, color: '#4ade80' }}>
          ${sim.currentPrice.toFixed(2)}
        </div>
      </div>

      {/* Share supply */}
      <div style={{ ...panel, marginBottom: 16 }}>
        <SupplyBar floatBreakdown={sim.floatBreakdown} />
      </div>

      {/* Charts: price on top, buy/sell order flow below */}
      <div style={{ ...panel, marginBottom: 16 }}>
        {sim.chartType === 'candle' ? <CandleChart bars={sim.bars} /> : <PriceChart bars={sim.bars} />}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #2a2a3a' }}>
          <VolumeChart volumeBars={sim.volumeBars} />
        </div>
      </div>

      {/* Agents + trade panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={panel}>
          <AgentListPanel
            agents={sim.agents}
            currentPrice={sim.currentPrice}
            addAgent={sim.addAgent}
            removeAgent={sim.removeAgent}
            updateAgentParams={sim.updateAgentParams}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
            />
          </div>
          {/* Order book + your resting orders, split below Your Trades */}
          <div style={panel}>
            <OrderBookPanel bids={sim.bookDepth.bids} asks={sim.bookDepth.asks} myOrders={sim.myLimitOrders} />
          </div>
        </div>
      </div>

      {/* User order history */}
      <div style={{ ...panel, marginBottom: 16 }}>
        <UserOrderHistory orders={sim.userOrders} />
      </div>

      {/* News/sentiment + trade log */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
