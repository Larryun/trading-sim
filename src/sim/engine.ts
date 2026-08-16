import { OrderBook } from './orderBook';
import { AGENT_TYPE_LABELS, TRADER_STYLES, applyTrade, createAgent, decideOrder } from './agents';
import { randomHeadline } from './news';
import { RingBuffer } from './ringBuffer';
import { blackScholes, intrinsicValue, type OptionContract, type OptionType } from './options';
import type { Agent, AgentAccount, AgentType, MarketState, NewsEvent, Side, Trade, TraderStyle, UserOrderRecord } from './types';

// The engine instance lives in a useRef and is NOT rebuilt by HMR, so editing
// this module while the app runs would leave a stale instance (missing new agent
// types / order methods). Force a full page reload on edits to avoid that.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

const STARTING_PRICE = 100;
const MIN_ORDER = 0.01;
const USER_STARTING_CASH = 100000;

// Must cover the largest chart window: MAX_DISPLAY_BARS (120) × max bar size (60
// ticks) = 7200 samples. Sized above that so the 120-bar window fills and scrolls
// correctly even at the coarsest bar size (otherwise the oldest candle can't drop).
const HISTORY_CAP = 8192;
const STRATEGY_WINDOW = 256;
const MAX_TRADES = 500;

// News arrives in lumpy bursts, not a constant drizzle: a low base rate, but an
// event raises the odds of follow-ups for a while (clustering).
const AUTO_NEWS_PROB = 0.008;
const NEWS_CLUSTER_TICKS = 30; // window over which follow-up news is more likely
const NEWS_CLUSTER_BOOST = 5; // how much more likely follow-ups are inside a cluster
// The market mood drifts on a slow, PERSISTENT tide (a continuous bull/bear bias that
// wanders slowly and lingers on one side for a long time) — long smooth regimes with
// nuanced values, not a binary happy/sad square wave and not fast noise.
const NEWS_REGIME_DECAY = 0.9995; // very slow mean reversion → long one-sided excursions (regimes last)
const NEWS_REGIME_STEP = 0.02; // random-walk step of the tide (how far it swings)
const NEWS_REGIME_BIAS = 0.45; // how strongly the tide tilts news direction (0..0.5)
const NEWS_REGIME_LEVEL = 1.5; // how much the tide biases sentiment (moderate → lasting but not binary)
// A news event's fundamental repricing DIFFUSES in over time rather than jumping,
// so the market shows realistic post-news drift as the information propagates.
const FUNDAMENTAL_DIFFUSION = 0.06;

// Fundamentals: fair value is DERIVED, not hand-set — fairValue = EPS × P/E multiple
// (a Gordon-growth / earnings-multiple valuation). Earnings grow each "quarter" with
// a random beat/miss surprise; news = changes to earnings expectations (guidance).
const EARNINGS_PERIOD = 200; // ticks between earnings reports (a "quarter")
const EARNINGS_GROWTH = 0.002; // baseline earnings growth booked each report (gentle secular drift)
const CONSENSUS_EASE = 0.006; // how fast the market's expected-EPS drifts toward the anticipated next report
const EARNINGS_SURPRISE = 0.02; // max random beat/miss per report (±) — kept modest so the fixed-float,
                                // long-biased agent pool can still track fair value (it can't chase a runaway)
const VALUATION_MULTIPLE = 20; // price/earnings multiple applied to EPS to get fair value

// Options market (opt-in). A rolling chain of strikes around spot; the dealer is short
// whatever the public is long and delta-hedges in the stock — so gamma squeezes emerge
// from real open interest rather than a slider.
const TICKS_PER_YEAR = 800; // 4 quarters × 200 ticks — for Black-Scholes time-to-expiry
const CONTRACT_MULTIPLIER = 100; // shares per contract (like real US options)
const OPTION_LIFETIME = 400; // ticks until a freshly-issued chain expires (~2 quarters)
const OPTION_STRIKE_OFFSETS = [-0.1, -0.05, 0, 0.05, 0.1]; // strikes as fractions around spot

// Short selling: bearish "view" traders can borrow & sell (shares go negative),
// collateralized by their cash. If a rising price wipes out that collateral they
// get margin-called and forced to buy back — the fuel for short squeezes.
const CAN_SHORT = new Set<AgentType>(['trader', 'dealer']);
const SHORT_COLLATERAL = 1; // may short up to this * cash worth of shares
const MAINT_MARGIN = 0.25; // margin call when equity falls below this * short exposure
// Sentiment realism: beyond discrete news jumps, the "mood" also reacts to recent
// price action (reflexivity), wobbles randomly, spikes harder on the way down
// (fear), and gets jumpier when already excited (volatility clustering).
const SENTIMENT_REFLEX_WINDOW = 12; // ticks of price action the mood reads (longer = smoother)
const SENTIMENT_MOOD_NOISE = 0.003; // small random wobble (kept low so the regime shows through, not noise)
const SENTIMENT_FEAR_ASYMMETRY = 1.6; // downside moves move the FAST mood more than up
const SENTIMENT_CAP = 3; // bound so the reflexive loop can't run away
const REFLEX_MOOD_DECAY = 0.85; // fast component leaks quickly (~4-tick half-life) so it's texture, not regime

