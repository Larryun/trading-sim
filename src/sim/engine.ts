import { OrderBook } from './orderBook';
import { AGENT_TYPE_LABELS, TRADER_STYLES, applyTrade, createAgent, decideOrder, speculatorSignal } from './agents';
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

// Per-participant PnL sparkline: a small fixed-capacity ring, so memory stays flat
// (≈ SPARK_CAP samples per owner) no matter how long it runs. The sampling CADENCE is set
// by the UI to match the chart interval (see `sparkInterval`), so one sparkline point
// equals one candle — the sparkline then spans the same kind of window as the charts
// instead of a fixed 5-tick grid the display may never resolve.
const SPARK_CAP = 48;

// News arrives in lumpy bursts, not a constant drizzle: a low base rate, but an
// event raises the odds of follow-ups for a while (clustering).
const AUTO_NEWS_PROB = 0.008;
const NEWS_CLUSTER_TICKS = 30; // window over which follow-up news is more likely
const NEWS_CLUSTER_BOOST = 5; // how much more likely follow-ups are inside a cluster
// The market mood drifts on a slow, PERSISTENT tide (a continuous bull/bear bias that
// wanders slowly and lingers on one side for a long time) — long smooth regimes with
// nuanced values, not a binary happy/sad square wave and not fast noise.
const MOOD_TIDE_DECAY = 0.9995; // very slow mean reversion → long one-sided excursions (regimes last)
const MOOD_TIDE_STEP = 0.02; // random-walk step of the tide (how far it swings)
const NEWS_DIRECTION_BIAS = 0.45; // how strongly the tide tilts news direction (0..0.5)
const MOOD_TIDE_LEVEL = 1.5; // how much the tide biases sentiment (moderate → lasting but not binary)
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
// Shares per contract. Real US options are ×100, but this market's float is a toy
// ~25k shares (~1000× smaller than a real one), so a ×100 contract would let a single
// bet control a tenth of the whole float. Scaled to ×10 to keep the option market
// PROPORTIONATE to the underlying, the way listed options are in reality.
const CONTRACT_MULTIPLIER = 10;
// Real chains list SEVERAL expiries at once (weeklies out to LEAPS), and each behaves
// differently: near-dated options are cheap, high-gamma lottery tickets that decay fast;
// far-dated ones cost more, decay slowly and are mostly vega. Tenors in ticks
// (200 ticks = one "quarter"), so ~a month / a quarter / half a year.
const OPTION_TENORS = [70, 200, 500];
const OPTION_STRIKE_OFFSETS = [-0.1, -0.05, 0, 0.05, 0.1]; // strikes as fractions around spot
const OPTION_HEDGE_RATE = 0.2; // fraction of the delta gap the dealer hedges per tick (gradual)
const OPTION_DEALER_CAPITAL = 2000000; // the dealer desk's balance sheet — its hedging is bounded by this
const OPTION_IV_PREMIUM = 1.25; // implied vol runs a bit above realized (the variance risk premium)
const OPTION_IV_MIN = 0.15; // floor / cap on implied vol (annualized)
const OPTION_IV_MAX = 1.2;
const OPTION_DEALER_POS_LIMIT = 0.08; // dealer hedge inventory capped to this × shares outstanding
// Structural cap on the whole option market: total open-interest NOTIONAL stays under
// this fraction of the float. Dealers only write what they can hedge, so an option
// market can't grow to dwarf the stock it's written on.
const OPTION_MAX_OI_FRACTION = 0.15;

// Short selling: bearish "view" traders can borrow & sell (shares go negative),
// collateralized by their cash. If a rising price wipes out that collateral they
// get margin-called and forced to buy back — the fuel for short squeezes.
// Market makers ARE included: a maker targeting FLAT inventory must be able to go short to
// keep an offer up, exactly as real makers do.
const CAN_SHORT = new Set<AgentType>(['trader', 'dealer', 'marketMaker']);
const SHORT_COLLATERAL = 1; // short exposure may reach this * EQUITY (not cash — see below)
const MAINT_MARGIN = 0.25; // margin call when equity falls below this * short exposure

/**
 * How much MORE the account may sell short, in shares.
 *
 * Sized against EQUITY, never against cash. A short sale PAYS you the proceeds, so cash
 * jumps every time you short; sizing the next short off that inflated cash lets each short
 * finance the next one and short capacity compounds without limit (1k -> 2.1k -> 3.2k -> ...).
 * Equity doesn't move when you short (cash up, shares negative by the same value), so it is
 * the only stable base. Real brokers work this way too: short-sale proceeds are RESTRICTED
 * collateral for the buy-back, not spendable buying power.
 */
function shortCapacity(account: { cash: number; shares: number }, price: number): number {
  if (price <= 0) return 0;
  const equity = account.cash + account.shares * price;
  const exposure = Math.max(0, -account.shares) * price;
  return Math.max(0, (SHORT_COLLATERAL * equity - exposure) / price);
}

