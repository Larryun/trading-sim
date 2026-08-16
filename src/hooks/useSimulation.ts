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
  dealer: number; // the options dealer's hedge inventory (also part of the float)
}

// Show only the most recent bars so the chart is a readable, fixed-width
// scrolling window instead of cramming ever more candles into the same space.
const MAX_DISPLAY_BARS = 120;

function createEngine(): SimulationEngine {
  const engine = new SimulationEngine();

  // The opening cast mirrors a real market's participant pyramid: a handful of
  // well-capitalized institutions hold most of the capital, a few market makers
  // provide nearly all the liquidity, a small professional cohort trades signals,
  // and a numerous but individually small retail crowd supplies the churn.

  // — Liquidity providers: several names, but deliberately a MINORITY of the capital.
  //   A maker that out-capitalizes the informed traders ends up setting the price with its
  //   own quotes rather than intermediating, which decouples price from fundamentals.
  for (let i = 0; i < 6; i++) engine.addAgent('marketMaker', 400000);

  // — Passive/index funds: they hold the bulk of the float and barely trade. This is what
  //   keeps market makers a MINORITY of both ownership and flow, as in a real market —
  //   without them, maker capital dwarfs the float and maker quotes end up setting price.
  for (let i = 0; i < 2; i++) engine.addAgent('indexFund', 6000000);

  // — Institutions: the most capital, the fewest names. The value cohort is what
  //   tethers price to the earnings-based fair value (the market's gravity).
  for (let i = 0; i < 5; i++) engine.addAgent('trader', 1500000, 'value');
  const whale = engine.addAgent('whale', 1500000); // a fund rotating a large stake on valuation
  engine.updateAgentParams(whale.id, { targetShares: 3000, sliceSize: 60 });

  // — Professional/quant desks: medium capital, distinct edges.
  engine.addAgent('trader', 120000, 'adaptive'); // a learning multi-signal fund
  engine.addAgent('trader', 80000, 'trend'); // momentum / CTA
  engine.addAgent('trader', 60000, 'news'); // event-driven
  engine.addAgent('trader', 60000, 'contrarian'); // mean-reversion desk

  // — Retail: many participants, small accounts. Uninformed churn plus the two
  //   behavioral extremes that make rallies overshoot and selloffs cascade.
  for (let i = 0; i < 4; i++) engine.addAgent('noise', 20000);
  engine.addAgent('fomoHerd', 30000);
  engine.addAgent('fomoHerd', 25000);
  engine.addAgent('panicSeller', 35000);
  engine.addAgent('panicSeller', 30000);

  // — Options: live from the open. Speculators express views through calls/puts, and
  //   their open interest is what the dealer delta-hedges in the stock — so gamma
  //   effects (squeezes, pinning) arise on their own from real option demand. The
  //   option market is deliberately sized to stay proportionate to the float.
  engine.enableOptions(true);
  engine.addAgent('speculator', 150000);
  engine.addAgent('speculator', 100000);
  return engine;
}