// Dividends inject cash into the market from OUTSIDE the trading system (the
// company paying shareholders), so the market isn't a closed, zero-sum cash pool.
// Dividends are paid QUARTERLY (aligned to the earnings cadence), like real companies.

interface PendingUserOrder {
  side: Side;
  size: number;
  limitPrice?: number;
  stopPrice?: number; // present => a stop order (rests dormant until price crosses it)
}

export class SimulationEngine {
  readonly book: OrderBook;
  readonly priceRing = new RingBuffer(HISTORY_CAP, STARTING_PRICE);
  readonly buyVolRing = new RingBuffer(HISTORY_CAP, 0);
  readonly sellVolRing = new RingBuffer(HISTORY_CAP, 0);
  readonly sentimentRing = new RingBuffer(HISTORY_CAP, 0);
  trades: Trade[] = [];
  tick = 0;

  lastUserFill: { side: Side; size: number; avgPrice: number; priceBefore: number } | null = null;
  lastOrderNote: string | null = null; // human-readable outcome of the user's last order (capped / no liquidity / resting)
  userOrders: UserOrderRecord[] = [];
  private nextUserOrderId = 1;
  agents: Agent[] = [];
  pendingUserOrders: PendingUserOrder[] = [];

  // The user is a real account: sells are capped to shares held (no naked
  // shorting); buys are limited only by available liquidity/float.
  user: AgentAccount = {
    startingCapital: USER_STARTING_CASH,
    cash: USER_STARTING_CASH,
    shares: 0,
    avgCost: 0,
    realizedPnl: 0,
    tradeCount: 0,
  };

  // Sentiment is TWO components so news creates a lasting regime while reflex/noise
  // only add short-lived texture (and so the fear asymmetry can't integrate into a
  // long-run bias). Exposed `sentiment` = soft-clamped sum of the two.
  sentiment = 0;
  newsMood = 0; // slow, persistent regime set by news — the LASTING directional effect
  reflexMood = 0; // fast, mean-reverting reaction to price action + random wobble
  // Persistence of the NEWS regime = pure leak toward neutral, set by a HALF-LIFE
  // (ticks) so the knob is stable across its whole range: decay = 0.5^(1/H). Default 20.
  sentimentDecay = Math.pow(0.5, 1 / 20); // ≈ 0.966 (~20-tick half-life)
  sentimentReflexivity = 1.2; // loop gain: how strongly the recent trend feeds the FAST mood (lower = regime shows through)
  fundamentalValue = STARTING_PRICE; // the "true" value; eases toward the target (post-news drift)
  // Fair value is derived from earnings: target = EPS × multiple. EPS starts so the
  // target equals the starting price; news and earnings reports move EPS, not the
  // target directly (so fair value is computed, not hand-nudged).
  valuationMultiple = VALUATION_MULTIPLE;
  eps = STARTING_PRICE / VALUATION_MULTIPLE; // earnings per share (per quarter)
  consensusEps = STARTING_PRICE / VALUATION_MULTIPLE; // the market's EXPECTED EPS ("priced-in"); surprises are measured vs this
  /** Fair value the price diffuses toward = earnings capitalized at the multiple. */
  get fundamentalTarget(): number {
    return this.eps * this.valuationMultiple;
  }
  private newsClusterTicks = 0; // ticks remaining in the current news cluster
  private newsRegime = 0; // slow continuous bull/bear tide in ~[-1,1] (persistent, not binary)
  // Tuned low so news (via earnings expectations) stays within reach of the long-only
  // agent pool in BOTH directions (they can't short to chase a crashed fair).
  fundamentalImpact = 0.003; // tiny: news barely moves EPS (earnings reports are the real fair-value driver)
  events: NewsEvent[] = [];
  autoNews = false;
  private nextEventId = 1;

  // Dividends: a realistic ANNUAL yield, paid QUARTERLY (every EARNINGS_PERIOD ticks)
  // as yield/100 × price ÷ 4 per share — organic cash entering from outside the market.
  // A realistic yield is ~2%/yr, but the sim runs many "years" (1 yr = 4 quarters =
  // 800 ticks) per minute at high speed, so cash accretes fast in wall-clock. Default
  // to a gentle 1% (still adjustable up to 6%); set to 0 for a closed cash loop.
  dividendYieldPct = 1;
  totalDividendsPaid = 0;

