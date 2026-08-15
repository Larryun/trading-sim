import { useEffect, useRef, useState } from 'react';
import { SimulationEngine } from '../sim/engine';
import { buildBars, buildVolumeBars, type Bar, type VolumeBar } from '../sim/bars';
import type { BookLevel, RestingUserOrder } from '../sim/orderBook';
import type { Agent, AgentAccount, AgentType, Side, UserOrderRecord } from '../sim/types';

const BOOK_DEPTH = 12; // price levels shown per side in the order-book view
// Cap UI updates to ~15fps regardless of sim tick rate — the engine keeps
// stepping on its timer, but React state is flushed at most this often. This
// decouples render cost from tick speed and keeps long sessions smooth.
const RENDER_INTERVAL_MS = 66;

export type ChartType = 'line' | 'candle';
export type UserFill = { side: Side; size: number; avgPrice: number; priceBefore: number } | null;
export interface SentimentPoint {
  index: number;
  value: number;
}
export interface FloatBreakdown {
  total: number;
  agents: number;
  user: number;
}

// Show only the most recent bars so the chart is a readable, fixed-width
// scrolling window instead of cramming ever more candles into the same space.
const MAX_DISPLAY_BARS = 120;

function createEngine(): SimulationEngine {
  const engine = new SimulationEngine();
  // Empirically tuned mix (see the tuning workflow): deep, well-capitalized market
  // makers provide the book; a strong value cohort tethers price to the news-driven
  // fundamental; panic sellers add downside pressure; noise/momentum/news add churn.
  for (let i = 0; i < 5; i++) engine.addAgent('marketMaker', 750000);
  for (let i = 0; i < 4; i++) engine.addAgent('value', 500000);
  engine.addAgent('momentum', 30000);
  engine.addAgent('momentum', 30000);
  engine.addAgent('noise', 25000);
  engine.addAgent('noise', 25000);
  engine.addAgent('panicSeller', 40000);
  engine.addAgent('panicSeller', 40000);
  engine.addAgent('news', 40000);
  // Not seeded by default (they fight fundamental tracking / are situational):
  // mean-reversion, FOMO herd, whale — all available from the Add dropdown.
  return engine;
}

function floatOf(engine: SimulationEngine): FloatBreakdown {
  return {
    total: engine.sharesOutstanding,
    agents: engine.agents.reduce((s, a) => s + a.shares, 0),
    user: engine.user.shares,
  };
}