function floatOf(engine: SimulationEngine): FloatBreakdown {
  return {
    total: engine.sharesOutstanding,
    agents: engine.agents.reduce((s, a) => s + a.shares, 0),
    user: engine.user.shares,
    dealer: engine.optionsDealer.shares,
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
  const [optionsEnabled, setOptionsEnabledState] = useState(engineRef.current.optionsEnabled);
  const [optionChain, setOptionChain] = useState<ReturnType<SimulationEngine['getOptionChain']>>(
    () => (engineRef.current.optionsEnabled ? engineRef.current.getOptionChain() : []),
  );
  const [optionPnl, setOptionPnl] = useState(0);
  const [userOptionValue, setUserOptionValue] = useState(0);
  const [ticksToExpiry, setTicksToExpiry] = useState(0);
  const [dealerState, setDealerState] = useState(() => engineRef.current.optionsDealerState);
  const [optionGreeks, setOptionGreeks] = useState(() => engineRef.current.optionGreeks);
  const [fundamentalValue, setFundamentalValue] = useState(engineRef.current.fundamentalValue);
  const [eps, setEps] = useState(engineRef.current.eps);
  const valuationMultiple = engineRef.current.valuationMultiple;
  const contractMultiplier = engineRef.current.contractMultiplier;
  const [recentPrices, setRecentPrices] = useState<number[]>([]); // recent window for decision explanations
  const [tick, setTick] = useState(0);
  const [totalDividendsPaid, setTotalDividendsPaid] = useState(0);
  const [totalFeesPaid, setTotalFeesPaid] = useState(0);
  const [autoNews, setAutoNews] = useState(engineRef.current.autoNews);
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
  const [userCanShort, setUserCanShortState] = useState(false);
  const [userMargin, setUserMargin] = useState(() => engineRef.current.userMargin);
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
  const refreshRef = useRef<(force?: boolean) => void>(() => {});

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

  const refreshFromEngine = (force = false) => {
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
    if (engine.optionsEnabled) {
      setOptionChain(engine.getOptionChain());
      setOptionPnl(engine.optionPnl);
      setUserOptionValue(engine.userOptionValue);
      setTicksToExpiry(Math.max(0, engine.nearestExpiryTick - engine.tick));
      setDealerState(engine.optionsDealerState);
      setOptionGreeks(engine.optionGreeks);
    }
    setFundamentalValue(engine.fundamentalValue);
    setEps(engine.eps);
    setLastUserFill(engine.lastUserFill);
    setUserOrders(engine.userOrders.slice(-50).reverse());
    setUserRestingOrders(engine.book.countOrdersByOwner('user'));
    // The depth/book views are snapshots of a fast-moving book; refreshing them every
    // tick is unreadable (and wasteful). Sample them on the same interval as the candles,
    // so "Interval" governs the whole chart cadence. `force` covers paused/manual refresh.
    const interval = Math.max(1, barIntervalRef.current);
    if (force || engine.tick % interval === 0) {
      setBookDepth(engine.book.getDepth(BOOK_DEPTH));
      setMyLimitOrders(engine.book.getUserOrders());
    }
    setTick(engine.tick);
    setTotalDividendsPaid(engine.totalDividendsPaid);
    setTotalFeesPaid(engine.totalFeesPaid);
    setRecentPrices(engine.priceRing.window(80).data);
    setLastOrderNote(engine.lastOrderNote);
    setUserMargin(engine.userMargin);
    rebuildDisplay();
  };
  refreshRef.current = refreshFromEngine;

  useEffect(() => {
    if (!running) {
      refreshFromEngine(true); // paused: show the final engine state once
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
      refreshRef.current(true);
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

  // Bounded PnL sparkline series for an owner ('user' or an agent id). Read live from
  // the engine at render time (re-renders happen on each tick flush).
  const getPnlSpark = useCallback((id: string) => engineRef.current.getPnlSpark(id), []);

  // Live risk appetite (1 = full size at an equity high, lower after a drawdown).
  const getRiskScale = useCallback((id: string) => engineRef.current.getRiskScale(id), []);

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

  const setUserCanShort = useCallback((on: boolean) => {
    engineRef.current.userCanShort = on;
    setUserCanShortState(on);
  }, []);

  const enableOptions = useCallback((on: boolean) => {
    engineRef.current.enableOptions(on);
    setOptionsEnabledState(on);
    refreshRef.current(true);
  }, []);

  const tradeOption = useCallback((contractId: number, qty: number) => {
    engineRef.current.tradeOption(contractId, qty);
    refreshRef.current(true);
  }, []);

  const unrealizedPnl = user.shares * (currentPrice - user.avgCost);

  return {
    agents,
    addAgent,
    removeAgent,
    updateAgentParams,
    getPnlSpark,
    getRiskScale,
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
    optionsEnabled,
    enableOptions,
    optionChain,
    tradeOption,
    optionPnl,
    userOptionValue,
    optionGreeks,
    ticksToExpiry,
    dealerState,
    contractMultiplier,
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
    userCanShort,
    setUserCanShort,
    userMargin,
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