  // Transaction cost: the taker (aggressor) pays this fraction of notional on every
  // fill. It leaves the participant system entirely (goes to the broker/exchange).
  feeBps = 5;
  totalFeesPaid = 0;

  // Options market (opt-in). The dealer account is short exactly the public's net long
  // option position and hedges its delta in the stock; it's a real participant (counts
  // in the float, earns dividends, trades the book).
  optionsEnabled = false;
  optionChain: OptionContract[] = [];
  userOptions = new Map<number, number>(); // contractId -> user net long qty (contracts)
  optionExpiryTick = 0;
  optionImpliedVol = 0.5; // annualized vol used to price the chain
  userOptionCashFlow = 0; // cumulative user cash from options (−premium paid, +premium/payout received)
  private nextContractId = 1;
  optionsDealer: AgentAccount = { startingCapital: 0, cash: 0, shares: 0, avgCost: 0, realizedPnl: 0, tradeCount: 0 };

  private nextAgentNum: Record<AgentType, number> = {
    noise: 0, marketMaker: 0, fomoHerd: 0, whale: 0, panicSeller: 0, trader: 0, dealer: 0,
  };
  private nextAgentId = 1;

  constructor() {
    this.book = new OrderBook(STARTING_PRICE);
  }

  get currentPrice(): number {
    return this.book.getLastTradePrice();
  }

  /**
   * The exposed sentiment broken into its contributing layers (which sum, through a
   * soft tanh, into `sentiment`) — for an explainable "why is the mood here" readout:
   * a slow regime tide, medium-lived news shocks, and fast price-action reflex.
   */
  get sentimentBreakdown(): { tide: number; news: number; reflex: number; total: number } {
    return {
      tide: NEWS_REGIME_LEVEL * this.newsRegime,
      news: this.newsMood,
      reflex: this.reflexMood,
      total: this.sentiment,
    };
  }

  get bestBid(): number | null {
    return this.book.getBestBid();
  }

  get bestAsk(): number | null {
    return this.book.getBestAsk();
  }

  // No backstop market maker: agents and the user collectively hold the entire
  // float, and liquidity is only what they post. Total shares are conserved
  // because every trade settles both sides, so this is constant between
  // add/remove of agents (which issue/retire their initial shares).
  get sharesOutstanding(): number {
    // Include the options dealer's hedge inventory: it buys those shares FROM other
    // participants, so counting it keeps the total conserved (it's a real holder).
    return this.agents.reduce((s, a) => s + a.shares, 0) + this.user.shares + this.optionsDealer.shares;
  }

  triggerEvent(sentiment: number, headline?: string): NewsEvent {
    const event: NewsEvent = {
      id: this.nextEventId++,
      tick: this.tick,
      headline: headline ?? randomHeadline(sentiment),
      sentiment,
    };
    this.events.push(event);
    if (this.events.length > 100) this.events = this.events.slice(-100);
    // News drives SENTIMENT (mood / hype / expectations), which the market prices as a
    // bounded premium over fair value — it does NOT move fundamentals. Fair value (EPS)
    // is moved only by EARNINGS reports, so news can't make fair value run away. A tiny
    // fundamental component keeps a nudge for manual events.
    this.newsMood += sentiment;
    this.eps = Math.max(0.01, this.eps * (1 + sentiment * this.fundamentalImpact));
    this.newsClusterTicks = NEWS_CLUSTER_TICKS; // news begets follow-up news
    return event;
  }

  addAgent(type: AgentType, capital: number, style: TraderStyle = 'balanced', allCash = false): Agent {
    this.nextAgentNum[type] += 1;
    const id = `agent-${this.nextAgentId++}`;
    // Traders carry their style in the name (e.g. "Value trader #2") so the different
    // personalities are distinguishable in the lists; everything else uses its type label.
    const label = type === 'trader' ? `${TRADER_STYLES[style].label} trader` : AGENT_TYPE_LABELS[type];
    const name = `${label} #${this.nextAgentNum[type]}`;
    const agent = createAgent(type, capital, this.currentPrice, id, name, style, allCash);
    // A new participant brings its own shares into the market (its share of the
    // float), so adding an agent grows the float and removing one retires it.
    this.agents.push(agent);
    return agent;
  }

  removeAgent(id: string): void {
    this.book.cancelOrdersByOwner(id); // pull its resting quotes
    this.agents = this.agents.filter((a) => a.id !== id);
  }

  updateAgentParams(id: string, patch: Record<string, unknown>): void {
    const agent = this.agents.find((a) => a.id === id);
    if (agent) Object.assign(agent, patch);
  }

  queueUserOrder(side: Side, size: number, limitPrice?: number, stopPrice?: number): void {
    this.pendingUserOrders.push({ side, size, limitPrice, stopPrice });
  }

