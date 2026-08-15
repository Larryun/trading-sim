import { OrderBook } from './orderBook';
import { AGENT_TYPE_LABELS, applyBuy, applySell, createAgent, decideOrder } from './agents';
import { randomHeadline } from './news';
import { RingBuffer } from './ringBuffer';
import type { Agent, AgentAccount, AgentType, MarketState, NewsEvent, Side, Trade, UserOrderRecord } from './types';

// The engine instance lives in a useRef and is NOT rebuilt by HMR, so editing
// this module while the app runs would leave a stale instance (missing new agent
// types / order methods). Force a full page reload on edits to avoid that.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

const STARTING_PRICE = 100;
const MIN_ORDER = 0.01;
const USER_STARTING_CASH = 10000;

const HISTORY_CAP = 4096;
const STRATEGY_WINDOW = 256;
const MAX_TRADES = 500;

const AUTO_NEWS_PROB = 0.02;
// Sentiment realism: beyond discrete news jumps, the "mood" also reacts to recent
// price action (reflexivity), wobbles randomly, spikes harder on the way down
// (fear), and gets jumpier when already excited (volatility clustering).
const SENTIMENT_REFLEX_WINDOW = 12; // ticks of price action the mood reads (longer = smoother)
const SENTIMENT_MOOD_NOISE = 0.008; // small random wobble (kept low so mood isn't just noise)
const SENTIMENT_FEAR_ASYMMETRY = 1.6; // downside moves move sentiment more than up
const SENTIMENT_CAP = 3; // bound so the reflexive loop can't run away

// Dividends inject cash into the market from OUTSIDE the trading system (the
// company paying shareholders), so the market isn't a closed, zero-sum cash pool.
const DIVIDEND_INTERVAL = 50; // ticks between dividend payments

interface PendingUserOrder {
  side: Side;
  size: number;
  limitPrice?: number;
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

  sentiment = 0;
  sentimentDecay = 0.96; // mood persists (shrinks only slowly each tick) — regimes last
  sentimentReflexivity = 3; // how strongly the recent trend feeds the mood (low = less self-reinforcing drift)
  fundamentalValue = STARTING_PRICE; // the "true" value; permanently moved by news
  // Tuned low so the news-driven fundamental stays within reach of the long-only
  // agent pool in BOTH directions (they can't short to chase a crashed fair).
  fundamentalImpact = 0.012; // fraction the fundamental moves per unit of news sentiment
  events: NewsEvent[] = [];
  autoNews = false;
  private nextEventId = 1;

  // Organic cash inflow: cash paid per share held, every DIVIDEND_INTERVAL ticks.
  // Tuned to roughly balance the 5bps taker fee outflow so cash drift stays ~0.
  dividendPerShare = 0.02;
  totalDividendsPaid = 0;

  // Transaction cost: the taker (aggressor) pays this fraction of notional on every
  // fill. It leaves the participant system entirely (goes to the broker/exchange).
  feeBps = 5;
  totalFeesPaid = 0;

  private nextAgentNum: Record<AgentType, number> = {
    noise: 0, momentum: 0, meanReversion: 0, news: 0, marketMaker: 0, value: 0, fomoHerd: 0, whale: 0, panicSeller: 0,
  };
  private nextAgentId = 1;

  constructor() {
    this.book = new OrderBook(STARTING_PRICE);
  }

  get currentPrice(): number {
    return this.book.getLastTradePrice();
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
    return this.agents.reduce((s, a) => s + a.shares, 0) + this.user.shares;
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
    // Transient reaction (decays) plus a permanent repricing of the fundamental.
    this.sentiment += sentiment;
    this.fundamentalValue = Math.max(1, this.fundamentalValue * (1 + sentiment * this.fundamentalImpact));
    return event;
  }

  addAgent(type: AgentType, capital: number): Agent {
    this.nextAgentNum[type] += 1;
    const id = `agent-${this.nextAgentId++}`;
    const name = `${AGENT_TYPE_LABELS[type]} #${this.nextAgentNum[type]}`;
    const agent = createAgent(type, capital, this.currentPrice, id, name);
    // A new participant brings its own shares into the market (its share of the
    // float), so adding an agent grows the float and removing one retires it.
    this.agents.push(agent);
    return agent;
  }

  removeAgent(id: string): void {
    this.book.cancelOrdersByOwner(id); // pull its resting quotes
    this.agents = this.agents.filter((a) => a.id !== id);
  }

  updateAgentParams(id: string, patch: Record<string, number>): void {
    const agent = this.agents.find((a) => a.id === id);
    if (agent) Object.assign(agent, patch);
  }

  queueUserOrder(side: Side, size: number, limitPrice?: number): void {
    this.pendingUserOrders.push({ side, size, limitPrice });
  }

  cancelUserOrders(): void {
    this.book.cancelOrdersByOwner('user');
  }

  /** Map every ownerId to its account so both sides of a trade can be settled. */
  private buildRegistry(): Map<string, AgentAccount> {
    const reg = new Map<string, AgentAccount>();
    reg.set('user', this.user);
    for (const a of this.agents) reg.set(a.id, a);
    return reg;
  }

