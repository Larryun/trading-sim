import type { Agent, AgentAccount, AgentType, MarketState, OrderIntent, Side, TraderStyle } from './types';

// Force a full reload on edits (the engine that calls these lives in a useRef
// and won't pick up hot-swapped agent definitions otherwise).
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

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
  marketMaker: 'Market maker',
  fomoHerd: 'FOMO herd',
  whale: 'Institution / whale',
  panicSeller: 'Panic seller',
  trader: 'Trader',
};

export const AGENT_TYPE_COLORS: Record<AgentType, string> = {
  noise: '#60a5fa',
  marketMaker: '#2dd4bf',
  fomoHerd: '#d946ef',
  whale: '#94a3b8',
  panicSeller: '#ef4444',
  trader: '#22d3ee',
};

/**
 * Trader styles = a "personality": a signed weighting over the
 * [value, momentum, meanReversion, sentiment] signals, plus a default learning
 * rate. These replace the old distinct value / momentum / mean-reversion / news /
 * adaptive archetypes — one configurable agent covering the whole spectrum.
 *   value:      buys cheap vs fair, fades sentiment (the old value/fundamental)
 *   trend:      chases momentum, mild sentiment tailwind (old momentum)
 *   contrarian: fades extension from the mean (old mean-reversion)
 *   news:       trades the mood/information (old news / informed)
 *   balanced:   trusts all four signals equally, fixed
 *   adaptive:   starts balanced but LEARNS which signals work (old adaptive/AI)
 */
export const TRADER_STYLES: Record<TraderStyle, { label: string; color: string; weights: number[]; learningRate: number }> = {
  value: { label: 'Value', color: '#22d3ee', weights: [0.6, 0, 0.2, -0.2], learningRate: 0 },
  trend: { label: 'Trend', color: '#f59e0b', weights: [0, 0.7, -0.1, 0.2], learningRate: 0 },
  contrarian: { label: 'Contrarian', color: '#a78bfa', weights: [0.25, -0.15, 0.5, -0.1], learningRate: 0 },
  news: { label: 'News', color: '#34d399', weights: [0.15, 0.15, 0, 0.7], learningRate: 0 },
  balanced: { label: 'Balanced', color: '#818cf8', weights: [0.25, 0.25, 0.25, 0.25], learningRate: 0 },
  adaptive: { label: 'Adaptive', color: '#fb7185', weights: [0.25, 0.25, 0.25, 0.25], learningRate: 0.5 },
};

/** Style-aware display color: traders color by style, everyone else by type. */
export function agentColor(agent: Agent): string {
  return agent.type === 'trader' ? TRADER_STYLES[agent.style].color : AGENT_TYPE_COLORS[agent.type];
}

/** Style-aware display label: "Value", "Trend"… for traders; the type label otherwise. */
export function agentStyleLabel(agent: Agent): string {
  return agent.type === 'trader' ? `${TRADER_STYLES[agent.style].label} trader` : AGENT_TYPE_LABELS[agent.type];
}

/** Signals a trader blends, each normalized to ~[-1,1] (+ = bullish). */
export function traderSignals(agent: { window: number }, market: MarketState, price: number): number[] {
  const clamp = (x: number) => Math.max(-1, Math.min(1, x));
  const fair = market.fundamentalValue;
  const value = clamp(fair > 0 ? ((fair - price) / fair) * 10 : 0); // cheap vs fair = bullish
  const momentum = clamp(pctChange(market.priceHistory, agent.window) * 50);
  const ma = movingAverage(market.priceHistory, agent.window);
  const meanRev = clamp(ma > 0 ? (-(price - ma) / ma) * 10 : 0); // above MA = bearish
  const sentiment = clamp(market.sentiment / 2);
  return [value, momentum, meanRev, sentiment];
}
export const SIGNAL_NAMES = ['value', 'momentum', 'mean-rev', 'sentiment'];

// Minimum meaningful order size (mirrors the engine's own floor).
const MIN_ORDER = 0.01;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Create an individual agent. By default its capital is split 50/50 into cash and
 * a share inventory (so the initial seed holds the float and can trade either way).
 * With `allCash`, it starts with only cash and must BUY its position from the
 * market — realistic for a new participant joining a running market.
 */