  cancelUserOrders(): void {
    this.book.cancelOrdersByOwner('user');
  }

  // ---------------- Options market (opt-in) ----------------

  enableOptions(on: boolean): void {
    this.optionsEnabled = on;
    if (on && this.optionChain.length === 0) this.rollOptionChain();
  }

  private optionTau(): number {
    return Math.max(1e-4, (this.optionExpiryTick - this.tick) / TICKS_PER_YEAR);
  }

  /** Issue a fresh chain of calls+puts at strikes around spot, with a new expiry. */
  private rollOptionChain(): void {
    const spot = this.book.getLastTradePrice();
    this.optionChain = [];
    this.userOptions.clear();
    this.optionExpiryTick = this.tick + OPTION_LIFETIME;
    for (const off of OPTION_STRIKE_OFFSETS) {
      const strike = Math.max(1, Math.round(spot * (1 + off)));
      for (const type of ['call', 'put'] as OptionType[]) {
        this.optionChain.push({ id: this.nextContractId++, type, strike, expiryTick: this.optionExpiryTick });
      }
    }
  }

  /** The chain priced right now (Black-Scholes) with the user's position per contract. */
  getOptionChain(): { id: number; type: OptionType; strike: number; price: number; delta: number; gamma: number; userQty: number }[] {
    const spot = this.book.getLastTradePrice();
    const tau = this.optionTau();
    return this.optionChain.map((c) => {
      const g = blackScholes(c.type, spot, c.strike, tau, this.optionImpliedVol);
      return { id: c.id, type: c.type, strike: c.strike, price: g.price, delta: g.delta, gamma: g.gamma, userQty: this.userOptions.get(c.id) ?? 0 };
    });
  }

  /** User trades a contract: qty>0 buys to open, qty<0 sells to close (no naked short). */
  tradeOption(contractId: number, qty: number): void {
    if (!this.optionsEnabled || qty === 0) return;
    const c = this.optionChain.find((x) => x.id === contractId);
    if (!c) return;
    const spot = this.book.getLastTradePrice();
    const price = blackScholes(c.type, spot, c.strike, this.optionTau(), this.optionImpliedVol).price;
    const held = this.userOptions.get(contractId) ?? 0;
    let q = qty;
    if (q < 0) q = -Math.min(-q, held); // can't sell more than held
    if (q > 0) {
      const perContract = price * CONTRACT_MULTIPLIER;
      const affordable = perContract > 0 ? Math.floor(this.user.cash / perContract) : 0;
      q = Math.min(q, affordable);
      if (q <= 0) { this.lastOrderNote = 'Not enough cash for that option.'; return; }
    }
    if (q === 0) return;
    const premium = q * price * CONTRACT_MULTIPLIER;
    this.user.cash -= premium; // buy pays premium; sell (q<0) receives it
    this.optionsDealer.cash += premium; // the dealer writes the other side
    this.userOptionCashFlow -= premium;
    this.userOptions.set(contractId, held + q);
    this.lastOrderNote = `${q > 0 ? 'Bought' : 'Sold'} ${Math.abs(q)} ${c.strike} ${c.type} for $${Math.abs(premium).toFixed(0)}.`;
  }

  /** Mark-to-market value of the user's open option positions. */
  get userOptionValue(): number {
    const spot = this.book.getLastTradePrice();
    const tau = this.optionTau();
    let v = 0;
    for (const c of this.optionChain) {
      const qty = this.userOptions.get(c.id) ?? 0;
      if (qty !== 0) v += qty * blackScholes(c.type, spot, c.strike, tau, this.optionImpliedVol).price * CONTRACT_MULTIPLIER;
    }
    return v;
  }

  /** Total user option P&L = net cash put in + current mark value. */
  get optionPnl(): number {
    return this.userOptionCashFlow + this.userOptionValue;
  }

  /** Shares the dealer must hold to be delta-neutral = +(public option delta). */
  private optionHedgeTarget(): number {
    const spot = this.book.getLastTradePrice();
    const tau = this.optionTau();
    let delta = 0;
    for (const c of this.optionChain) {
      const qty = this.userOptions.get(c.id) ?? 0;
      if (qty !== 0) delta += qty * blackScholes(c.type, spot, c.strike, tau, this.optionImpliedVol).delta * CONTRACT_MULTIPLIER;
    }
    return delta;
  }

