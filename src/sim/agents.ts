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

/** Realized volatility: std of per-tick returns over the last `window` ticks. */
function realizedVol(history: number[], window: number): number {
  const n = Math.min(window, history.length - 1);
  if (n < 2) return 0;
  const rets: number[] = [];
  for (let i = history.length - n; i < history.length; i++) {
    const p0 = history[i - 1];
    if (p0 > 0) rets.push((history[i] - p0) / p0);
  }
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length);
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
      return { id, name, type, frequency: 0.35, maxSize: 14, takeProfit: 0, stopLoss: 0, ...account };
    case 'momentum':
      // Trend follower: let winners run (wide TP), cut losers.
      return { id, name, type, window: 10, sensitivity: 5, activity: 0.6, takeProfit: 0.15, stopLoss: 0.06, ...account };
    case 'meanReversion':
      // Fades extremes: quick to take small gains, slow to cut.
      return { id, name, type, window: 20, threshold: 0.01, strength: 5, activity: 0.5, takeProfit: 0.04, stopLoss: 0.10, ...account };
    case 'news':
      return { id, name, type, orderSize: 400, activity: 0.7, takeProfit: 0.06, stopLoss: 0.06, ...account };
    case 'marketMaker':
      // A maker manages inventory via quote skew, so the shared TP/SL exit is off.
      // Deep ladders + a volatility-adaptive spread so it widens (charging more) when
      // informed flow is pushing the price around, its defense against adverse selection.
      return { id, name, type, spreadBps: 12, volSensitivity: 0.8, maxSpreadBps: 100, quoteSize: 200, levels: 12, inventorySkew: 0.4, activity: 0.8, takeProfit: 0, stopLoss: 0, ...account };
    case 'value':
      // Strong, forceful fundamentalists so price is tightly tethered to fair value
      // (the main long-only force correcting mispricing without shorting).
      return { id, name, type, marginOfSafety: 0.015, conviction: 22, contrarianGain: 0.25, maxOrderShares: 3000, activity: 0.65, takeProfit: 0, stopLoss: 0, ...account };
    case 'fomoHerd':
      // Threshold lowered to match the (small) moves a deeply-liquid book produces,
      // so the crowd actually chases rallies instead of waiting for a rare spike.
      return { id, name, type, shortWindow: 3, entryThreshold: 0.002, sentimentGain: 1, convexity: 2, maxBuyFrac: 0.4, activity: 0.5, takeProfit: 0.12, stopLoss: 0, ...account };
    case 'whale':
      // mandate: +1 accumulate up to targetShares, -1 distribute down to it.
      // Starts cash-heavy (a whale about to accumulate holds mostly cash), and a
      // modest default target so it doesn't try to corner the whole float.
      return {
        id, name, type, targetShares: 1000, sliceSize: 40, participationJitter: 0.3, impactBudget: 0.008,
        activity: 0.6, mandate: 1, takeProfit: 0, stopLoss: 0,
        ...account, cash: capital * 0.9, shares: (capital * 0.1) / startingPrice,
      };
    case 'panicSeller':
      return { id, name, type, peakWindow: 15, panicThreshold: 0.06, capitulationDD: 0.15, baseDumpFrac: 0.4, sentPanic: 0.6, reentryFrac: 0.3, activity: 0.7, takeProfit: 0, stopLoss: 0, ...account };
  }
}

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
      // Random uninformed flow — a fair coin flip on side.
      const side: Side = Math.random() < 0.5 ? 'buy' : 'sell';
      const size = Math.random() * agent.maxSize;
      return size > 0 ? [{ side, size }] : [];
    }
    case 'momentum': {
      const change = pctChange(market.priceHistory, agent.window);
      if (Math.abs(change) <= 0.0001) return [];
      const side: Side = change > 0 ? 'buy' : 'sell';
      const size = agent.sensitivity * Math.abs(change) * BASE_SIZE;
      return size > 0 ? [{ side, size }] : [];
    }
    case 'meanReversion': {
      const ma = movingAverage(market.priceHistory, agent.window);
      const deviation = ma > 0 ? (price - ma) / ma : 0;
      if (Math.abs(deviation) <= agent.threshold) return [];
      const side: Side = deviation > 0 ? 'sell' : 'buy'; // fade the move
      const size = agent.strength * Math.abs(deviation) * BASE_SIZE;
      return size > 0 ? [{ side, size }] : [];
    }
    case 'news': {
      // Informed traders act on incoming information: buy on positive sentiment,
      // sell on negative, sized by how strong the current sentiment is.
      if (Math.abs(market.sentiment) <= 0.02) return [];
      const side: Side = market.sentiment > 0 ? 'buy' : 'sell';
      const size = agent.orderSize * Math.abs(market.sentiment);
      return size > 0 ? [{ side, size }] : [];
    }
    case 'marketMaker': {
      // Post a two-sided ladder of resting quotes stepping away from mid, skewed to
      // unwind inventory (quote lower when long, higher when short) and shifted by
      // directional bias. This is what gives the order book real depth.
      const mid = price;
      // Adaptive spread: widen with recent volatility so informed flow pays more.
      const volBps = realizedVol(market.priceHistory, 20) * 10000;
      const effSpreadBps = Math.min(agent.maxSpreadBps, agent.spreadBps + agent.volSensitivity * volBps);
      const half = mid * (effSpreadBps / 10000);
      const equity = agent.cash + agent.shares * mid;
      const targetShares = mid > 0 ? equity / 2 / mid : 0; // aim to hold ~half in stock
      const excess = targetShares > 0 ? (agent.shares - targetShares) / targetShares : 0;
      const skew = agent.inventorySkew * Math.max(-1, Math.min(1, excess)) * half;
      const center = mid - skew;
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
      // Execute a large program in low-impact slices; mandate sign sets direction.
      const jitter = 1 + (Math.random() * 2 - 1) * agent.participationJitter;
      const r = pctChange(market.priceHistory, 5); // recent move as an impact proxy
      if (agent.mandate >= 0) {
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

export type Verdict = 'buy' | 'sell' | 'hold' | 'quote';
export interface DecisionSignal {
  label: string;
  value: string;
  lean: number; // +1 bullish, -1 bearish, 0 neutral (for coloring)
}
export interface DecisionExplanation {
  rule: string; // plain-English description of the strategy
  signals: DecisionSignal[]; // the live inputs it reads right now
  verdict: Verdict; // what it would do this instant
  detail: string; // why
}

/**
 * Explain, in plain terms, how an agent decides right now: the live signals it
 * reads and the resulting verdict. Deterministic (ignores the random activity
 * gate) — it shows the underlying lean, for the "Agent Decisions" view.
 */
export function explainDecision(agent: Agent, market: MarketState): DecisionExplanation {
  const price = market.priceHistory[market.priceHistory.length - 1] ?? 0;
  switch (agent.type) {
    case 'noise':
      return {
        rule: 'Trades at random — uninformed flow that just pays the spread.',
        signals: [{ label: 'Direction', value: '50/50 coin flip', lean: 0 }],
        verdict: 'hold',
        detail: `On each active tick it randomly buys or sells up to ${agent.maxSize} shares.`,
      };
    case 'momentum': {
      const ch = pctChange(market.priceHistory, agent.window);
      const v: Verdict = Math.abs(ch) <= 0.0001 ? 'hold' : ch > 0 ? 'buy' : 'sell';
      return {
        rule: 'Chases the trend — buys when price is rising, sells when falling.',
        signals: [{ label: `Trend (${agent.window}t)`, value: `${(ch * 100).toFixed(2)}%`, lean: ch > 0 ? 1 : ch < 0 ? -1 : 0 }],
        verdict: v,
        detail: v === 'hold' ? 'Trend is flat — waits.' : `Recent trend is ${ch > 0 ? 'up' : 'down'} → ${v}; size grows with trend strength.`,
      };
    }
    case 'meanReversion': {
      const ma = movingAverage(market.priceHistory, agent.window);
      const dev = ma > 0 ? (price - ma) / ma : 0;
      const v: Verdict = Math.abs(dev) <= agent.threshold ? 'hold' : dev > 0 ? 'sell' : 'buy';
      return {
        rule: 'Fades deviations from its moving average — bets price snaps back.',
        signals: [
          { label: `MA(${agent.window})`, value: `$${ma.toFixed(2)}`, lean: 0 },
          { label: 'Deviation', value: `${(dev * 100).toFixed(2)}%`, lean: dev > 0 ? -1 : dev < 0 ? 1 : 0 },
        ],
        verdict: v,
        detail: v === 'hold' ? `Within ±${(agent.threshold * 100).toFixed(1)}% of the average — no trade.` : `Price is ${dev > 0 ? 'above' : 'below'} its average → fade it (${v}).`,
      };
    }
    case 'news': {
      const s = market.sentiment;
      const v: Verdict = Math.abs(s) <= 0.02 ? 'hold' : s > 0 ? 'buy' : 'sell';
      return {
        rule: 'Trades on information — follows market sentiment.',
        signals: [{ label: 'Sentiment', value: s.toFixed(2), lean: s > 0 ? 1 : s < 0 ? -1 : 0 }],
        verdict: v,
        detail: v === 'hold' ? 'Mood is neutral — sits out.' : `Sentiment is ${s > 0 ? 'positive' : 'negative'} → ${v}; size grows with |sentiment|.`,
      };
    }
    case 'value': {
      const fair = market.fundamentalValue;
      const disc = fair > 0 ? (fair - price) / fair : 0;
      const s = Math.max(-1, Math.min(1, market.sentiment));
      const eff = disc - agent.contrarianGain * s;
      const v: Verdict = eff > agent.marginOfSafety ? 'buy' : eff < -agent.marginOfSafety ? 'sell' : 'hold';
      return {
        rule: 'Buys below fair value, sells above — and fades panic (contrarian).',
        signals: [
          { label: 'Fair value', value: `$${fair.toFixed(2)}`, lean: 0 },
          { label: 'Discount', value: `${(disc * 100).toFixed(1)}%`, lean: disc > 0 ? 1 : disc < 0 ? -1 : 0 },
          { label: 'After contrarian', value: `${(eff * 100).toFixed(1)}%`, lean: eff > 0 ? 1 : eff < 0 ? -1 : 0 },
        ],
        verdict: v,
        detail: v === 'hold' ? `Within its ${(agent.marginOfSafety * 100).toFixed(1)}% margin of safety — waits.` : `${eff > 0 ? 'Cheap' : 'Expensive'} vs fair beyond its margin → ${v}.`,
      };
    }
    case 'fomoHerd': {
      const w = agent.shortWindow;
      const n = market.priceHistory.length;
      let rShort = 0;
      let accel = 0;
      if (n >= 2 * w + 1) {
        rShort = pctChange(market.priceHistory, w);
        const pp = market.priceHistory[n - 1 - w];
        const pp2 = market.priceHistory[n - 1 - 2 * w];
        const prior = pp2 > 0 ? (pp - pp2) / pp2 : 0;
        accel = rShort - prior;
      }
      const v: Verdict = rShort >= agent.entryThreshold && accel > 0 ? 'buy' : 'hold';
      return {
        rule: 'Chases accelerating rallies (buy-only) — and bagholds the reversal.',
        signals: [
          { label: `Run (${w}t)`, value: `${(rShort * 100).toFixed(2)}%`, lean: rShort > 0 ? 1 : 0 },
          { label: 'Accelerating?', value: accel > 0 ? 'yes' : 'no', lean: accel > 0 ? 1 : 0 },
        ],
        verdict: v,
        detail: v === 'buy' ? 'The rally is accelerating past its trigger → piles in.' : 'No accelerating rally to chase — waits (or holds its bags).',
      };
    }
    case 'whale': {
      const acc = agent.mandate >= 0;
      const remaining = acc ? agent.targetShares - agent.shares : agent.shares - agent.targetShares;
      const v: Verdict = remaining > 0.01 ? (acc ? 'buy' : 'sell') : 'hold';
      return {
        rule: `A large institution working an ${acc ? 'accumulate' : 'distribute'} program in small slices.`,
        signals: [
          { label: 'Holds', value: agent.shares.toFixed(0), lean: 0 },
          { label: 'Target', value: agent.targetShares.toFixed(0), lean: 0 },
          { label: 'Remaining', value: remaining.toFixed(0), lean: v === 'buy' ? 1 : v === 'sell' ? -1 : 0 },
        ],
        verdict: v,
        detail: v === 'hold' ? 'Program complete — dormant.' : `${acc ? 'Buying' : 'Selling'} ~${agent.sliceSize} sh/tick toward its target, backing off when its own impact is high.`,
      };
    }
    case 'panicSeller': {
      const slice = market.priceHistory.slice(-agent.peakWindow);
      const peak = slice.length ? Math.max(...slice) : price;
      const dd = peak > 0 ? (peak - price) / peak : 0;
      const fear = Math.max(0, -market.sentiment);
      const triggered = agent.shares > 0 && (dd >= agent.panicThreshold || fear >= agent.sentPanic);
      const v: Verdict = triggered ? 'sell' : agent.cash > 0 && market.sentiment >= 0 && dd < agent.panicThreshold ? 'buy' : 'hold';
      return {
        rule: 'Weak hands — capitulates on drawdown/fear, buys back once calm.',
        signals: [
          { label: 'Drawdown', value: `${(dd * 100).toFixed(1)}%`, lean: dd > 0 ? -1 : 0 },
          { label: 'Fear', value: fear.toFixed(2), lean: fear > 0 ? -1 : 0 },
        ],
        verdict: v,
        detail: triggered ? 'Drawdown/fear past its panic point → dumps shares.' : v === 'buy' ? 'Calm and holding cash → buys back the recovery.' : 'Calm with nothing to dump — waits.',
      };
    }
    case 'marketMaker': {
      const volBps = realizedVol(market.priceHistory, 20) * 10000;
      const eff = Math.min(agent.maxSpreadBps, agent.spreadBps + agent.volSensitivity * volBps);
      return {
        rule: 'Provides liquidity — quotes both sides and earns the spread; widens when volatile.',
        signals: [
          { label: 'Recent vol', value: `${volBps.toFixed(1)} bps`, lean: 0 },
          { label: 'Half-spread', value: `${eff.toFixed(0)} bps`, lean: 0 },
          { label: 'Inventory', value: agent.shares.toFixed(0), lean: 0 },
        ],
        verdict: 'quote',
        detail: `Posts ${agent.levels} levels × ${agent.quoteSize} sh each side around $${price.toFixed(2)}, skewing to unwind inventory.`,
      };
    }
  }
}

/**
 * Apply a fill to an account, supporting signed positions (long OR short).
 * `avgCost` is the entry price of the current position; a short position has
 * negative shares and profits when price falls. Handles opening, adding,
 * reducing, and flipping through zero — so short selling works correctly.
 */
export function applyTrade(account: AgentAccount, side: Side, price: number, size: number): void {
  const dir = side === 'buy' ? 1 : -1;
  const cur = account.shares;
  account.cash -= dir * price * size; // buy spends cash, sell/short receives it
  account.tradeCount += 1;

  if (cur === 0 || Math.sign(cur) === dir) {
    // Opening or increasing the position in the same direction: blend avg cost.
    const mag = Math.abs(cur);
    account.avgCost = (account.avgCost * mag + price * size) / (mag + size);
    account.shares = cur + dir * size;
    return;
  }

  // Trading against the position: realize PnL on the portion that closes.
  const closing = Math.min(size, Math.abs(cur));
  const wasLong = cur > 0;
  account.realizedPnl += (wasLong ? price - account.avgCost : account.avgCost - price) * closing;
  const newShares = cur + dir * size;
  account.shares = newShares;
  if (Math.abs(newShares) < 1e-9) {
    account.shares = 0;
    account.avgCost = 0;
  } else if (Math.sign(newShares) === dir) {
    // Flipped through zero — the remainder opens a fresh position at this price.
    account.avgCost = price;
  }
  // else: partial close, avgCost of the remaining position is unchanged.
}