export function createAgent(
  type: AgentType,
  capital: number,
  startingPrice: number,
  id: string,
  name: string,
  style: TraderStyle = 'balanced',
  allCash = false,
): Agent {
  const cash = allCash ? capital : capital / 2;
  const shares = allCash ? 0 : capital / 2 / startingPrice;
  const account = {
    startingCapital: capital,
    cash,
    shares,
    avgCost: allCash ? 0 : startingPrice,
    realizedPnl: 0,
    tradeCount: 0,
  };

  switch (type) {
    case 'noise':
      // Pure liquidity/noise: no profit-seeking exit (let it churn both ways).
      return { id, name, type, frequency: 0.35, maxSize: 14, takeProfit: 0, stopLoss: 0, ...account };
    case 'trader': {
      // One configurable directional trader. Its `style` sets the signal weights
      // (its personality); learningRate > 0 makes it adapt those weights over time.
      const preset = TRADER_STYLES[style];
      return {
        id, name, type, style,
        weights: [...preset.weights], learningRate: preset.learningRate,
        conviction: 10, window: 10, activity: 0.6,
        lastSignals: [], lastPrice: 0, smoothScore: 0, takeProfit: 0, stopLoss: 0, ...account,
      };
    }
    case 'marketMaker':
      // A maker manages inventory via quote skew, so the shared TP/SL exit is off.
      // Deep ladders + a volatility-adaptive spread so it widens (charging more) when
      // informed flow is pushing the price around, its defense against adverse selection.
      return { id, name, type, spreadBps: 12, volSensitivity: 0.8, maxSpreadBps: 100, quoteSize: 200, levels: 12, inventorySkew: 0.4, activity: 0.8, takeProfit: 0, stopLoss: 0, ...account };
    case 'fomoHerd':
      // Threshold lowered to match the (small) moves a deeply-liquid book produces,
      // so the crowd actually chases rallies instead of waiting for a rare spike.
      return { id, name, type, shortWindow: 3, entryThreshold: 0.002, sentimentGain: 1, convexity: 2, maxBuyFrac: 0.4, activity: 0.5, takeProfit: 0.12, stopLoss: 0, ...account };
    case 'whale':
      // Value-timed institution: accumulates up to targetShares while the stock is
      // undervalued (price below fair by > valueBand), distributes back down while
      // it's overvalued. Starts cash-heavy (mostly dry powder to deploy).
      return {
        id, name, type, targetShares: 1000, sliceSize: 40, participationJitter: 0.3, impactBudget: 0.008,
        activity: 0.6, valueBand: 0.03, takeProfit: 0, stopLoss: 0,
        ...account,
        ...(allCash ? {} : { cash: capital * 0.9, shares: (capital * 0.1) / startingPrice }),
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
    case 'trader': {
      const sig = traderSignals(agent, market, price);
      // If it learns (learningRate > 0), nudge each weight toward whatever predicted
      // the return since its last decision. Weights are SIGNED (a style can be short
      // a signal), so use an additive gradient step + L1-normalize (not multiplicative
      // Hedge, which only works for nonnegative weights).
      if (agent.learningRate > 0 && agent.lastPrice > 0 && agent.lastSignals.length === 4) {
        const r = (price - agent.lastPrice) / agent.lastPrice;
        let l1 = 0;
        for (let i = 0; i < 4; i++) {
          agent.weights[i] += agent.learningRate * agent.lastSignals[i] * r * 20;
          l1 += Math.abs(agent.weights[i]);
        }
        if (l1 > 0) for (let i = 0; i < 4; i++) agent.weights[i] /= l1; // keep total influence bounded
      }
      agent.lastSignals = sig;
      agent.lastPrice = price;

      const score = sig.reduce((s, v, i) => s + (agent.weights[i] ?? 0) * v, 0);
      // Smooth the score so a noisy tick doesn't flip the target — trade the view, not the jitter.
      agent.smoothScore = 0.85 * agent.smoothScore + 0.15 * score;

      // Hold a TARGET exposure ∝ conviction × smoothed score (capped at ±100% of
      // equity) and rebalance only when the position drifts meaningfully off it — so a
      // stable view means little trading (no fee bleed), a flip means it reverses.
      const equity = agent.cash + agent.shares * price;
      const targetExposure = Math.max(-1, Math.min(1, agent.conviction * agent.smoothScore * 0.15));
      const desired = price > 0 ? (targetExposure * equity) / price : 0;
      const delta = desired - agent.shares;
      const band = Math.max((equity * 0.1) / Math.max(price, 1), 1); // ~10%-of-equity deadband
      if (Math.abs(delta) < band) return [];
      return [{ side: delta > 0 ? 'buy' : 'sell', size: Math.abs(delta) }];
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
      // Value-timed: its DIRECTION comes from valuation (its thesis), and it executes
      // in small low-impact slices. Accumulate a stake while the stock is cheap vs
      // fair value, distribute it while rich — i.e. buy low, sell high (this is where
      // its edge, and its profit, come from). Fairly valued → patient, no trade.
      const fair = market.fundamentalValue;
      const disc = fair > 0 ? (fair - price) / fair : 0; // >0 cheap, <0 expensive
      const jitter = 1 + (Math.random() * 2 - 1) * agent.participationJitter;
      const r = pctChange(market.priceHistory, 5); // recent move as an impact proxy
      if (disc > agent.valueBand) {
        // Undervalued → accumulate toward the max stake.
        const remaining = agent.targetShares - agent.shares;
        if (remaining < MIN_ORDER) return []; // stake full
        if (r > agent.impactBudget && Math.random() < 0.7) return []; // don't chase a spike up
        const size = Math.min(agent.sliceSize * jitter, remaining);
        return size > 0 ? [{ side: 'buy', size }] : [];
      }
      if (disc < -agent.valueBand) {
        // Overvalued → distribute the position (can't short — sells only what it holds).
        const excess = agent.shares;
        if (excess < MIN_ORDER) return [];
        if (r < -agent.impactBudget && Math.random() < 0.7) return []; // don't dump into a crash
        const size = Math.min(agent.sliceSize * jitter, excess);
        return size > 0 ? [{ side: 'sell', size }] : [];
      }
      return []; // fairly valued — wait
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
    case 'trader': {
      const sig = traderSignals(agent, market, price);
      const score = sig.reduce((s, v, i) => s + (agent.weights[i] ?? 0) * v, 0);
      const v: Verdict = Math.abs(score) <= 0.05 ? 'hold' : score > 0 ? 'buy' : 'sell';
      const learns = agent.learningRate > 0;
      // Color each weight by its SIGN (the fixed personality): green = trades this
      // signal with the trend, red = fades it. Static unless the trader is learning,
      // so the color stops flickering with every tick's market move.
      const signals: DecisionSignal[] = agent.weights.map((w, i) => ({
        label: `${SIGNAL_NAMES[i]} weight`,
        value: `${w >= 0 ? '+' : ''}${(w * 100).toFixed(0)}%`,
        lean: w > 0.005 ? 1 : w < -0.005 ? -1 : 0,
      }));
      signals.push({ label: 'Blended score', value: score.toFixed(2), lean: score > 0 ? 1 : score < 0 ? -1 : 0 });
      const styleName = TRADER_STYLES[agent.style].label;
      return {
        rule: `${styleName} trader — holds a target exposure driven by a weighted blend of value, momentum, mean-reversion and sentiment${learns ? ', and LEARNS which signals to trust' : ''}.`,
        signals,
        verdict: v,
        // Static description (doesn't flip with the live verdict): how it decides, not
        // what it happens to want this exact tick.
        detail: `It targets an exposure proportional to the blended score and rebalances only when its position drifts off that target — so a steady view means little trading, a flip means it reverses.${learns ? ' Its weights adapt over time toward whichever signals have been predicting returns.' : ''}`,
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
      const fair = market.fundamentalValue;
      const disc = fair > 0 ? (fair - price) / fair : 0; // >0 cheap, <0 expensive
      const cheap = disc > agent.valueBand;
      const rich = disc < -agent.valueBand;
      const v: Verdict = cheap && agent.shares < agent.targetShares - 0.01 ? 'buy'
        : rich && agent.shares > 0.01 ? 'sell' : 'hold';
      return {
        rule: 'A large institution that accumulates when the stock is undervalued and distributes when overvalued — buy low, sell high — in small low-impact slices.',
        signals: [
          { label: 'Price vs fair', value: `${(disc * 100).toFixed(1)}%`, lean: disc > 0 ? 1 : disc < 0 ? -1 : 0 },
          { label: 'Holds', value: agent.shares.toFixed(0), lean: 0 },
          { label: 'Max stake', value: agent.targetShares.toFixed(0), lean: 0 },
        ],
        verdict: v,
        detail: v === 'buy' ? `Undervalued (>${(agent.valueBand * 100).toFixed(0)}% below fair) → accumulating ~${agent.sliceSize} sh/tick, easing off on spikes.`
          : v === 'sell' ? `Overvalued (>${(agent.valueBand * 100).toFixed(0)}% above fair) → distributing ~${agent.sliceSize} sh/tick, easing off on crashes.`
          : 'Price near fair value (or stake already at its limit) — waits.',
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