  /**
   * Execute any queued user orders immediately against the current book WITHOUT
   * advancing the simulation (no new tick, no agent activity). Used so a buy/sell
   * placed while the sim is paused still fills, instead of sitting in the queue.
   */
  flushUserOrders(): void {
    if (this.pendingUserOrders.length === 0) return;
    const registry = this.buildRegistry();
    const stepStartPrice = this.book.getLastTradePrice();
    const realizedAtStart = this.user.realizedPnl;
    const trades: Trade[] = [];
    for (const uo of this.pendingUserOrders) trades.push(...this.runUserOrder(uo, registry));
    this.pendingUserOrders = [];
    this.recordUserFills(trades, stepStartPrice, realizedAtStart);
    this.trades.push(...trades);
    if (this.trades.length > MAX_TRADES) this.trades = this.trades.slice(-MAX_TRADES);
  }

  /**
   * Cap a user order to a realistic size, submit it, settle the fills, and record a
   * human-readable outcome note. The user trades a CASH ACCOUNT: buys can't spend
   * past available cash (incl. the taker fee) and sells can't exceed shares held
   * (no user shorting). Returns the resulting trades.
   */
  private runUserOrder(uo: PendingUserOrder, registry: Map<string, AgentAccount>): Trade[] {
    const px = this.book.getLastTradePrice();
    const requested = uo.size;
    // Stop order: rest it dormant; it fires as a market order once price crosses (below).
    if (uo.stopPrice != null) {
      this.book.submitStopOrder(uo.side, requested, uo.stopPrice, 'user');
      this.lastOrderNote = `${uo.side === 'buy' ? 'Buy' : 'Sell'}-stop resting — fires if price ${uo.side === 'buy' ? 'rises to' : 'falls to'} $${uo.stopPrice.toFixed(2)}.`;
      return [];
    }
    let size = requested;
    if (uo.side === 'sell') {
      size = Math.min(size, this.user.shares); // no shorting for the user
      if (size < MIN_ORDER) {
        this.lastOrderNote = this.user.shares < MIN_ORDER ? 'You hold no shares to sell.' : null;
        return [];
      }
    } else {
      // Cap to what cash can afford at the marginal price, including the taker fee.
      const ref = uo.limitPrice ?? this.book.getBestAsk() ?? px; // best ask ≈ what a market buy pays
      const perShare = ref * (1 + this.feeBps / 10000);
      const affordable = perShare > 0 ? this.user.cash / perShare : 0;
      size = Math.min(size, Math.max(0, affordable));
      if (size < MIN_ORDER) {
        this.lastOrderNote = 'Not enough cash to buy at the current price.';
        return [];
      }
    }

    const capped = size < requested - 1e-9; // order was trimmed by cash (buy) / holdings (sell)
    const trades = uo.limitPrice != null
      ? this.book.submitLimitOrder(uo.side, size, uo.limitPrice, 'user', this.tick)
      : this.book.submitMarketOrder(uo.side, size, 'user', this.tick);
    for (const t of trades) this.settle(t, registry);

    const filled = trades.reduce((s, t) => s + t.size, 0);
    const capReason = uo.side === 'buy' ? 'your cash' : 'the shares you hold';
    if (uo.limitPrice != null) {
      // Limit orders rest; the shortfall vs `size` is just the unfilled resting part.
      this.lastOrderNote = filled <= 1e-9
        ? `Limit order resting in the book${capped ? ` (trimmed to ${size.toFixed(0)} sh by ${capReason})` : ''}.`
        : filled < size - 1e-9
          ? `Filled ${filled.toFixed(0)} sh; the rest is resting in the book.`
          : capped ? `Filled ${filled.toFixed(0)} sh (limited by ${capReason}).` : null;
    } else if (filled <= 1e-9) {
      this.lastOrderNote = `No ${uo.side === 'buy' ? 'ask' : 'bid'}-side liquidity — nothing to trade against.`;
    } else if (filled < size - 1e-9) {
      this.lastOrderNote = `Filled ${filled.toFixed(0)} of ${size.toFixed(0)} sh — ran out of liquidity.`;
    } else if (capped) {
      this.lastOrderNote = `Filled ${filled.toFixed(0)} sh (limited by ${capReason}).`;
    } else {
      this.lastOrderNote = null;
    }
    return trades;
  }

  /** Record the user's fills from a batch of trades into the order history + last-fill readout. */
  private recordUserFills(trades: Trade[], stepStartPrice: number, realizedAtStart: number): void {
    let buyShares = 0, buyNotional = 0, sellShares = 0, sellNotional = 0;
    for (const t of trades) {
      if (t.buyerId === 'user') { buyShares += t.size; buyNotional += t.price * t.size; }
      if (t.sellerId === 'user') { sellShares += t.size; sellNotional += t.price * t.size; }
    }
    if (buyShares > 0) {
      const avgPrice = buyNotional / buyShares;
      this.userOrders.push({ id: this.nextUserOrderId++, tick: this.tick, side: 'buy', shares: buyShares, avgPrice, gain: 0 });
      this.lastUserFill = { side: 'buy', size: buyShares, avgPrice, priceBefore: stepStartPrice };
    }
    if (sellShares > 0) {
      const avgPrice = sellNotional / sellShares;
      const gain = this.user.realizedPnl - realizedAtStart; // realized delta comes only from sells
      this.userOrders.push({ id: this.nextUserOrderId++, tick: this.tick, side: 'sell', shares: sellShares, avgPrice, gain });
      this.lastUserFill = { side: 'sell', size: sellShares, avgPrice, priceBefore: stepStartPrice };
    }
    if (this.userOrders.length > 200) this.userOrders = this.userOrders.slice(-200);
  }