/** Cash actually spendable on a BUY: short proceeds sitting in cash are collateral, not funds. */
function freeBuyingPower(account: { cash: number; shares: number }, price: number): number {
  const equity = account.cash + account.shares * price;
  return Math.max(0, Math.min(account.cash, equity));
}
// Sentiment realism: beyond discrete news jumps, the "mood" also reacts to recent
// price action (reflexivity), wobbles randomly, spikes harder on the way down
// (fear), and gets jumpier when already excited (volatility clustering).
const SENTIMENT_REFLEX_WINDOW = 12; // ticks of price action the mood reads (longer = smoother)
const SENTIMENT_MOOD_NOISE = 0.003; // small random wobble (kept low so the regime shows through, not noise)
const SENTIMENT_FEAR_ASYMMETRY = 1.6; // downside moves move the FAST mood more than up
const SENTIMENT_CAP = 3; // bound so the reflexive loop can't run away
const REFLEX_MOOD_DECAY = 0.85; // fast component leaks quickly (~4-tick half-life) so it's texture, not regime

// DYNAMIC RISK APPETITE. No real desk trades a constant size: risk is cut as losses
// accumulate and restored as equity recovers. So every agent's order size is scaled by a
// live risk factor derived from its own drawdown from peak equity — a static "size" slider
// is a knob for its FULL-risk behaviour, not a constant. This is pro-cyclical on purpose:
// collective de-risking into a selloff is exactly how real drawdowns feed on themselves.
const RISK_DD_SENSITIVITY = 1.5; // how sharply risk is cut per unit of drawdown
const RISK_FLOOR = 0.3; // never de-risk below this fraction of full size

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
  // ownerId -> bounded ring of (equity − startingCapital) samples, for PnL sparklines.
  private pnlSpark = new Map<string, RingBuffer>();
  // Ticks between sparkline samples. The UI keeps this equal to the chart interval so a
  // sparkline point == a candle. (Changing it mid-run leaves the existing samples at the
  // old spacing until the ring rolls over — harmless for a trend line, and far better than
  // blanking every sparkline on every interval change.)
  sparkInterval = 5;
  // ownerId -> peak equity, for the dynamic risk-appetite (drawdown de-risking) factor.
  private peakEquity = new Map<string, number>();
  // ownerId -> last computed risk appetite, so the UI can READ it without mutating state.
  private riskScaleById = new Map<string, number>();

  // The user is a real account. Buys are cash-limited. Sells are capped to shares
  // held UNLESS shorting is enabled, in which case a cash-collateralized short is
  // allowed (and can be margin-called / squeezed, exactly like the agents).
  user: AgentAccount = {
    startingCapital: USER_STARTING_CASH,
    cash: USER_STARTING_CASH,
    shares: 0,
    avgCost: 0,
    realizedPnl: 0,
    tradeCount: 0,
  };
  userCanShort = false; // opt-in (a "margin account"): lets the user sell short

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
  private moodTide = 0; // slow continuous bull/bear tide in ~[-1,1] (persistent, not binary)
  // Tuned low so news (via earnings expectations) stays within reach of the long-only
  // agent pool in BOTH directions (they can't short to chase a crashed fair).
  fundamentalImpact = 0.003; // tiny: news barely moves EPS (earnings reports are the real fair-value driver)
  events: NewsEvent[] = [];
  // On by default: a real market always has information arriving. Turning it OFF is a
  // deliberate "quiet market" scenario, where only earnings reports and the slow mood
  // tide move sentiment (both of which run regardless of this flag).
  autoNews = true;
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
  // ownerId ('user' or an agent id) -> (contractId -> net long qty). The dealer is short
  // the sum of ALL of these, so agent (speculator) open interest counts too.
  optionPositions = new Map<string, Map<number, number>>();
  // Implied vol is DERIVED from recent realized volatility (plus a variance risk
  // premium), refreshed each tick — not a fixed guess. A hardcoded IV far above
  // realized vol would make every option wildly overpriced, bleeding buyers dry and
  // handing the dealer an ever-growing cash pile (and thus unlimited hedging power).
  optionImpliedVol = 0.2; // annualized vol used to price the chain
  /**
   * The rate the chain is priced off — i.e. the market's recent DRIFT, annualized.
   * Real options are priced off the forward, not spot, so any expected drift is already
   * charged for. Without this, a market that trends persistently for longer than an
   * option's life hands directional buyers a free edge (and bleeds the dealer dry).
   */
  optionRate = 0;
  userOptionCashFlow = 0; // cumulative user cash from options (−premium paid, +premium/payout received)
  private nextContractId = 1;
  optionsDealer: AgentAccount = { startingCapital: 0, cash: 0, shares: 0, avgCost: 0, realizedPnl: 0, tradeCount: 0 };

  private nextAgentNum: Record<AgentType, number> = {
    noise: 0, marketMaker: 0, fomoHerd: 0, whale: 0, panicSeller: 0, trader: 0, dealer: 0, speculator: 0, indexFund: 0,
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
      tide: MOOD_TIDE_LEVEL * this.moodTide,
      news: this.newsMood,
      reflex: this.reflexMood,
      total: this.sentiment,
    };
  }

  /** The user's margin/short status, for the positions readout. */
  get userMargin(): { canShort: boolean; shortShares: number; exposure: number; equity: number; maintenanceReq: number; marginCall: boolean; buyingPower: number; shortCapacity: number } {
    const p = this.currentPrice;
    const shortShares = Math.max(0, -this.user.shares);
    const exposure = shortShares * p;
    const equity = this.user.cash + this.user.shares * p;
    return {
      canShort: this.userCanShort,
      shortShares,
      exposure,
      equity,
      maintenanceReq: MAINT_MARGIN * exposure,
      marginCall: shortShares > 0 && equity < MAINT_MARGIN * exposure,
      buyingPower: freeBuyingPower(this.user, p),
      shortCapacity: this.userCanShort ? shortCapacity(this.user, p) : 0,
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
    // Buy out any open option position at its mark, then drop it: leaving it behind would
    // keep phantom contracts driving the dealer's (real) hedging and consuming the
    // open-interest limit, and it would never settle since the account is gone.
    const pos = this.optionPositions.get(id);
    const acct = this.agents.find((a) => a.id === id);
    if (pos && acct) {
      const spot = this.book.getLastTradePrice();
      for (const [cid, qty] of pos) {
        const c = this.optionChain.find((x) => x.id === cid);
        if (!c || qty === 0) continue;
        const mark = this.quote(c, spot).price * CONTRACT_MULTIPLIER;
        acct.cash += qty * mark;
        this.optionsDealer.cash -= qty * mark;
      }
    }
    this.optionPositions.delete(id);
    this.agents = this.agents.filter((a) => a.id !== id);
    this.pnlSpark.delete(id); // free its sparkline ring
    this.peakEquity.delete(id);
    this.riskScaleById.delete(id);
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
    // Turning the market OFF must close it out: expiry and dealer hedging both stop, so
    // leaving positions open would freeze the dealer's inventory in the float and settle
    // long-stale contracts at whatever the price happens to be when it's switched on again.
    if (!on && this.optionsEnabled) this.closeOutOptions();
    this.optionsEnabled = on;
    if (on && this.optionChain.length === 0) this.rollOptionChain();
    // A dealer desk trades against a real balance sheet; without one its hedging is
    // unconstrained and it can push the price around without limit.
    if (on && this.optionsDealer.startingCapital === 0) {
      this.optionsDealer.startingCapital = OPTION_DEALER_CAPITAL;
      this.optionsDealer.cash = OPTION_DEALER_CAPITAL;
    }
  }

  /**
   * Settle every open option at its current mark against the dealer, flatten the
   * dealer's hedge inventory back into the book, and clear the chain.
   */
  private closeOutOptions(): void {
    const spot = this.book.getLastTradePrice();
    for (const [ownerId, pos] of this.optionPositions) {
      const acct = this.accountOf(ownerId);
      for (const [cid, qty] of pos) {
        if (qty === 0 || !acct) continue;
        const c = this.optionChain.find((x) => x.id === cid);
        if (!c) continue;
        const mark = this.quote(c, spot).price * CONTRACT_MULTIPLIER;
        acct.cash += qty * mark; // holder is bought out at the mark
        this.optionsDealer.cash -= qty * mark;
        if (ownerId === 'user') this.userOptionCashFlow += qty * mark;
      }
    }
    this.optionPositions.clear();
    this.optionChain = [];
    // Return the dealer's hedge inventory to the market so it isn't stranded in the float.
    if (Math.abs(this.optionsDealer.shares) >= MIN_ORDER) {
      const side: Side = this.optionsDealer.shares > 0 ? 'sell' : 'buy';
      const registry = this.buildRegistry();
      for (const t of this.book.submitMarketOrder(side, Math.abs(this.optionsDealer.shares), 'optionsDealer', this.tick)) {
        this.settle(t, registry);
      }
    }
  }

  /** Time to expiry in YEARS for a specific contract (each has its own expiry). */
  private tauOf(c: OptionContract): number {
    return Math.max(1e-4, (c.expiryTick - this.tick) / TICKS_PER_YEAR);
  }

  /** Price + greeks for one contract, at its own time to expiry. */
  private quote(c: OptionContract, spot = this.currentPrice) {
    return blackScholes(c.type, spot, c.strike, this.tauOf(c), this.optionImpliedVol, this.optionRate);
  }

  /** The soonest expiry still listed (for the "ticks to expiry" readout). */
  get nearestExpiryTick(): number {
    let best = Infinity;
    for (const c of this.optionChain) if (c.expiryTick < best) best = c.expiryTick;
    return Number.isFinite(best) ? best : this.tick;
  }

  /**
   * Realized volatility, annualized — the basis for implied vol. Measured from
   * MULTI-TICK (20-tick) returns over a window comparable to the option's life, not
   * from tick-to-tick returns: this price series trends (fundamental drift + momentum),
   * so 1-tick vol scaled by √t badly understates the dispersion actually realized over
   * an option's tenor — which would price every option far too cheap.
   */
  private realizedAnnualVol(): number {
    const STEP = 20;
    const w = this.priceRing.window(STEP * 16 + 1).data;
    if (w.length < STEP * 3) return OPTION_IV_MIN;
    const rets: number[] = [];
    for (let i = STEP; i < w.length; i += STEP) if (w[i - STEP] > 0) rets.push((w[i] - w[i - STEP]) / w[i - STEP]);
    if (rets.length < 3) return OPTION_IV_MIN;
    // RMS of returns, NOT the variance around their mean: Black-Scholes prices a
    // driftless walk, so if we ignored the drift a steadily trending market would look
    // "low vol" and its options would be given away — free money for directional buyers.
    // Using RMS charges for the total movement actually realized.
    const rms = Math.sqrt(rets.reduce((a, b) => a + b * b, 0) / rets.length);
    const annual = rms * Math.sqrt(TICKS_PER_YEAR / STEP) * OPTION_IV_PREMIUM;
    return Math.max(OPTION_IV_MIN, Math.min(OPTION_IV_MAX, annual));
  }

  /**
   * Recent drift, annualized — used as the pricing rate so the chain is priced off the
   * FORWARD. This market trends for longer than an option lives, so without charging
   * for the drift, buying in the trend direction would be a free (dealer-funded) edge.
   */
  private driftAnnual(): number {
    const w = this.priceRing.window(300).data;
    if (w.length < 30 || w[0] <= 0) return 0;
    const perTick = Math.log(w[w.length - 1] / w[0]) / (w.length - 1);
    const annual = perTick * TICKS_PER_YEAR;
    return Math.max(-1.5, Math.min(1.5, annual));
  }

  private accountOf(ownerId: string): AgentAccount | undefined {
    if (ownerId === 'user') return this.user;
    if (ownerId === 'optionsDealer') return this.optionsDealer;
    return this.agents.find((a) => a.id === ownerId);
  }

  private optionPos(ownerId: string): Map<number, number> {
    let m = this.optionPositions.get(ownerId);
    if (!m) { m = new Map(); this.optionPositions.set(ownerId, m); }
    return m;
  }

  /** Total public open interest (contracts) at a given contract, across all holders. */
  private openInterestOf(contractId: number): number {
    let s = 0;
    for (const [, pos] of this.optionPositions) s += Math.abs(pos.get(contractId) ?? 0);
    return s;
  }

  /** Open interest across the whole chain, in contracts. */
  totalOpenInterest(): number {
    let s = 0;
    for (const [, pos] of this.optionPositions) for (const [, q] of pos) s += Math.abs(q);
    return s;
  }

  /** Shares per option contract (scaled to this market's float). */
  get contractMultiplier(): number {
    return CONTRACT_MULTIPLIER;
  }

  /**
   * The option market's aggregate greeks, from the PUBLIC's side (all holders netted).
   * The dealer is short exactly these, which is why negative public gamma... — i.e. the
   * public being long gamma means the DEALER is short gamma and must chase price.
   *   delta — share-equivalents of exposure
   *   gamma — how many shares that delta changes per $1 move (the squeeze driver)
   *   vega  — $ P&L per 1 volatility POINT (1%)
   *   theta — $ P&L per TICK of time decay
   */
  get optionGreeks(): { delta: number; gamma: number; vega: number; theta: number; dealerDelta: number } {
    const spot = this.currentPrice;
    let delta = 0, gamma = 0, vega = 0, theta = 0;
    if (this.optionsEnabled) {
      const g = new Map<number, ReturnType<typeof blackScholes>>();
      for (const c of this.optionChain) g.set(c.id, this.quote(c, spot));
      for (const [, pos] of this.optionPositions) {
        for (const [cid, qty] of pos) {
          const k = g.get(cid);
          if (!k || qty === 0) continue;
          const n = qty * CONTRACT_MULTIPLIER;
          delta += n * k.delta;
          gamma += n * k.gamma;
          vega += (n * k.vega) / 100; // per 1 vol point
          theta += (n * k.theta) / TICKS_PER_YEAR; // per tick
        }
      }
    }
    // The dealer holds the opposite exposure, offset by the stock it has hedged with.
    return { delta, gamma, vega, theta, dealerDelta: this.optionsDealer.shares - delta };
  }

  /** List calls+puts at strikes around spot for ONE expiry. */
  private listExpiry(expiryTick: number): void {
    const spot = this.book.getLastTradePrice();
    for (const off of OPTION_STRIKE_OFFSETS) {
      const strike = Math.max(1, Math.round(spot * (1 + off)));
      for (const type of ['call', 'put'] as OptionType[]) {
        this.optionChain.push({ id: this.nextContractId++, type, strike, expiryTick });
      }
    }
  }

  /** Build the whole chain from scratch: every tenor, each with its own expiry. */
  private rollOptionChain(): void {
    this.optionChain = [];
    this.optionPositions.clear();
    for (const tenor of OPTION_TENORS) this.listExpiry(this.tick + tenor);
  }

  /**
   * Cash-settle only the contracts that have actually EXPIRED (each has its own expiry),
   * then list a replacement at the longest tenor so the chain always offers a range of
   * maturities — instead of wiping the whole board on one clock.
   */
  private settleExpiredContracts(): void {
    const due = this.optionChain.filter((c) => this.tick >= c.expiryTick);
    if (due.length === 0) return;
    const spot = this.book.getLastTradePrice();
    const dueIds = new Set(due.map((c) => c.id));
    for (const [ownerId, pos] of this.optionPositions) {
      const acct = this.accountOf(ownerId);
      for (const [cid, qty] of pos) {
        if (!dueIds.has(cid) || qty === 0) continue;
        const c = due.find((x) => x.id === cid)!;
        const payout = qty * intrinsicValue(c.type, spot, c.strike) * CONTRACT_MULTIPLIER;
        if (acct) {
          acct.cash += payout; // holder is paid intrinsic
          this.optionsDealer.cash -= payout; // the dealer wrote it
          if (ownerId === 'user') this.userOptionCashFlow += payout;
        }
        pos.delete(cid);
        // Speculators remember what they paid per contract; drop it with the contract,
        // otherwise a row lingers for every series that ever expired while held.
        const spec = this.agents.find((a) => a.id === ownerId);
        if (spec && spec.type === 'speculator') spec.entryPrice.delete(cid);
      }
    }
    this.optionChain = this.optionChain.filter((c) => !dueIds.has(c.id));
    // Replace each expired series with a newly-listed far-dated one.
    const tenors = new Set(due.map((c) => c.expiryTick));
    for (let i = 0; i < tenors.size; i++) this.listExpiry(this.tick + OPTION_TENORS[OPTION_TENORS.length - 1]);
  }

  /** The chain priced right now (Black-Scholes) with the user's position + total OI. */
  getOptionChain(): { id: number; type: OptionType; strike: number; expiryTick: number; ticksToExpiry: number; price: number; delta: number; gamma: number; theta: number; userQty: number; openInterest: number }[] {
    const spot = this.book.getLastTradePrice();
    const userPos = this.optionPositions.get('user');
    return this.optionChain.map((c) => {
      const g = this.quote(c, spot);
      return {
        id: c.id, type: c.type, strike: c.strike,
        expiryTick: c.expiryTick, ticksToExpiry: Math.max(0, c.expiryTick - this.tick),
        price: g.price, delta: g.delta, gamma: g.gamma, theta: g.theta / TICKS_PER_YEAR,
        userQty: userPos?.get(c.id) ?? 0, openInterest: this.openInterestOf(c.id),
      };
    });
  }

  /** Trade a contract for an owner: qty>0 buys to open, qty<0 sells to close (long-only). */
  tradeOption(contractId: number, qty: number, ownerId = 'user'): void {
    if (!this.optionsEnabled || qty === 0) return;
    const c = this.optionChain.find((x) => x.id === contractId);
    const acct = this.accountOf(ownerId);
    if (!c || !acct) return;
    const spot = this.book.getLastTradePrice();
    const price = this.quote(c, spot).price;
    const pos = this.optionPos(ownerId);
    const held = pos.get(contractId) ?? 0;
    let q = qty;
    if (q < 0) q = -Math.min(-q, held); // can't sell more than held (no naked short)
    if (q > 0) {
      const perContract = price * CONTRACT_MULTIPLIER;
      // Cash available after what resting stock orders already committed.
      const freeCash = ownerId === 'user' ? Math.max(0, acct.cash - this.book.restingBuyNotional('user')) : acct.cash;
      const affordable = perContract > 0 ? Math.floor(freeCash / perContract) : 0;
      q = Math.min(q, affordable);
      // The market-wide open-interest cap applies to EVERY buyer, not just the agents —
      // otherwise one click can write more contracts than the dealer can hedge.
      const oiRoom = Math.floor(Math.max(0, (OPTION_MAX_OI_FRACTION * this.sharesOutstanding) / CONTRACT_MULTIPLIER - this.totalOpenInterest()));
      const beforeCap = q;
      q = Math.min(q, oiRoom);
      if (q <= 0) {
        if (ownerId === 'user') {
          this.lastOrderNote = affordable <= 0 ? 'Not enough cash for that option.' : 'Open-interest limit reached — dealers can only write what they can hedge.';
        }
        return;
      }
      if (ownerId === 'user' && q < beforeCap) this.lastOrderNote = `Trimmed to ${q} contracts by the open-interest limit.`;
    }
    if (q === 0) return;
    const premium = q * price * CONTRACT_MULTIPLIER;
    acct.cash -= premium; // buy pays premium; sell (q<0) receives it
    this.optionsDealer.cash += premium; // the dealer writes the other side
    if (ownerId === 'user') this.userOptionCashFlow -= premium;
    const net = held + q;
    if (Math.abs(net) < 1e-9) pos.delete(contractId); // don't retain closed positions
    else pos.set(contractId, net);
    if (ownerId === 'user') this.lastOrderNote = `${q > 0 ? 'Bought' : 'Sold'} ${Math.abs(q)} ${c.strike} ${c.type} for $${Math.abs(premium).toFixed(0)}.`;
  }

  /** Mark-to-market value of the user's open option positions. */
  get userOptionValue(): number {
    const spot = this.book.getLastTradePrice();
    const pos = this.optionPositions.get('user');
    let v = 0;
    if (pos) for (const c of this.optionChain) {
      const qty = pos.get(c.id) ?? 0;
      if (qty !== 0) v += qty * this.quote(c, spot).price * CONTRACT_MULTIPLIER;
    }
    return v;
  }

  /** Total user option P&L = net cash put in + current mark value. */
  get optionPnl(): number {
    return this.userOptionCashFlow + this.userOptionValue;
  }

  /**
   * The options dealer's live state. The dealer isn't an agent you add — it's the
   * built-in counterparty that writes every option the public buys and then
   * delta-hedges that exposure in the stock (the source of gamma-driven flow).
   */
  get optionsDealerState(): { shares: number; cash: number; pnl: number; hedgeTarget: number; impliedVol: number } {
    const px = this.currentPrice;
    return {
      shares: this.optionsDealer.shares,
      cash: this.optionsDealer.cash,
      pnl: this.optionsDealer.cash + this.optionsDealer.shares * px - this.optionsDealer.startingCapital,
      hedgeTarget: this.optionsEnabled ? this.optionHedgeTarget() : 0,
      impliedVol: this.optionImpliedVol,
    };
  }

  /** Shares the dealer must hold to be delta-neutral = +(all holders' option delta). */
  private optionHedgeTarget(): number {
    const spot = this.book.getLastTradePrice();
    const deltaByContract = new Map<number, number>();
    for (const c of this.optionChain) deltaByContract.set(c.id, this.quote(c, spot).delta);
    let delta = 0;
    for (const [, pos] of this.optionPositions) {
      for (const [cid, qty] of pos) {
        if (qty !== 0) delta += qty * (deltaByContract.get(cid) ?? 0) * CONTRACT_MULTIPLIER;
      }
    }
    // Risk/position limit: a desk won't run a hedge book that dwarfs the float (an
    // unlimited one can walk the price wherever its delta points).
    const limit = OPTION_DEALER_POS_LIMIT * this.sharesOutstanding;
    return Math.max(-limit, Math.min(limit, delta));
  }

  /** Speculators (agents) buy calls/puts by regime — builds the OI the dealer hedges. */
  private runSpeculators(): void {
    if (!this.optionsEnabled || this.optionChain.length === 0) return;
    const spot = this.book.getLastTradePrice();
    const priceWindow = this.priceRing.window(STRATEGY_WINDOW).data;
    const market: MarketState = { priceHistory: priceWindow, tick: this.tick, sentiment: this.sentiment, fundamentalValue: this.fundamentalValue, sharesOutstanding: this.sharesOutstanding };
    for (const a of this.agents) {
      if (a.type !== 'speculator') continue;
      if (Math.random() >= a.activity) continue;

      // MANAGE an open position first: take profit or cut losses instead of only ever
      // riding to expiry. Holding a decaying lottery ticket to zero is why a buy-only
      // speculator can never win; real punters do close winners.
      const existing = this.optionPositions.get(a.id);
      if (existing && existing.size > 0) {
        let closedAny = false;
        for (const [cid, qty] of [...existing]) {
          if (qty <= 0) continue;
          const c = this.optionChain.find((x) => x.id === cid);
          if (!c) continue;
          const mark = this.quote(c, spot).price;
          const entry = a.entryPrice.get(cid);
          const ticksLeft = c.expiryTick - this.tick;
          if (entry && entry > 0) {
            const ret = mark / entry - 1;
            // +100% → bank it; −60% → cut it; and don't ride the last few ticks of decay.
            if (ret >= 1 || ret <= -0.6 || ticksLeft <= 5) {
              this.tradeOption(cid, -qty, a.id);
              a.entryPrice.delete(cid);
              closedAny = true;
            }
          }
        }
        // Still holding something? Keep it — one position at a time keeps OI bounded.
        if ([...existing.values()].some((q) => Math.abs(q) > 1e-9)) continue;
        if (closedAny) continue; // took action this tick
      }

      const sig = speculatorSignal(a, market);
      const wantType: OptionType | null = sig > a.conviction ? 'call' : sig < -a.conviction ? 'put' : null;
      if (!wantType) continue;
      // Slightly-OTM strike, and a tenor that isn't about to expire: the shortest-dated
      // series is nearly all decay, so prefer one with real time left (as a punter would).
      const target = wantType === 'call' ? spot * 1.03 : spot * 0.97;
      const usable = this.optionChain.filter((c) => c.type === wantType && c.expiryTick - this.tick >= a.minTicksToExpiry);
      const candidates = usable.length > 0 ? usable : this.optionChain.filter((c) => c.type === wantType);
      candidates.sort((x, y) => (Math.abs(x.strike - target) - Math.abs(y.strike - target)) || (x.expiryTick - y.expiryTick));
      const pick = candidates[0];
      if (!pick) continue;
      const price = this.quote(pick, spot).price;
      const perContract = price * CONTRACT_MULTIPLIER;
      // Budget off its MANDATE (starting capital), not its current pile: otherwise a
      // winning streak compounds into ever-larger bets that swamp the whole market.
      const budget = a.budgetFrac * Math.min(a.cash, a.startingCapital);
      let qty = perContract > 0 ? Math.floor(budget / perContract) : 0;
      // Respect the market-wide open-interest cap (dealers only write what they can hedge).
      const oiRoom = (OPTION_MAX_OI_FRACTION * this.sharesOutstanding) / CONTRACT_MULTIPLIER - this.totalOpenInterest();
      qty = Math.min(qty, Math.floor(Math.max(0, oiRoom)));
      if (qty >= 1) {
        this.tradeOption(pick.id, qty, a.id);
        a.entryPrice.set(pick.id, price); // remember the entry so it can take profit / cut
      }
    }
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
      // A stop must sit on the FAR side of the market, or it would trigger instantly at
      // the end of this very tick while the UI claims it is resting.
      const wrongSide = uo.side === 'buy' ? uo.stopPrice <= px : uo.stopPrice >= px;
      if (wrongSide) {
        this.lastOrderNote = `A ${uo.side}-stop must be ${uo.side === 'buy' ? 'above' : 'below'} the current price ($${px.toFixed(2)}) — otherwise it fires immediately.`;
        return [];
      }
      this.book.submitStopOrder(uo.side, requested, uo.stopPrice, 'user');
      this.lastOrderNote = `${uo.side === 'buy' ? 'Buy' : 'Sell'}-stop resting — fires if price ${uo.side === 'buy' ? 'rises to' : 'falls to'} $${uo.stopPrice.toFixed(2)}.`;
      return [];
    }
    // Reserve what the user's RESTING orders have already committed, so several orders
    // can't each spend the same cash / sell the same shares.
    // Buying power, not raw cash: while short, part of `cash` is restricted short proceeds.
    const freeCash = Math.max(0, freeBuyingPower(this.user, px) - this.book.restingBuyNotional('user'));
    const freeShares = this.user.shares - this.book.restingSellSize('user');
    let size = requested;
    if (uo.side === 'sell') {
      // Sell uncommitted holdings, plus a cash-collateralized short if enabled.
      const maxShort = this.userCanShort ? shortCapacity(this.user, px) : 0;
      size = Math.min(size, Math.max(0, freeShares + maxShort));
      if (size < MIN_ORDER) {
        this.lastOrderNote = freeShares < MIN_ORDER
          ? (this.userCanShort ? 'No short capacity (need cash as collateral).' : 'No uncommitted shares to sell — enable shorting to sell short.')
          : null;
        return [];
      }
    } else if (uo.limitPrice != null) {
      // A limit buy rests at a known price, so cap it at that price (incl. the fee).
      const perShare = uo.limitPrice * (1 + this.feeBps / 10000);
      size = Math.min(size, perShare > 0 ? freeCash / perShare : 0);
      if (size < MIN_ORDER) {
        this.lastOrderNote = 'Not enough uncommitted cash for that limit buy.';
        return [];
      }
    } else {
      // A market buy WALKS the ask ladder, paying more at each level — so size it against
      // the actual ladder, not the best ask, or it overspends and overdraws the account.
      size = Math.min(size, this.book.maxBuyableForCash(freeCash, this.feeBps, 'user'));
      if (size < MIN_ORDER) {
        this.lastOrderNote = this.book.getBestAsk() == null
          ? 'No ask-side liquidity — nothing to trade against.'
          : 'Not enough cash to buy at the current price.';
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

    // Options expire on their OWN clocks: settle just the contracts that came due and
    // list a replacement far-dated series, so a range of maturities stays available.
    if (this.optionsEnabled) this.settleExpiredContracts();

    // The slow mood tide wanders continuously and lingers on one side for a long time
    // (a persistent AR(1)), giving lasting-but-nuanced bull/bear regimes rather than a
    // binary flip or fast noise. It also gently tilts news direction (below).
    this.moodTide = Math.max(-1.2, Math.min(1.2, this.moodTide * MOOD_TIDE_DECAY + (Math.random() * 2 - 1) * MOOD_TIDE_STEP));

    // Auto-news arrives in lumpy bursts: a low base rate, boosted while a cluster
    // is active. Direction is tilted by the current regime, so good times keep
    // bringing good news (and vice versa) rather than flipping randomly.
    if (this.autoNews) {
      const prob = AUTO_NEWS_PROB * (this.newsClusterTicks > 0 ? NEWS_CLUSTER_BOOST : 1);
      if (Math.random() < prob) {
        const magnitude = 1 + Math.random() * 1.5; // 1.0 .. 2.5
        const goodProb = 0.5 + NEWS_DIRECTION_BIAS * this.moodTide;
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
    const regimeBaseline = MOOD_TIDE_LEVEL * this.moodTide;
    this.sentiment = SENTIMENT_CAP * Math.tanh((regimeBaseline + this.newsMood + this.reflexMood) / SENTIMENT_CAP);
    if (Math.abs(this.sentiment) < 0.001) this.sentiment = 0;

    const priceWindow = this.priceRing.window(STRATEGY_WINDOW).data;
    const market: MarketState = { priceHistory: priceWindow, tick: this.tick, sentiment: this.sentiment, fundamentalValue: this.fundamentalValue, sharesOutstanding: this.sharesOutstanding };
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
          // A maker must keep quoting even while covering — dropping out of the book is
          // more damaging to the market than its own inventory problem.
          if (agent.type !== 'marketMaker') continue;
        }
      }

      const intents = decideOrder(agent, market);
      if (intents.length === 0) continue; // inactive makers keep their resting quotes

      this.book.cancelOrdersByOwner(agent.id); // cancel-and-replace
      let availCash = freeBuyingPower(agent, px);
      let availShares = agent.shares;
      const maxShort = CAN_SHORT.has(agent.type) ? shortCapacity(agent, px) : 0;

      const risk = this.updateRiskScale(agent, px); // de-risked after losses, restored on recovery
      for (const intent of intents) {
        let size = intent.size * risk;
        if (intent.side === 'buy') {
          if (intent.limitPrice != null) {
            size = Math.min(size, intent.limitPrice > 0 ? availCash / (intent.limitPrice * (1 + this.feeBps / 10000)) : 0);
          } else {
            // A market buy walks the ladder — size against the real book, not a flat
            // 5% slippage guess, so it can't spend more cash than the agent has.
            size = Math.min(size, this.book.maxBuyableForCash(availCash, this.feeBps, agent.id));
          }
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

    // User short margin call: if a rising price wipes out the collateral on the user's
    // short, force-buy it back (a squeeze can catch the user too).
    if (this.user.shares < -MIN_ORDER) {
      const p = this.book.getLastTradePrice();
      const exposure = -this.user.shares * p;
      const equity = this.user.cash + this.user.shares * p;
      if (equity < MAINT_MARGIN * exposure) {
        this.book.cancelOrdersByOwner('user');
        for (const t of this.book.submitMarketOrder('buy', -this.user.shares, 'user', this.tick)) {
          this.settle(t, registry);
          tickTrades.push(t);
        }
        this.lastOrderNote = 'Margin call — your short was bought in.';
      }
    }

    // Re-mark implied vol off recent realized vol (annualized) so the chain is priced
    // fairly rather than systematically rich or cheap.
    if (this.optionsEnabled) {
      this.optionImpliedVol = this.realizedAnnualVol();
      this.optionRate = this.driftAnnual();
    }

    // Options speculators buy calls/puts by regime — building the open interest the
    // dealer then hedges (so gamma squeezes emerge from real option demand).
    this.runSpeculators();

    // Options dealer delta-hedge: rebalance its stock inventory to offset the public's
    // net option delta. As price moves, that target moves (gamma), so the dealer buys
    // rallies / sells dips when short gamma — a gamma squeeze that EMERGES from real
    // open interest and hits the same book as everyone else.
    if (this.optionsEnabled) {
      // Ease toward the hedge target rather than snapping to it each tick — real dealers
      // hedge gradually, and a full-delta rebalance every tick makes the gamma feedback
      // violent enough to crash the price. HEDGE_RATE spreads it over ~5 ticks.
      const delta = (this.optionHedgeTarget() - this.optionsDealer.shares) * OPTION_HEDGE_RATE;
      // Bound the hedge by the desk's balance sheet: buys by cash, sells by inventory
      // plus a cash-collateralized short. Without this the dealer can move the price
      // without limit and a put-heavy regime drives the market to zero.
      const hp = this.book.getLastTradePrice();
      let hedgeSize = Math.abs(delta);
      if (delta > 0) {
        hedgeSize = Math.min(hedgeSize, hp > 0 ? Math.max(0, this.optionsDealer.cash) / hp : 0);
      } else {
        const shortCap = shortCapacity(this.optionsDealer, hp);
        hedgeSize = Math.min(hedgeSize, Math.max(0, this.optionsDealer.shares + shortCap));
      }
      if (hedgeSize >= MIN_ORDER) {
        // Hedge PASSIVELY: join the near side of the book with a resting limit order
        // instead of taking with a market order every tick. A dealer that takes
        // liquidity relentlessly in one direction walks the book away and drains the
        // very liquidity it needs; real desks work their hedge into existing flow.
        this.book.cancelOrdersByOwner('optionsDealer');
        const side: Side = delta > 0 ? 'buy' : 'sell';
        const join = side === 'buy' ? (this.bestBid ?? hp) : (this.bestAsk ?? hp);
        for (const t of this.book.submitLimitOrder(side, hedgeSize, join, 'optionsDealer', this.tick)) {
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

    const px = this.book.getLastTradePrice();
    this.priceRing.push(px);
    this.buyVolRing.push(buyVol);
    this.sellVolRing.push(sellVol);
    this.sentimentRing.push(this.sentiment);

    // Sample each participant's PnL into its bounded sparkline ring (every few ticks).
    if (this.tick % Math.max(1, this.sparkInterval) === 0) {
      // Include option mark value so the user's sparkline matches the equity shown.
      this.sampleSpark('user', this.user.cash + this.user.shares * px + (this.optionsEnabled ? this.userOptionValue : 0) - this.user.startingCapital);
      for (const a of this.agents) this.sampleSpark(a.id, a.cash + a.shares * px - a.startingCapital);
    }

    return tickTrades;
  }

  private sampleSpark(id: string, pnl: number): void {
    let ring = this.pnlSpark.get(id);
    if (!ring) { ring = new RingBuffer(SPARK_CAP); this.pnlSpark.set(id, ring); }
    ring.push(pnl);
  }

  /**
   * Live risk appetite in (RISK_FLOOR, 1]: 1 at a fresh equity high, falling as the agent
   * draws down. Multiplies every order size, so a losing agent trades smaller — and
   * recovers its size as equity recovers.
   */
  private updateRiskScale(agent: Agent, px: number): number {
    const eq = agent.cash + agent.shares * px;
    const peak = Math.max(this.peakEquity.get(agent.id) ?? eq, eq);
    this.peakEquity.set(agent.id, peak);
    const dd = peak > 0 ? Math.max(0, 1 - eq / peak) : 0;
    const scale = Math.max(RISK_FLOOR, 1 - dd * RISK_DD_SENSITIVITY);
    this.riskScaleById.set(agent.id, scale);
    return scale;
  }

  /**
   * Read the agent's current risk appetite. PURE — it only reads the value computed
   * during step(); deriving it on demand would mutate peak-equity state from render.
   */
  getRiskScale(id: string): number {
    return this.riskScaleById.get(id) ?? 1;
  }

  /** Bounded PnL history (oldest→newest) for an owner, for a sparkline. */
  getPnlSpark(id: string): number[] {
    return this.pnlSpark.get(id)?.window(SPARK_CAP).data ?? [];
  }
}
