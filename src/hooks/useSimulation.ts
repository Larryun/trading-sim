import { useEffect, useRef, useState } from 'react';
import { SimulationEngine } from '../sim/engine';
import { buildBars, buildVolumeBars, type Bar, type VolumeBar } from '../sim/bars';
import type { BookLevel, RestingUserOrder } from '../sim/orderBook';
import type { Agent, AgentAccount, AgentType, Side, UserOrderRecord } from '../sim/types';

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
  // With no backstop, ALL liquidity comes from these agents, so the market
  // makers are seeded with deep inventory/capital to supply a healthy book.
  // Two-sided flow comes from the fade/value/panic side vs the trend/FOMO side.
  engine.addAgent('marketMaker', 300000);
  engine.addAgent('marketMaker', 300000);
  engine.addAgent('noise', 20000);
  engine.addAgent('noise', 20000);
  engine.addAgent('momentum', 20000);
  engine.addAgent('meanReversion', 30000);
  engine.addAgent('news', 20000);
  // A strong value cohort keeps price tethered to the (news-driven) fundamental.
  engine.addAgent('value', 80000);
  engine.addAgent('value', 80000);
  engine.addAgent('value', 80000);
  engine.addAgent('fomoHerd', 20000);
  engine.addAgent('fomoHerd', 20000);
  engine.addAgent('panicSeller', 40000);
  engine.addAgent('panicSeller', 40000);
  // (No whale by default — add one to watch a large order move a shallow book.)
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
  const [barInterval, setBarInterval] = useState(5);
  const [chartType, setChartType] = useState<ChartType>('candle');

  // The interval callback and the bar builders need the *current* bar size
  // without re-subscribing the timer, so keep it in a ref.
  const barIntervalRef = useRef(barInterval);
  barIntervalRef.current = barInterval;

  // Rebuild only the bounded display window (≈120 bars) from the ring buffers,
  // so per-tick work stays flat no matter how long the sim has been running.
  const rebuildDisplay = () => {
    const engine = engineRef.current;
    const interval = barIntervalRef.current;
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
    setTrades([...engine.trades].slice(-50).reverse());
    setUser({ ...engine.user });
    setFloatBreakdown(floatOf(engine));
    setSentiment(engine.sentiment);
    setFundamentalValue(engine.fundamentalValue);
    setLastUserFill(engine.lastUserFill);
    setUserOrders([...engine.userOrders].slice(-50).reverse());
    setUserRestingOrders(engine.book.countOrdersByOwner('user'));
    setBookDepth(engine.book.getDepth(BOOK_DEPTH));
    setMyLimitOrders(engine.book.getUserOrders());
    rebuildDisplay();
  };

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      engineRef.current.step();
      refreshFromEngine();
    }, tickMs);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, tickMs]);

  // Rebuild the chart immediately when the bar size changes (even while paused).
  useEffect(() => {
    rebuildDisplay();
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
