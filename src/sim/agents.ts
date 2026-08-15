import type { Agent, AgentAccount, AgentType, MarketState, OrderIntent, Side } from './types';

// Force a full reload on edits (the engine that calls these lives in a useRef
// and won't pick up hot-swapped agent definitions otherwise).
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

// Base share size for the strategy sizing formulas; capital constraints in the
// engine cap this further, so it just sets the "eagerness" scale of an agent.
const BASE_SIZE = 500;

function pctChange(history: number[], window: number): number {
  if (history.length < 2) return 0;
  const lookback = Math.min(window, history.length - 1);
  const past = history[history.length - 1 - lookback];
  const current = history[history.length - 1];
  if (past <= 0) return 0;
  return (current - past) / past;
}

function movingAverage(history: number[], window: number): number {
  const n = Math.min(window, history.length);
  if (n === 0) return history[history.length - 1] ?? 0;
  const slice = history.slice(history.length - n);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  noise: 'Noise',
  momentum: 'Momentum',
  meanReversion: 'Mean-reversion',
  news: 'News / informed',
  marketMaker: 'Market maker',
  value: 'Value / fundamental',
  fomoHerd: 'FOMO herd',
  whale: 'Institution / whale',
  panicSeller: 'Panic seller',
};

export const AGENT_TYPE_COLORS: Record<AgentType, string> = {
  noise: '#60a5fa',
  momentum: '#f59e0b',
  meanReversion: '#a78bfa',
  news: '#34d399',
  marketMaker: '#2dd4bf',
  value: '#22d3ee',
  fomoHerd: '#d946ef',
  whale: '#94a3b8',
  panicSeller: '#ef4444',
};

// Minimum meaningful order size (mirrors the engine's own floor).
const MIN_ORDER = 0.01;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Create an individual agent. Its capital is split 50/50 into cash and a share
 * inventory (valued at the current price) so it can trade in either direction
 * from the very first tick without starting from a biased, all-cash position.
 */
export function createAgent(
  type: AgentType,
  capital: number,
  startingPrice: number,
  id: string,
  name: string,
): Agent {
  const cash = capital / 2;
  const shares = capital / 2 / startingPrice;
  const account = {
    startingCapital: capital,
    cash,
    shares,
    avgCost: startingPrice,
    realizedPnl: 0,
    tradeCount: 0,
  };

  switch (type) {
    case 'noise':
      // Pure liquidity/noise: no profit-seeking exit (let it churn both ways).
      return { id, name, type, frequency: 0.2, maxSize: 10, bias: 0, takeProfit: 0, stopLoss: 0, ...account };
    case 'momentum':
      // Trend follower: let winners run (wide TP), cut losers.
      return { id, name, type, window: 10, sensitivity: 5, activity: 0.5, bias: 0, takeProfit: 0.15, stopLoss: 0.06, ...account };
    case 'meanReversion':
      // Fades extremes: quick to take small gains, slow to cut.
      return { id, name, type, window: 20, threshold: 0.01, strength: 5, activity: 0.5, bias: 0, takeProfit: 0.04, stopLoss: 0.10, ...account };
    case 'news':
      return { id, name, type, orderSize: 200, activity: 0.5, bias: 0, takeProfit: 0.06, stopLoss: 0.06, ...account };
    case 'marketMaker':
      // A maker manages inventory via quote skew, so the shared TP/SL exit is off.
      return { id, name, type, spreadBps: 8, quoteSize: 100, levels: 6, inventorySkew: 0.5, activity: 0.8, bias: 0, takeProfit: 0, stopLoss: 0, ...account };
    case 'value':
      // Strong, active fundamentalists so price is meaningfully tethered to fair
      // value (the main long-only force correcting mispricing without shorting).
      return { id, name, type, marginOfSafety: 0.05, conviction: 12, contrarianGain: 0.3, maxOrderShares: 1000, activity: 0.35, bias: 0, takeProfit: 0, stopLoss: 0, ...account };
    case 'fomoHerd':
      return { id, name, type, shortWindow: 4, entryThreshold: 0.008, sentimentGain: 1, convexity: 2, maxBuyFrac: 0.4, activity: 0.5, bias: 0, takeProfit: 0.12, stopLoss: 0, ...account };
    case 'whale':
      // bias sign is the mandate: >=0 accumulate up to targetShares, <0 distribute down to it.
      // Starts cash-heavy (a whale about to accumulate holds mostly cash), and a
      // modest default target so it doesn't try to corner the whole float.
      return {
        id, name, type, targetShares: 1000, sliceSize: 40, participationJitter: 0.3, impactBudget: 0.008,
        activity: 0.6, bias: 1, takeProfit: 0, stopLoss: 0,
        ...account, cash: capital * 0.9, shares: (capital * 0.1) / startingPrice,
      };
    case 'panicSeller':
      return { id, name, type, peakWindow: 15, panicThreshold: 0.06, capitulationDD: 0.15, baseDumpFrac: 0.4, sentPanic: 0.6, reentryFrac: 0.3, activity: 0.7, bias: 0, takeProfit: 0, stopLoss: 0, ...account };
  }
}

