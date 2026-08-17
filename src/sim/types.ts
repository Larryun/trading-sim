export type Side = 'buy' | 'sell';

export type AgentType =
  | 'noise'
  | 'marketMaker'
  | 'whale'
  | 'fomoHerd'
  | 'panicSeller'
  | 'trader'
  | 'dealer'
  | 'speculator'
  | 'indexFund'
  | 'holder'
  | 'arb';

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
  minTicksToExpiry: number; // won't buy a series with less time than this (avoids pure decay)
  entryPrice: Map<number, number>; // contractId -> premium paid, so it can take profit / cut losses
  activity: number;
  takeProfit: number; // 0
  stopLoss: number; // 0
}

/**
 * Passive / index fund: holds a large, largely INERT block of stock. It is
 * price-INELASTIC — it buys because money flowed into the fund, not because the stock is
 * cheap — and only adjusts on a slow rebalancing schedule. In real markets passive
 * vehicles hold much of the float while contributing very little order flow, which is
 * what stops market makers from being the dominant holders and price-setters.
 */
export interface IndexFundAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'indexFund';
  // Mandate expressed as a FRACTION OF THE FLOAT, not an absolute share count. A real
  // passive complex holds a roughly stable percentage of a company; expressing it in
  // absolute shares (and growing it) would let it march toward owning everything.
  ownershipTarget: number; // current target share of the float, drifts with net fund flows
  baseOwnership: number; // the weight it mean-reverts to (self-calibrated to what it holds)
  flowVol: number; // how much net inflows/outflows move that share each rebalance
  rebalanceEvery: number; // ticks between adjustments (it is inert in between)
  maxSliceFrac: number; // max fraction of its holding traded per rebalance
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
  | SpeculatorAgent
  | IndexFundAgent
  | HolderAgent
  | ArbAgent;

/**
 * The arbitrageur: a BAND participant, and the market's structural anchor to value.
 *
 * Every other fundamental trader here has a SLOPED demand curve — it wants a bigger position
 * the cheaper the stock gets. Against a fixed float that produces an inverse-demand
 * equilibrium where the discount settles at roughly `float / (gain x capital)`, which is why
 * the market sat permanently 6-11% BELOW fair value and why one cohort's capital was
 * load-bearing: it is the denominator of that expression.
 *
 * This agent instead has a near-VERTICAL curve at a fixed reference: inside `band` it does
 * nothing at all, and outside it it trades at its full permitted rate regardless of how large
 * the gap is. A band participant pins the equilibrium AT the band edge independently of
 * anyone's capital, which is the property the sim was missing.
 *
 * It is rate- and size-limited so dislocations still take hundreds of ticks to close: that
 * delay is the "limits to arbitrage" that make mispricings persist in real markets.
 */
export interface ArbAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'arb';
  band: number; // no-trade zone around consensus value (fraction)
  advFrac: number; // max participation per tick as a fraction of recent volume
  maxFloatFrac: number; // hard cap on |position| as a fraction of the float
  activity: number;
  takeProfit: number;
  stopLoss: number;
}

/**
 * The long-term retail holder base: the long tail of small shareholders who together own a
 * large slice of the free float and almost never trade. Without this cohort the entire float
 * is owned by a handful of big funds, so one of them must arithmetically look like it is
 * hogging the company — real free float simply isn't concentrated that way.
 *
 * It is weakly VALUATION-aware rather than inert: retail supplies stock into euphoric
 * rallies and slowly buys back after crashes. The trickle is deliberately tiny, so it
 * stabilises at the margin without competing to set the price.
 */
export interface HolderAgent extends AgentAccount {
  id: string;
  name: string;
  type: 'holder';
  trimBand: number; // sells only once price exceeds fair by more than this
  trickleFrac: number; // fraction of the position traded per active tick (very small)
  rebalanceEvery: number; // ticks between reviews — this cohort is slow
  activity: number;
  takeProfit: number;
  stopLoss: number;
}

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
  sharesOutstanding: number; // the float, so holders can size a position against it
  // The valuation an arbitrageur trades against: consensus EPS x multiple. Distinct from
  // `fundamentalValue` in that it is what the market can OBSERVE and agree on.
  consensusValue: number;
  advShares: number; // recent average daily volume, to rate-limit participation realistically
}
