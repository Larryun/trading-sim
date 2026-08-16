import { useCallback, useEffect, useRef, useState } from 'react';
import { SimulationEngine } from '../sim/engine';
import { buildBars, buildVolumeBars, type Bar, type VolumeBar } from '../sim/bars';
import type { BookLevel, RestingUserOrder } from '../sim/orderBook';
import type { Agent, AgentAccount, AgentType, Side, TraderStyle, UserOrderRecord } from '../sim/types';

const BOOK_DEPTH = 12; // price levels shown per side in the order-book view
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
  // makers provide the book; a strong VALUE-style trader cohort tethers price to the
  // news-driven fundamental; a spread of other trader styles (trend/news/contrarian/
  // adaptive) simulates a diverse crowd; panic sellers add downside pressure; noise churns.
  for (let i = 0; i < 5; i++) engine.addAgent('marketMaker', 750000);
  for (let i = 0; i < 3; i++) engine.addAgent('trader', 500000, 'value'); // anchor price to fair value
  engine.addAgent('trader', 40000, 'trend');
  engine.addAgent('trader', 40000, 'news');
  engine.addAgent('trader', 40000, 'contrarian');
  engine.addAgent('trader', 100000, 'adaptive'); // a learning multi-signal trader
  engine.addAgent('noise', 25000);
  engine.addAgent('noise', 25000);
  engine.addAgent('panicSeller', 40000);
  engine.addAgent('panicSeller', 40000);

  // Not seeded by default (situational): FOMO herd, whale — available from the Add dropdown.
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
  const [sentimentBreakdown, setSentimentBreakdown] = useState(() => engineRef.current.sentimentBreakdown);
  const [fundamentalValue, setFundamentalValue] = useState(engineRef.current.fundamentalValue);
  const [eps, setEps] = useState(engineRef.current.eps);
  const valuationMultiple = engineRef.current.valuationMultiple;
  const [recentPrices, setRecentPrices] = useState<number[]>([]); // recent window for decision explanations
  const [tick, setTick] = useState(0);
  const [totalDividendsPaid, setTotalDividendsPaid] = useState(0);
  const [totalFeesPaid, setTotalFeesPaid] = useState(0);
  const [autoNews, setAutoNews] = useState(false);
  const [lastUserFill, setLastUserFill] = useState<UserFill>(null);
  const [userOrders, setUserOrders] = useState<UserOrderRecord[]>([]);
  const [userRestingOrders, setUserRestingOrders] = useState(0);
  const [bookDepth, setBookDepth] = useState<{ bids: BookLevel[]; asks: BookLevel[] }>(() => engineRef.current.book.getDepth(BOOK_DEPTH));
  const [myLimitOrders, setMyLimitOrders] = useState<RestingUserOrder[]>([]);
  const [dividendYieldPct, setDividendState] = useState(engineRef.current.dividendYieldPct);
  const [feeBps, setFeeState] = useState(engineRef.current.feeBps);
  const [sentimentDecay, setSentimentDecayState] = useState(engineRef.current.sentimentDecay);
  const [running, setRunning] = useState(true);
  const [lastOrderNote, setLastOrderNote] = useState<string | null>(null);
  const [tickMs, setTickMs] = useState(200);
  const [stepMs, setStepMs] = useState(0); // measured compute time per tick (smoothed)
  const stepEmaRef = useRef(0);
  const lastBuiltTickRef = useRef(-1); // engine tick the display bars were last built from
  const lastBuiltIntervalRef = useRef(0); // bar size the display bars were last built at
  const [barInterval, setBarInterval] = useState(5);
  const [chartType, setChartType] = useState<ChartType>('candle');

  // The interval callback and the bar builders need the *current* bar size
  // without re-subscribing the timer, so keep it in a ref.
  const barIntervalRef = useRef(barInterval);
  barIntervalRef.current = barInterval;

  // Stable refs so the (deps: []) order handler can see the latest running flag /
  // refresh function without changing identity and re-rendering memoized children.
  const runningRef = useRef(running);
  runningRef.current = running;
  const refreshRef = useRef<() => void>(() => {});

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
    setSentimentBreakdown(engine.sentimentBreakdown);
    setFundamentalValue(engine.fundamentalValue);
    setEps(engine.eps);
    setLastUserFill(engine.lastUserFill);
    setUserOrders(engine.userOrders.slice(-50).reverse());
    setUserRestingOrders(engine.book.countOrdersByOwner('user'));
    setBookDepth(engine.book.getDepth(BOOK_DEPTH));
    setMyLimitOrders(engine.book.getUserOrders());
    setTick(engine.tick);
    setTotalDividendsPaid(engine.totalDividendsPaid);
    setTotalFeesPaid(engine.totalFeesPaid);
    setRecentPrices(engine.priceRing.window(80).data);
    setLastOrderNote(engine.lastOrderNote);
    rebuildDisplay();
  };
  refreshRef.current = refreshFromEngine;

  useEffect(() => {
    if (!running) {
      refreshFromEngine(); // paused: show the final engine state once
      return;
    }
    // Step the engine and flush to React every tick (no render throttle).
    const interval = setInterval(() => {
      const t0 = performance.now();
      engineRef.current.step();
      const dt = performance.now() - t0;
      stepEmaRef.current = stepEmaRef.current === 0 ? dt : stepEmaRef.current * 0.9 + dt * 0.1;
      refreshFromEngine();
      setStepMs(stepEmaRef.current);
    }, tickMs);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, tickMs]);

  // Rebuild the chart immediately when the bar size changes (even while paused).
  useEffect(() => {
    rebuildDisplay(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barInterval]);

  // Stable handler identities (they only touch refs + stable setState), so
  // React.memo'd children don't re-render just because a new closure was created.
  const submitUserOrder = useCallback((side: Side, size: number, limitPrice?: number, stopPrice?: number) => {
    if (size <= 0) return;
    engineRef.current.queueUserOrder(side, size, limitPrice, stopPrice);
    // While paused, execute immediately against the current book (no next tick to
    // process the queue), so the order fills right away instead of doing nothing.
    if (!runningRef.current) {
      engineRef.current.flushUserOrders();
      refreshRef.current();
    }
  }, []);

  const cancelUserOrders = useCallback(() => {
    engineRef.current.cancelUserOrders();
    setUserRestingOrders(engineRef.current.book.countOrdersByOwner('user'));
    setMyLimitOrders(engineRef.current.book.getUserOrders());
    setBookDepth(engineRef.current.book.getDepth(BOOK_DEPTH));
  }, []);

  const addAgent = useCallback((type: AgentType, capital: number, style?: TraderStyle) => {
    // Agents added to a running market start with only cash and must buy their
    // position from the market (they don't materialize new shares into the float).
    engineRef.current.addAgent(type, capital, style, true);
    setAgents(engineRef.current.agents.map((a) => ({ ...a })));
    setFloatBreakdown(floatOf(engineRef.current));
  }, []);

  const removeAgent = useCallback((id: string) => {
    engineRef.current.removeAgent(id);
    setAgents(engineRef.current.agents.map((a) => ({ ...a })));
    setFloatBreakdown(floatOf(engineRef.current));
  }, []);

  const updateAgentParams = useCallback((id: string, patch: Record<string, unknown>) => {
    engineRef.current.updateAgentParams(id, patch);
    setAgents(engineRef.current.agents.map((a) => ({ ...a })));
  }, []);

  const triggerEvent = useCallback((sentimentDelta: number) => {
    engineRef.current.triggerEvent(sentimentDelta);
    setSentiment(engineRef.current.sentiment);
    setFundamentalValue(engineRef.current.fundamentalValue);
  }, []);

  const toggleAutoNews = useCallback(() => {
    engineRef.current.autoNews = !engineRef.current.autoNews;
    setAutoNews(engineRef.current.autoNews);
  }, []);

  const setDividendYieldPct = useCallback((v: number) => {
    engineRef.current.dividendYieldPct = v;
    setDividendState(v);
  }, []);

  const setFeeBps = useCallback((v: number) => {
    engineRef.current.feeBps = v;
    setFeeState(v);
  }, []);

  const setSentimentDecay = useCallback((v: number) => {
    engineRef.current.sentimentDecay = v;
    setSentimentDecayState(v);
  }, []);

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
    sentimentBreakdown,
    autoNews,
    triggerEvent,
    toggleAutoNews,
    dividendYieldPct,
    setDividendYieldPct,
    feeBps,
    setFeeBps,
    sentimentDecay,
    setSentimentDecay,
    floatBreakdown,
    lastUserFill,
    lastOrderNote,
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
    eps,
    valuationMultiple,
    recentPrices,
    tick,
    totalDividendsPaid,
    totalFeesPaid,
    bestBid,
    bestAsk,
    unrealizedPnl,
    submitUserOrder,
    cancelUserOrders,
  };
}
