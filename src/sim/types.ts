export type Side = 'buy' | 'sell';

export type AgentType =
  | 'noise'
  | 'momentum'
  | 'meanReversion'
  | 'news'
  | 'marketMaker'
  | 'value'
  | 'fomoHerd'
  | 'whale'
  | 'panicSeller';

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
  bias: number; // directional lean [-1,1]: <0 sells more, >0 buys more
  takeProfit: number; // sell holdings once up this % vs avg cost (0 = off)
  stopLoss: number; // sell holdings once down this % vs avg cost (0 = off)
}

export interface MomentumAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'momentum';
  window: number; // ticks to look back for the trend
  sensitivity: number; // scales order size with the observed % change
  activity: number; // probability [0,1] it acts on a given tick (async arrivals)
  bias: number; // directional lean [-1,1]: adds a perceived baseline trend
  takeProfit: number; // sell holdings once up this % vs avg cost (0 = off)
  stopLoss: number; // sell holdings once down this % vs avg cost (0 = off)
}

export interface MeanReversionAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'meanReversion';
  window: number; // ticks for the moving average
  threshold: number; // % deviation from MA required to act
  strength: number; // scales order size with the deviation
  activity: number; // probability [0,1] it acts on a given tick (async arrivals)
  bias: number; // directional lean [-1,1]: shifts perceived fair value
  takeProfit: number; // sell holdings once up this % vs avg cost (0 = off)
  stopLoss: number; // sell holdings once down this % vs avg cost (0 = off)
}

/** Informed / news trader: trades in the direction of current market sentiment. */
export interface NewsAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'news';
  orderSize: number; // base shares per order (scaled by sentiment strength)
  activity: number; // probability [0,1] it acts on a given tick (async arrivals)
  bias: number; // directional lean [-1,1]: acts like a persistent sentiment backdrop
  takeProfit: number; // sell holdings once up this % vs avg cost (0 = off)
  stopLoss: number; // sell holdings once down this % vs avg cost (0 = off)
}

/** Market maker: posts two-sided resting limit quotes to earn the spread. */
export interface MarketMakerAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'marketMaker';
  spreadBps: number; // half-spread (bps) between price levels
  quoteSize: number; // shares quoted per level per side
  levels: number; // number of price levels quoted on each side (book depth)
  inventorySkew: number; // how strongly to skew quotes to unwind inventory [0,1]
  activity: number; // probability [0,1] it re-quotes on a given tick
  bias: number; // directional lean [-1,1]: shifts both quotes
  takeProfit: number; // unused for MM (kept for shared overlay); default 0
  stopLoss: number; // unused for MM; default 0
}

/** Value / fundamental investor: anchors to a fixed fair value, fades the crowd. */
export interface ValueAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'value';
  marginOfSafety: number; // dead-band: min divergence from fair value before acting
  conviction: number; // order-size multiplier scaling with discount/premium
  contrarianGain: number; // how strongly negative sentiment raises buy willingness
  maxOrderShares: number; // per-order cap to avoid severe slippage
  activity: number;
  bias: number; // carried for UI uniformity; ignored by this strategy
  takeProfit: number; // 0 (value investors don't stop out)
  stopLoss: number; // 0
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
  bias: number; // carried for UI uniformity; ignored
  takeProfit: number; // 0.12 (exits via shared overlay)
  stopLoss: number; // 0 (diamond hands)
}

/** Institution / whale: executes a large accumulate or distribute program in slices. */
export interface WhaleAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'whale';
  targetShares: number; // absolute inventory goal
  sliceSize: number; // base child-order size per tick (TWAP/VWAP-style)
  participationJitter: number; // random +/- fraction on slice size (footprint masking)
  impactBudget: number; // adverse recent move that triggers a probabilistic skip
  activity: number;
  bias: number; // sign is the mandate: >=0 accumulate, <0 distribute
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
  bias: number; // carried for UI uniformity; ignored
  takeProfit: number; // 0 (owns its own exit)
  stopLoss: number; // 0
}

export type Agent =
  | NoiseAgent
  | MomentumAgent
  | MeanReversionAgent
  | NewsAgent
  | MarketMakerAgent
  | ValueAgent
  | FomoHerdAgent
  | WhaleAgent
  | PanicSellerAgent;

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
