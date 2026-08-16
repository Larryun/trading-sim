export type Side = 'buy' | 'sell';

export type AgentType =
  | 'noise'
  | 'marketMaker'
  | 'whale'
  | 'fomoHerd'
  | 'panicSeller'
  | 'trader'
  | 'dealer'
  | 'speculator';

// Trader styles = a weighting over the [value, momentum, meanReversion, sentiment]
// signals. Different styles = different kinds of people. 'Adaptive' starts balanced
// but learns; the rest are fixed personalities (learningRate 0).
export type TraderStyle = 'value' | 'trend' | 'contrarian' | 'news' | 'balanced' | 'adaptive';

/** What an agent wants to do this tick. A `limitPrice` makes it a resting limit order. */
export interface OrderIntent {
  side: Side;
  size: number;
  limitPrice?: number; // undefined => market order
}

/** A market order: it walks available liquidity; any unfilled remainder is dropped. */
export interface Order {
  side: Side;
  size: number;
  ownerId: string;
}

/** A resting limit order sitting in the book (only the liquidity provider rests orders). */
export interface RestingOrder {
  side: Side;
  size: number;
  price: number;
  ownerId: string;
  id: number;
}

export interface Trade {
  id: number;
  tick: number;
  side: Side;
  size: number;
  price: number;
  buyerId: string;
  sellerId: string;
}

/** The account/portfolio state every individual agent carries. */
export interface AgentAccount {
  startingCapital: number;
  cash: number;
  shares: number;
  avgCost: number;
  realizedPnl: number;
  tradeCount: number;
}

export interface NoiseAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'noise';
  frequency: number; // probability [0,1] it trades on a given tick
  maxSize: number; // max shares per order
  takeProfit: number; // sell holdings once up this % vs avg cost (0 = off)
  stopLoss: number; // sell holdings once down this % vs avg cost (0 = off)
}

/**
 * Generalized directional trader: holds a target exposure driven by a weighted
 * blend of signals (value, momentum, mean-reversion, sentiment). Its `style` sets
 * those weights (a "personality"); with learningRate > 0 it also adapts them.
 * This one type replaces the old value / momentum / mean-reversion / news / adaptive agents.
 */
export interface TraderAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'trader';
  style: TraderStyle;
  weights: number[]; // signed weights over [value, momentum, meanReversion, sentiment]
  learningRate: number; // 0 = fixed personality; > 0 = adapts weights toward what's working
  conviction: number; // how much target exposure scales with the blended score
  window: number; // lookback for the momentum / moving-average signals
  activity: number;
  lastSignals: number[]; // signal snapshot from its previous decision
  lastPrice: number; // price at its previous decision (to score the signals)
  smoothScore: number; // EMA of the blended score, so it trades the view not the noise
  takeProfit: number; // 0 (rebalances toward target instead)
  stopLoss: number; // 0
}

/** Market maker: posts two-sided resting limit quotes to earn the spread. */
export interface MarketMakerAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'marketMaker';
  spreadBps: number; // base half-spread (bps) between price levels
  volSensitivity: number; // how much recent volatility widens the spread (adverse-selection defense)
  maxSpreadBps: number; // cap on the widened half-spread
  quoteSize: number; // shares quoted per level per side
  levels: number; // number of price levels quoted on each side (book depth)
  inventorySkew: number; // how strongly to skew quotes to unwind inventory [0,1]
  activity: number; // probability [0,1] it re-quotes on a given tick
  takeProfit: number; // unused for MM (kept for shared overlay); default 0
  stopLoss: number; // unused for MM; default 0
}

/** Retail FOMO crowd: chases accelerating up-moves, buy-only, bagholds reversals. */
export interface FomoHerdAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'fomoHerd';
  shortWindow: number; // lookback for the momentum/acceleration signal
  entryThreshold: number; // min short-window run required to chase
  sentimentGain: number; // how much positive sentiment amplifies eagerness
  convexity: number; // how strongly buy size scales with the run's steepness
  maxBuyFrac: number; // max fraction of remaining cash per buy at full FOMO
  activity: number;
  takeProfit: number; // 0.12 (exits via shared overlay)
  stopLoss: number; // 0 (diamond hands)
}

/** Institution / whale: executes a large accumulate or distribute program in slices. */
export interface WhaleAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'whale';
  targetShares: number; // max stake it will build when the stock is undervalued
  sliceSize: number; // base child-order size per tick (TWAP/VWAP-style)
  participationJitter: number; // random +/- fraction on slice size (footprint masking)
  impactBudget: number; // adverse recent move that triggers a probabilistic skip
  activity: number;
  valueBand: number; // how far price must sit from fair value before it acts (its thesis)
  takeProfit: number; // 0
  stopLoss: number; // 0
}

/**
 * Options dealer: models only the delta-HEDGING flow of an options book (no pricing).
 * Short gamma (netGamma < 0) → must buy as price rises and sell as it falls, amplifying
 * moves (gamma squeeze / positive feedback); long gamma → fades moves (pinning). Gamma
 * flips around the strike (short above a call wall, milder/long below).
 */
export interface DealerAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'dealer';
  netGamma: number; // signed dealer gamma; < 0 = short gamma (destabilizing), > 0 = long gamma (pinning)
  openInterest: number; // scales the hedge size per unit price move
  strike: number; // the option strike; gamma sign/magnitude flips as price crosses it
  activity: number;
  takeProfit: number; // 0
  stopLoss: number; // 0
}

/**
 * Options speculator: expresses a directional view through OPTIONS instead of stock —
 * buys calls in bullish regimes, puts in bearish ones (cash-limited, long-only). Its
 * open interest is what the dealer must hedge, so a crowd of speculators is what makes
 * gamma squeezes emerge on their own. Only active when the options market is enabled.
 */
export interface SpeculatorAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'speculator';
  window: number; // lookback for the momentum part of its signal
  conviction: number; // how strongly the signal must lean before it buys
  budgetFrac: number; // max fraction of cash spent on premium per trade
  activity: number;
  takeProfit: number; // 0
  stopLoss: number; // 0
}

/** Panic seller: capitulates on drawdown/fear, buys back the recovery (weak hands). */
export interface PanicSellerAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'panicSeller';
  peakWindow: number; // lookback for the trailing peak used to measure drawdown
  panicThreshold: number; // drawdown-from-peak that triggers selling
  capitulationDD: number; // drawdown at which it liquidates ~100%
  baseDumpFrac: number; // fraction of shares sold at the trigger threshold
  sentPanic: number; // negative-sentiment magnitude that triggers selling
  reentryFrac: number; // fraction of cash redeployed per tick once panic subsides
  activity: number;
  takeProfit: number; // 0 (owns its own exit)
  stopLoss: number; // 0
}

export type Agent =
  | NoiseAgent
  | MarketMakerAgent
  | FomoHerdAgent
  | WhaleAgent
  | PanicSellerAgent
  | TraderAgent
  | DealerAgent
  | SpeculatorAgent;

/** A record of one executed user order, for the order-history view. */
export interface UserOrderRecord {
  id: number;
  tick: number;
  side: Side;
  shares: number;
  avgPrice: number; // volume-weighted fill price
  gain: number; // realized gain booked by this order (nonzero only for sells)
}

/** A discrete piece of news that injects sentiment into the market. */
export interface NewsEvent {
  id: number;
  tick: number;
  headline: string;
  sentiment: number; // signed: positive = bullish, negative = bearish
}

export interface MarketState {
  priceHistory: number[];
  tick: number;
  sentiment: number; // current decaying market sentiment from recent news
  fundamentalValue: number; // the "true" value, permanently repriced by news
}