export function useSimulation() {
  const engineRef = useRef<SimulationEngine>(null as unknown as SimulationEngine);
  if (engineRef.current === null) engineRef.current = createEngine();

  const [agents, setAgents] = useState<Agent[]>(() => engineRef.current.agents.map((a) => ({ ...a })));
  const [bars, setBars] = useState<Bar[]>([]);
  const [volumeBars, setVolumeBars] = useState<VolumeBar[]>([]);
  const [sentimentSeries, setSentimentSeries] = useState<SentimentPoint[]>([]);
  const [currentPrice, setCurrentPrice] = useState(engineRef.current.currentPrice);
  const [bestBid, setBestBid] = useState<number | null>(engineRef.current.bestBid);
  const [bestAsk, setBestAsk] = useState<number | null>(engineRef.current.bestAsk);
  const [trades, setTrades] = useState(engineRef.current.trades.slice(-50).reverse());
  const [user, setUser] = useState<AgentAccount>(() => ({ ...engineRef.current.user }));
  const [floatBreakdown, setFloatBreakdown] = useState<FloatBreakdown>(() => floatOf(engineRef.current));
  const [sentiment, setSentiment] = useState(0);
  const [fundamentalValue, setFundamentalValue] = useState(engineRef.current.fundamentalValue);
  const [autoNews, setAutoNews] = useState(false);
  const [lastUserFill, setLastUserFill] = useState<UserFill>(null);
  const [userOrders, setUserOrders] = useState<UserOrderRecord[]>([]);
  const [userRestingOrders, setUserRestingOrders] = useState(0);
  const [bookDepth, setBookDepth] = useState<{ bids: BookLevel[]; asks: BookLevel[] }>(() => engineRef.current.book.getDepth(BOOK_DEPTH));
  const [myLimitOrders, setMyLimitOrders] = useState<RestingUserOrder[]>([]);
  const [dividendPerShare, setDividendState] = useState(engineRef.current.dividendPerShare);
  const [feeBps, setFeeState] = useState(engineRef.current.feeBps);
  const [running, setRunning] = useState(true);
  const [tickMs, setTickMs] = useState(200);
  const [stepMs, setStepMs] = useState(0); // measured compute time per tick (smoothed)
  const stepEmaRef = useRef(0);
  const dirtyRef = useRef(false); // engine advanced since the last UI flush
  const lastRenderTsRef = useRef(0);
  const lastBuiltTickRef = useRef(-1); // engine tick the display bars were last built from
  const lastBuiltIntervalRef = useRef(0); // bar size the display bars were last built at
  const [barInterval, setBarInterval] = useState(5);
  const [chartType, setChartType] = useState<ChartType>('candle');

  // The interval callback and the bar builders need the *current* bar size
  // without re-subscribing the timer, so keep it in a ref.
  const barIntervalRef = useRef(barInterval);
  barIntervalRef.current = barInterval;

  // Rebuild only the bounded display window (≈120 bars) from the ring buffers,
  // so per-tick work stays flat no matter how long the sim has been running.
  const rebuildDisplay = (force = false) => {
    const engine = engineRef.current;
    const interval = barIntervalRef.current;
    // Skip the (relatively heavy) bar rebuilds when nothing has changed since the
    // last build — e.g. a flush while paused, or the bar size is unchanged.
    if (!force && engine.tick === lastBuiltTickRef.current && interval === lastBuiltIntervalRef.current) return;
    lastBuiltTickRef.current = engine.tick;
    lastBuiltIntervalRef.current = interval;
    const samples = MAX_DISPLAY_BARS * interval + interval;

    const priceWin = engine.priceRing.window(samples);
    setBars(buildBars(priceWin.data, interval, priceWin.startIndex).slice(-MAX_DISPLAY_BARS));

    const buyWin = engine.buyVolRing.window(samples);
    const sellWin = engine.sellVolRing.window(samples);
    setVolumeBars(buildVolumeBars(buyWin.data, sellWin.data, interval, buyWin.startIndex).slice(-MAX_DISPLAY_BARS));

    const sentWin = engine.sentimentRing.window(samples);
    const sentBars = buildBars(sentWin.data, interval, sentWin.startIndex).slice(-MAX_DISPLAY_BARS);
    setSentimentSeries(sentBars.map((b) => ({ index: b.index, value: Number(b.close.toFixed(3)) })));
  };

  const refreshFromEngine = () => {
    const engine = engineRef.current;
    setAgents(engine.agents.map((a) => ({ ...a })));
    setCurrentPrice(engine.currentPrice);
    setBestBid(engine.bestBid);
    setBestAsk(engine.bestAsk);
    setTrades(engine.trades.slice(-50).reverse());
    setUser({ ...engine.user });
    setFloatBreakdown(floatOf(engine));
    setSentiment(engine.sentiment);
    setFundamentalValue(engine.fundamentalValue);
    setLastUserFill(engine.lastUserFill);
    setUserOrders(engine.userOrders.slice(-50).reverse());
    setUserRestingOrders(engine.book.countOrdersByOwner('user'));
    setBookDepth(engine.book.getDepth(BOOK_DEPTH));
    setMyLimitOrders(engine.book.getUserOrders());
    rebuildDisplay();
  };

  useEffect(() => {
    if (!running) {
      refreshFromEngine(); // paused: show the final engine state once
      return;
    }
    // The timer only advances the engine (cheap) and flags that a flush is due.
    const interval = setInterval(() => {
      const t0 = performance.now();
      engineRef.current.step();
      const dt = performance.now() - t0;
      // Exponential moving average so the readout is stable, not jittery.
      stepEmaRef.current = stepEmaRef.current === 0 ? dt : stepEmaRef.current * 0.9 + dt * 0.1;
      dirtyRef.current = true;
    }, tickMs);

    // A separate rAF loop flushes engine state into React at most ~15fps, no
    // matter how fast the sim ticks — this is what keeps long sessions smooth.
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      if (dirtyRef.current && now - lastRenderTsRef.current >= RENDER_INTERVAL_MS) {
        dirtyRef.current = false;
        lastRenderTsRef.current = now;
        refreshFromEngine();
        setStepMs(stepEmaRef.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      clearInterval(interval);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, tickMs]);

  // Rebuild the chart immediately when the bar size changes (even while paused).
  useEffect(() => {
    rebuildDisplay(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barInterval]);

  const submitUserOrder = (side: Side, size: number, limitPrice?: number) => {
    if (size <= 0) return;
    engineRef.current.queueUserOrder(side, size, limitPrice);
  };

  const cancelUserOrders = () => {
    engineRef.current.cancelUserOrders();
    setUserRestingOrders(engineRef.current.book.countOrdersByOwner('user'));
    setMyLimitOrders(engineRef.current.book.getUserOrders());
    setBookDepth(engineRef.current.book.getDepth(BOOK_DEPTH));
  };

  const addAgent = (type: AgentType, capital: number) => {
    engineRef.current.addAgent(type, capital);
    setAgents(engineRef.current.agents.map((a) => ({ ...a })));
    setFloatBreakdown(floatOf(engineRef.current));
  };

  const removeAgent = (id: string) => {
    engineRef.current.removeAgent(id);
    setAgents(engineRef.current.agents.map((a) => ({ ...a })));
    setFloatBreakdown(floatOf(engineRef.current));
  };

  const updateAgentParams = (id: string, patch: Record<string, number>) => {
    engineRef.current.updateAgentParams(id, patch);
    setAgents(engineRef.current.agents.map((a) => ({ ...a })));
  };

  const triggerEvent = (sentimentDelta: number) => {
    engineRef.current.triggerEvent(sentimentDelta);
    setSentiment(engineRef.current.sentiment);
    setFundamentalValue(engineRef.current.fundamentalValue);
  };

  const toggleAutoNews = () => {
    engineRef.current.autoNews = !engineRef.current.autoNews;
    setAutoNews(engineRef.current.autoNews);
  };

  const setDividendPerShare = (v: number) => {
    engineRef.current.dividendPerShare = v;
    setDividendState(v);
  };

  const setFeeBps = (v: number) => {
    engineRef.current.feeBps = v;
    setFeeState(v);
  };

  const unrealizedPnl = user.shares * (currentPrice - user.avgCost);

  return {
    agents,
    addAgent,
    removeAgent,
    updateAgentParams,
    bars,
    volumeBars,
    sentimentSeries,
    barInterval,
    setBarInterval,
    chartType,
    setChartType,
    trades,
    sentiment,
    autoNews,
    triggerEvent,
    toggleAutoNews,
    dividendPerShare,
    setDividendPerShare,
    feeBps,
    setFeeBps,
    floatBreakdown,
    lastUserFill,
    userOrders,
    userRestingOrders,
    bookDepth,
    myLimitOrders,
    running,
    setRunning,
    tickMs,
    setTickMs,
    stepMs,
    user,
    currentPrice,
    fundamentalValue,
    bestBid,
    bestAsk,
    unrealizedPnl,
    submitUserOrder,
    cancelUserOrders,
  };
}