  private settle(trade: Trade, reg: Map<string, AgentAccount>): void {
    const buyer = reg.get(trade.buyerId);
    const seller = reg.get(trade.sellerId);
    if (buyer) applyBuy(buyer, trade.price, trade.size);
    if (seller) applySell(seller, trade.price, trade.size);

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
    if (this.dividendPerShare > 0 && this.tick % DIVIDEND_INTERVAL === 0) {
      for (const a of this.agents) a.cash += a.shares * this.dividendPerShare;
      this.user.cash += this.user.shares * this.dividendPerShare;
      this.totalDividendsPaid += this.sharesOutstanding * this.dividendPerShare;
      this.fundamentalValue = Math.max(1, this.fundamentalValue - this.dividendPerShare);
    }

    // No backstop liquidity is injected: the only resting orders are those the
    // agents (esp. market makers) and the user post. If makers pull, the book
    // thins and the market can go illiquid — a real liquidity crisis.
    if (this.autoNews && Math.random() < AUTO_NEWS_PROB) {
      const magnitude = 0.5 + Math.random();
      this.triggerEvent(Math.random() < 0.5 ? magnitude : -magnitude);
    }

    // Evolve the mood: reflexive feedback from recent price action (rallies breed
    // optimism, drops breed fear — sharper on the downside), a random wobble that
    // grows when the market is already excited (volatility clustering), then decay.
    if (this.priceRing.size > SENTIMENT_REFLEX_WINDOW) {
      const w = this.priceRing.window(SENTIMENT_REFLEX_WINDOW + 1).data;
      const p0 = w[0];
      const ret = p0 > 0 ? (w[w.length - 1] - p0) / p0 : 0;
      let reflex = this.sentimentReflexivity * ret;
      if (ret < 0) reflex *= SENTIMENT_FEAR_ASYMMETRY;
      this.sentiment += reflex;
    }
    this.sentiment += (Math.random() * 2 - 1) * SENTIMENT_MOOD_NOISE * (1 + Math.abs(this.sentiment));
    this.sentiment *= this.sentimentDecay;
    this.sentiment = Math.max(-SENTIMENT_CAP, Math.min(SENTIMENT_CAP, this.sentiment));
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
      const intents = decideOrder(agent, market);
      if (intents.length === 0) continue; // inactive makers keep their resting quotes

      this.book.cancelOrdersByOwner(agent.id); // cancel-and-replace
      let availCash = agent.cash;
      let availShares = agent.shares;

      for (const intent of intents) {
        let size = intent.size;
        if (intent.side === 'buy') {
          const refPrice = intent.limitPrice ?? this.book.getLastTradePrice() * 1.05;
          size = Math.min(size, refPrice > 0 ? availCash / refPrice : 0);
        } else {
          size = Math.min(size, availShares);
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
        if (intent.side === 'buy') availCash -= size * (intent.limitPrice ?? this.book.getLastTradePrice());
        else availShares -= size;
      }
    }

    // User orders (market or limit). Sells capped to shares held.
    for (const uo of this.pendingUserOrders) {
      let size = uo.size;
      if (uo.side === 'sell') size = Math.min(size, this.user.shares);
      if (size < MIN_ORDER) continue;
      const trades = uo.limitPrice != null
        ? this.book.submitLimitOrder(uo.side, size, uo.limitPrice, 'user', this.tick)
        : this.book.submitMarketOrder(uo.side, size, 'user', this.tick);
      for (const t of trades) {
        this.settle(t, registry);
        tickTrades.push(t);
      }
    }
    this.pendingUserOrders = [];

    // Aggregate this tick's volume and the user's fills (incl. resting-order
    // fills triggered by other participants earlier in the tick).
    let buyVol = 0;
    let sellVol = 0;
    let userBuyShares = 0, userBuyNotional = 0, userSellShares = 0, userSellNotional = 0;
    for (const t of tickTrades) {
      if (t.side === 'buy') buyVol += t.size;
      else sellVol += t.size;
      if (t.buyerId === 'user') { userBuyShares += t.size; userBuyNotional += t.price * t.size; }
      if (t.sellerId === 'user') { userSellShares += t.size; userSellNotional += t.price * t.size; }
    }

    if (userBuyShares > 0) {
      const avgPrice = userBuyNotional / userBuyShares;
      this.userOrders.push({ id: this.nextUserOrderId++, tick: this.tick, side: 'buy', shares: userBuyShares, avgPrice, gain: 0 });
      this.lastUserFill = { side: 'buy', size: userBuyShares, avgPrice, priceBefore: stepStartPrice };
    }
    if (userSellShares > 0) {
      const avgPrice = userSellNotional / userSellShares;
      const gain = this.user.realizedPnl - userRealizedAtStart; // realized delta comes only from sells
      this.userOrders.push({ id: this.nextUserOrderId++, tick: this.tick, side: 'sell', shares: userSellShares, avgPrice, gain });
      this.lastUserFill = { side: 'sell', size: userSellShares, avgPrice, priceBefore: stepStartPrice };
    }
    if (this.userOrders.length > 200) this.userOrders = this.userOrders.slice(-200);

    this.trades.push(...tickTrades);
    if (this.trades.length > MAX_TRADES) this.trades = this.trades.slice(-MAX_TRADES);

    this.priceRing.push(this.book.getLastTradePrice());
    this.buyVolRing.push(buyVol);
    this.sellVolRing.push(sellVol);
    this.sentimentRing.push(this.sentiment);

    return tickTrades;
  }
}