// How strongly a unit of `bias` (|1|) tilts each strategy.
const BIAS_TREND = 0.01; // momentum: perceived baseline % trend
const BIAS_DEVIATION = 0.03; // mean-reversion: perceived fair-value shift
const BIAS_SENTIMENT = 1; // news: persistent sentiment backdrop

/** Probability an agent evaluates a decision this tick (its async arrival rate). */
function actsThisTick(agent: Agent): boolean {
  const rate = agent.type === 'noise' ? agent.frequency : agent.activity;
  return Math.random() < rate;
}

/** Decide the order(s) an agent *wants* to place this tick (before capital limits). */
export function decideOrder(agent: Agent, market: MarketState): OrderIntent[] {
  const price = market.priceHistory[market.priceHistory.length - 1];
  if (price == null) return [];
  if (!actsThisTick(agent)) return [];

  // Profit-seeking exits take priority: realize gains or cut losses on holdings.
  // Selling the whole position locks in the result; the strategy re-enters later.
  if (agent.shares > 0 && agent.avgCost > 0) {
    const gainPct = (price - agent.avgCost) / agent.avgCost;
    if (agent.takeProfit > 0 && gainPct >= agent.takeProfit) return [{ side: 'sell', size: agent.shares }];
    if (agent.stopLoss > 0 && gainPct <= -agent.stopLoss) return [{ side: 'sell', size: agent.shares }];
  }

  // Otherwise fall through to the agent's entry/base strategy.
  switch (agent.type) {
    case 'noise': {
      // Bias tilts the buy/sell coin flip: bias=+1 always buys, -1 always sells.
      const buyProb = Math.min(1, Math.max(0, 0.5 + 0.5 * agent.bias));
      const side: Side = Math.random() < buyProb ? 'buy' : 'sell';
      const size = Math.random() * agent.maxSize;
      return size > 0 ? [{ side, size }] : [];
    }
    case 'momentum': {
      // Bias adds a perceived baseline trend, so a bullish momentum agent buys
      // even in a flat market.
      const change = pctChange(market.priceHistory, agent.window) + agent.bias * BIAS_TREND;
      if (Math.abs(change) <= 0.0001) return [];
      const side: Side = change > 0 ? 'buy' : 'sell';
      const size = agent.sensitivity * Math.abs(change) * BASE_SIZE;
      return size > 0 ? [{ side, size }] : [];
    }
    case 'meanReversion': {
      const ma = movingAverage(market.priceHistory, agent.window);
      const rawDeviation = ma > 0 ? (price - ma) / ma : 0;
      // Bias shifts perceived fair value up, so the agent treats price as cheaper
      // and leans toward buying.
      const deviation = rawDeviation - agent.bias * BIAS_DEVIATION;
      if (Math.abs(deviation) <= agent.threshold) return [];
      const side: Side = deviation > 0 ? 'sell' : 'buy'; // fade the (adjusted) move
      const size = agent.strength * Math.abs(deviation) * BASE_SIZE;
      return size > 0 ? [{ side, size }] : [];
    }
    case 'news': {
      // Informed traders act on incoming information: buy on positive sentiment,
      // sell on negative. Bias acts like a persistent sentiment backdrop, and the
      // base order size is user-set and scales with the effective sentiment.
      const effectiveSentiment = market.sentiment + agent.bias * BIAS_SENTIMENT;
      if (Math.abs(effectiveSentiment) <= 0.02) return [];
      const side: Side = effectiveSentiment > 0 ? 'buy' : 'sell';
      const size = agent.orderSize * Math.abs(effectiveSentiment);
      return size > 0 ? [{ side, size }] : [];
    }
    case 'marketMaker': {
      // Post a two-sided ladder of resting quotes stepping away from mid, skewed to
      // unwind inventory (quote lower when long, higher when short) and shifted by
      // directional bias. This is what gives the order book real depth.
      const mid = price;
      const half = mid * (agent.spreadBps / 10000);
      const equity = agent.cash + agent.shares * mid;
      const targetShares = mid > 0 ? equity / 2 / mid : 0; // aim to hold ~half in stock
      const excess = targetShares > 0 ? (agent.shares - targetShares) / targetShares : 0;
      const skew = agent.inventorySkew * Math.max(-1, Math.min(1, excess)) * half;
      const center = mid + agent.bias * half - skew;
      const intents: OrderIntent[] = [];
      for (let level = 1; level <= agent.levels; level++) {
        // Innermost first, so if capital runs low the near-touch levels post first.
        intents.push({ side: 'buy', size: agent.quoteSize, limitPrice: Math.max(0.01, center - half * level) });
        intents.push({ side: 'sell', size: agent.quoteSize, limitPrice: center + half * level });
      }
      return intents;
    }
    case 'value': {
      // Anchor to the evolving fundamental value (moved by news); buy when cheap,
      // sell when dear, and fade sentiment. Ignore trend inside the dead band.
      const fair = market.fundamentalValue;
      const discount = (fair - price) / fair; // >0 = cheap vs fundamental
      const s = Math.max(-1, Math.min(1, market.sentiment));
      const eff = discount - agent.contrarianGain * s;
      if (eff > agent.marginOfSafety) {
        const size = Math.min(agent.maxOrderShares, agent.conviction * Math.abs(eff) * BASE_SIZE);
        return size > 0 ? [{ side: 'buy', size }] : [];
      }
      if (eff < -agent.marginOfSafety) {
        const size = Math.min(agent.maxOrderShares, agent.conviction * Math.abs(eff) * BASE_SIZE);
        return size > 0 ? [{ side: 'sell', size }] : [];
      }
      return [];
    }
    case 'fomoHerd': {
      // Chase only accelerating up-moves; size up convexly the more extended the
      // run is; amplified by positive sentiment. Buy-only (exit via TP overlay).
      const n = market.priceHistory.length;
      const w = agent.shortWindow;
      if (n < 2 * w + 1 || agent.cash <= 0) return [];
      const rShort = pctChange(market.priceHistory, w);
      const pPrev = market.priceHistory[n - 1 - w];
      const pPrev2 = market.priceHistory[n - 1 - 2 * w];
      const prior = pPrev2 > 0 ? (pPrev - pPrev2) / pPrev2 : 0;
      const accel = rShort - prior;
      if (rShort < agent.entryThreshold || accel <= 0) return [];
      const sentBoost = Math.max(0, market.sentiment);
      const fomoScore = clamp01(
        rShort / agent.entryThreshold - 1 +
          (agent.convexity * accel) / agent.entryThreshold +
          agent.sentimentGain * sentBoost,
      );
      const baseFrac = 0.08;
      const buyFrac = Math.min(agent.maxBuyFrac, baseFrac + (agent.maxBuyFrac - baseFrac) * fomoScore);
      const size = (buyFrac * agent.cash) / price;
      return size > 0 ? [{ side: 'buy', size }] : [];
    }
    case 'whale': {
      // Execute a large program in low-impact slices; bias sign is the mandate.
      const jitter = 1 + (Math.random() * 2 - 1) * agent.participationJitter;
      const r = pctChange(market.priceHistory, 5); // recent move as an impact proxy
      if (agent.bias >= 0) {
        const remaining = agent.targetShares - agent.shares;
        if (remaining < MIN_ORDER) return []; // program complete -> dormant
        if (r > agent.impactBudget && Math.random() < 0.7) return []; // ran up hard -> throttle
        const size = Math.min(agent.sliceSize * jitter, remaining);
        return size > 0 ? [{ side: 'buy', size }] : [];
      }
      const excess = agent.shares - agent.targetShares;
      if (excess < MIN_ORDER) return [];
      if (r < -agent.impactBudget && Math.random() < 0.7) return []; // falling hard -> back off
      const size = Math.min(agent.sliceSize * jitter, excess);
      return size > 0 ? [{ side: 'sell', size }] : [];
    }
    case 'panicSeller': {
      // Capitulate on drawdown-from-peak or a fear (negative-sentiment) shock,
      // then buy back the recovery once panic subsides (classic weak hands).
      const slice = market.priceHistory.slice(-agent.peakWindow);
      const peak = Math.max(...slice);
      const dd = peak > 0 ? (peak - price) / peak : 0;
      const fear = Math.max(0, -market.sentiment);
      if (agent.shares > 0) {
        const triggered = dd >= agent.panicThreshold || fear >= agent.sentPanic;
        if (triggered) {
          const depth = clamp01((dd - agent.panicThreshold) / (agent.capitulationDD - agent.panicThreshold));
          const fearTerm = clamp01(fear - agent.sentPanic);
          const sellFrac = clamp01(agent.baseDumpFrac + (1 - agent.baseDumpFrac) * Math.max(depth, fearTerm));
          const size = sellFrac >= 0.95 ? agent.shares : sellFrac * agent.shares;
          return size > 0 ? [{ side: 'sell', size }] : [];
        }
      }
      if (agent.cash > 0 && market.sentiment >= 0 && dd < agent.panicThreshold) {
        const size = (agent.reentryFrac * agent.cash) / price;
        return size > 0 ? [{ side: 'buy', size }] : [];
      }
      return [];
    }
  }
}

/** Apply a buy fill to an account (increase shares at blended avg cost, spend cash). */
export function applyBuy(account: AgentAccount, price: number, size: number): void {
  const cost = price * size;
  const newShares = account.shares + size;
  account.avgCost = newShares > 0 ? (account.avgCost * account.shares + cost) / newShares : 0;
  account.shares = newShares;
  account.cash -= cost;
  account.tradeCount += 1;
}

/** Apply a sell fill to an account (reduce shares, book realized PnL, receive cash). */
export function applySell(account: AgentAccount, price: number, size: number): void {
  account.realizedPnl += (price - account.avgCost) * size;
  account.shares -= size;
  account.cash += price * size;
  if (account.shares <= 1e-9) {
    account.shares = 0;
    account.avgCost = 0;
  }
  account.tradeCount += 1;
}