  /** Map every ownerId to its account so both sides of a trade can be settled. */
  private buildRegistry(): Map<string, AgentAccount> {
    const reg = new Map<string, AgentAccount>();
    reg.set('user', this.user);
    reg.set('optionsDealer', this.optionsDealer);
    for (const a of this.agents) reg.set(a.id, a);
    return reg;
  }

  private settle(trade: Trade, reg: Map<string, AgentAccount>): void {
    const buyer = reg.get(trade.buyerId);
    const seller = reg.get(trade.sellerId);
    if (buyer) applyTrade(buyer, 'buy', trade.price, trade.size);
    if (seller) applyTrade(seller, 'sell', trade.price, trade.size);

    // The taker (whoever crossed the spread) pays a fee to the broker/exchange.
    // This cash leaves the participant system — it is NOT paid to anyone here.
    if (this.feeBps > 0) {
      const taker = reg.get(trade.side === 'buy' ? trade.buyerId : trade.sellerId);
      if (taker) {
        const fee = trade.price * trade.size * (this.feeBps / 10000);
        taker.cash -= fee;
        this.totalFeesPaid += fee;
      }
    }
  }

  step(): Trade[] {
    this.tick += 1;

    // Pay dividends to every holder — fresh cash entering from outside the trading
    // system. Realistically the stock drops by the dividend on the ex-div date
    // (cash left the company), so the fundamental falls by the same amount; this
    // keeps dividends from being a permanent upward price inflation.
    if (this.dividendYieldPct > 0 && this.tick % EARNINGS_PERIOD === 0) {
      const perShare = (this.dividendYieldPct / 100) * this.book.getLastTradePrice() / 4; // one quarter's worth
      if (perShare > 1e-4) {
        // Dividends are paid FROM earnings (external income), so they distribute cash
        // without reducing future earnings power — fair value (= EPS × multiple) is
        // unchanged. Value traders keep price anchored to fair, so this doesn't inflate
        // the price; it just adds shareholder income. A short (negative shares) OWES it.
        for (const a of this.agents) a.cash += a.shares * perShare;
        this.user.cash += this.user.shares * perShare;
        this.optionsDealer.cash += this.optionsDealer.shares * perShare; // dealer holds hedge inventory
        this.totalDividendsPaid += this.sharesOutstanding * perShare;
      }
    }

    // The market's expected EPS drifts toward the anticipated next report, so growth
    // gets "priced in" ahead of time — an in-line result is then a non-event.
    this.consensusEps += (this.eps * (1 + EARNINGS_GROWTH) - this.consensusEps) * CONSENSUS_EASE;

    // Quarterly earnings report. What moves the mood is the SURPRISE vs expectations
    // (beat/miss relative to consensus), not the raw number — so a big beat that the
    // market already priced in barely moves it ("buy the rumor, sell the news").
    if (this.tick % EARNINGS_PERIOD === 0) {
      const innovation = (Math.random() * 2 - 1) * EARNINGS_SURPRISE;
      const newEps = Math.max(0.01, this.eps * (1 + EARNINGS_GROWTH + innovation));
      const surprise = this.consensusEps > 0 ? (newEps - this.consensusEps) / this.consensusEps : 0; // vs expectations
      this.eps = newEps;
      this.consensusEps = newEps; // expectations reset to the freshly reported number
      const mood = surprise * 60; // beat vs estimates → bullish, miss → bearish
      this.newsMood += mood;
      this.events.push({
        id: this.nextEventId++,
        tick: this.tick,
        headline: surprise >= 0 ? `Earnings beat estimates (+${(surprise * 100).toFixed(1)}%)` : `Earnings miss estimates (${(surprise * 100).toFixed(1)}%)`,
        sentiment: mood,
      });
      if (this.events.length > 100) this.events = this.events.slice(-100);
      this.newsClusterTicks = NEWS_CLUSTER_TICKS;
    }

    // Option expiry: cash-settle every open contract at intrinsic value (the holder is
    // paid by the dealer), then roll a fresh chain around the current price.
    if (this.optionsEnabled && this.tick >= this.optionExpiryTick) {
      const spot = this.book.getLastTradePrice();
      for (const c of this.optionChain) {
        const qty = this.userOptions.get(c.id) ?? 0;
        if (qty !== 0) {
          const payout = qty * intrinsicValue(c.type, spot, c.strike) * CONTRACT_MULTIPLIER;
          this.user.cash += payout;
          this.optionsDealer.cash -= payout;
          this.userOptionCashFlow += payout;
        }
      }
      this.rollOptionChain();
    }

    // The slow mood tide wanders continuously and lingers on one side for a long time
    // (a persistent AR(1)), giving lasting-but-nuanced bull/bear regimes rather than a
    // binary flip or fast noise. It also gently tilts news direction (below).
    this.newsRegime = Math.max(-1.2, Math.min(1.2, this.newsRegime * NEWS_REGIME_DECAY + (Math.random() * 2 - 1) * NEWS_REGIME_STEP));

    // Auto-news arrives in lumpy bursts: a low base rate, boosted while a cluster
    // is active. Direction is tilted by the current regime, so good times keep
    // bringing good news (and vice versa) rather than flipping randomly.
    if (this.autoNews) {
      const prob = AUTO_NEWS_PROB * (this.newsClusterTicks > 0 ? NEWS_CLUSTER_BOOST : 1);
      if (Math.random() < prob) {
        const magnitude = 1 + Math.random() * 1.5; // 1.0 .. 2.5
        const goodProb = 0.5 + NEWS_REGIME_BIAS * this.newsRegime;
        this.triggerEvent(Math.random() < goodProb ? magnitude : -magnitude);
      }
    }
    if (this.newsClusterTicks > 0) this.newsClusterTicks--;

    // The fundamental eases toward the news-set target (information diffusing in).
    this.fundamentalValue += (this.fundamentalTarget - this.fundamentalValue) * FUNDAMENTAL_DIFFUSION;

    // Evolve the mood in TWO parts so news lasts, the loop can't run away, and the
    // fear asymmetry can't bias the long run:
    //  - newsMood: the persistent regime. News jumps it; it then leaks slowly toward
    //    neutral at the (adjustable) half-life. This is the LASTING market effect.
    //  - reflexMood: fast, mean-reverting texture from recent price action + a random
    //    wobble, with the fear asymmetry. It decays quickly (~4-tick half-life), so it
    //    adds momentum flavor without becoming a persistent (or biased) drift.
    // A SELF-LIMITING headroom factor (1 - x²) kills the reflex/noise as the combined
    // mood nears the cap (buyer/seller exhaustion), so the extreme is an unstable
    // repeller; the exposed `sentiment` is a SOFT tanh sum (a breathing band, no wall).
    const x = this.sentiment / SENTIMENT_CAP; // combined mood last tick, normalized to [-1,1]
    const headroom = Math.max(0, 1 - x * x);
    if (this.priceRing.size > SENTIMENT_REFLEX_WINDOW) {
      const w = this.priceRing.window(SENTIMENT_REFLEX_WINDOW + 1).data;
      const p0 = w[0];
      const ret = p0 > 0 ? (w[w.length - 1] - p0) / p0 : 0;
      let reflex = this.sentimentReflexivity * ret;
      if (ret < 0) reflex *= SENTIMENT_FEAR_ASYMMETRY; // fear moves the mood more than greed
      this.reflexMood += reflex * headroom;
    }
    this.reflexMood += (Math.random() * 2 - 1) * SENTIMENT_MOOD_NOISE * (1 + Math.abs(this.sentiment)) * headroom;
    this.newsMood *= this.sentimentDecay; // slow leak — the lasting regime, half-life from the slider
    this.reflexMood *= REFLEX_MOOD_DECAY; // fast leak — texture only
    // Exposed mood = a slow REGIME baseline (the persistent bull/bear tide, so mood
    // stays one side for a whole period) + medium news shocks + fast reflex texture,
    // through a soft tanh ceiling (never a flat wall).
    const regimeBaseline = NEWS_REGIME_LEVEL * this.newsRegime;
    this.sentiment = SENTIMENT_CAP * Math.tanh((regimeBaseline + this.newsMood + this.reflexMood) / SENTIMENT_CAP);
    if (Math.abs(this.sentiment) < 0.001) this.sentiment = 0;

    const priceWindow = this.priceRing.window(STRATEGY_WINDOW).data;
    const market: MarketState = { priceHistory: priceWindow, tick: this.tick, sentiment: this.sentiment, fundamentalValue: this.fundamentalValue };
    const registry = this.buildRegistry();
    const tickTrades: Trade[] = [];

    const stepStartPrice = this.book.getLastTradePrice();
    const userRealizedAtStart = this.user.realizedPnl;

    // Process agents in random order so none systematically trades first.
    const order = [...this.agents];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    for (const agent of order) {
      const px = this.book.getLastTradePrice();

      // Margin call: an underwater short is forced to buy back (cover), which can
      // trigger further covering as the price rises — a short squeeze.
      if (agent.shares < -MIN_ORDER) {
        const exposure = -agent.shares * px;
        const equity = agent.cash + agent.shares * px;
        if (equity < MAINT_MARGIN * exposure) {
          this.book.cancelOrdersByOwner(agent.id);
          const cover = -agent.shares; // full buy-in (liquidate the short, not half)
          for (const t of this.book.submitMarketOrder('buy', cover, agent.id, this.tick)) {
            this.settle(t, registry);
            tickTrades.push(t);
          }
          continue; // busy covering this tick
        }
      }

      const intents = decideOrder(agent, market);
      if (intents.length === 0) continue; // inactive makers keep their resting quotes

      this.book.cancelOrdersByOwner(agent.id); // cancel-and-replace
      let availCash = agent.cash;
      let availShares = agent.shares;
      const maxShort = CAN_SHORT.has(agent.type) && px > 0 ? (SHORT_COLLATERAL * agent.cash) / px : 0;

      for (const intent of intents) {
        let size = intent.size;
        if (intent.side === 'buy') {
          const refPrice = intent.limitPrice ?? px * 1.05;
          size = Math.min(size, refPrice > 0 ? availCash / refPrice : 0);
        } else {
          // Sell what's held, plus a collateral-limited short for bearish types.
          size = Math.min(size, Math.max(0, availShares + maxShort));
        }
        if (size < MIN_ORDER) continue;

        const trades = intent.limitPrice != null
          ? this.book.submitLimitOrder(intent.side, size, intent.limitPrice, agent.id, this.tick)
          : this.book.submitMarketOrder(intent.side, size, agent.id, this.tick);
        for (const t of trades) {
          this.settle(t, registry);
          tickTrades.push(t);
        }

        // Commit the resource so a second intent (e.g. a maker's other quote) can't reuse it.
        if (intent.side === 'buy') availCash -= size * (intent.limitPrice ?? px);
        else availShares -= size;
      }
    }

    // Options dealer delta-hedge: rebalance its stock inventory to offset the public's
    // net option delta. As price moves, that target moves (gamma), so the dealer buys
    // rallies / sells dips when short gamma — a gamma squeeze that EMERGES from real
    // open interest and hits the same book as everyone else.
    if (this.optionsEnabled) {
      const delta = this.optionHedgeTarget() - this.optionsDealer.shares;
      if (Math.abs(delta) >= MIN_ORDER) {
        for (const t of this.book.submitMarketOrder(delta > 0 ? 'buy' : 'sell', Math.abs(delta), 'optionsDealer', this.tick)) {
          this.settle(t, registry);
          tickTrades.push(t);
        }
      }
    }

    // User orders (market or limit), processed against the current book.
    for (const uo of this.pendingUserOrders) {
      for (const t of this.runUserOrder(uo, registry)) tickTrades.push(t);
    }
    this.pendingUserOrders = [];

    // Fire any resting stops the tick's price move has now triggered. Each fired stop
    // is a market order that can move price further and trip MORE stops — a genuine
    // book-level stop cascade. Loop until no more trigger (guarded against runaway).
    for (let guard = 0; guard < 100; guard++) {
      const triggered = this.book.popTriggeredStops();
      if (triggered.length === 0) break;
      for (const s of triggered) {
        const acct = registry.get(s.ownerId);
        let size = s.size;
        if (acct) {
          // Cap so a fired stop can't oversell holdings / overspend cash (no shorting via stops).
          if (s.side === 'sell') size = Math.min(size, Math.max(0, acct.shares));
          else { const p = this.book.getLastTradePrice(); size = Math.min(size, p > 0 ? acct.cash / p : 0); }
        }
        if (size < MIN_ORDER) continue;
        for (const t of this.book.submitMarketOrder(s.side, size, s.ownerId, this.tick)) {
          this.settle(t, registry);
          tickTrades.push(t);
        }
      }
    }

    // Aggregate this tick's volume (for the volume bars) and record the user's fills.
    let buyVol = 0;
    let sellVol = 0;
    for (const t of tickTrades) {
      if (t.side === 'buy') buyVol += t.size;
      else sellVol += t.size;
    }
    this.recordUserFills(tickTrades, stepStartPrice, userRealizedAtStart);

    this.trades.push(...tickTrades);
    if (this.trades.length > MAX_TRADES) this.trades = this.trades.slice(-MAX_TRADES);

    this.priceRing.push(this.book.getLastTradePrice());
    this.buyVolRing.push(buyVol);
    this.sellVolRing.push(sellVol);
    this.sentimentRing.push(this.sentiment);

    return tickTrades;
  }
}
