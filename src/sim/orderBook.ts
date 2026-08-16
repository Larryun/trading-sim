import type { RestingOrder, Side, Trade } from './types';

let nextOrderId = 1;
let nextTradeId = 1;

const MAX_STOPS = 200; // cap on resting stop orders (matches the userOrders history cap)

// Real exchanges quote on a fixed price grid (a "tick size"), not a continuum.
// Snapping resting prices to this grid keeps the book to discrete, distinct price
// levels at any price scale and makes depth aggregation exact (no float-key noise).
export const TICK_SIZE = 0.01;
const priceToTick = (price: number): number => Math.round(price / TICK_SIZE);
const tickToPrice = (tick: number): number => tick * TICK_SIZE;
/** Snap a price onto the tick grid (never below one tick). */
export function roundToTick(price: number): number {
  return Math.max(TICK_SIZE, tickToPrice(priceToTick(price)));
}

/** One aggregated price level of the book (total size + the portion the user owns). */
export interface BookLevel {
  price: number;
  size: number;
  userSize: number;
}

/** A single resting limit order owned by the user. */
export interface RestingUserOrder {
  id: number;
  side: Side;
  price: number;
  size: number;
  kind: 'limit' | 'stop'; // stop = a resting stop order (fires a market order when price crosses)
}

/** A resting stop order: dormant until the last trade price crosses `stopPrice`. */
interface RestingStop {
  side: Side;
  size: number;
  stopPrice: number;
  ownerId: string;
  id: number;
}

/**
 * A limit order book supporting both market orders and resting limit orders.
 *
 * Anyone can rest limit orders (agents or the user); they persist across ticks
 * until filled or cancelled. Market orders walk the opposite side, filling
 * against whatever is resting — so trades are between real participants and price
 * impact grows with order size (deeper levels). There is no synthetic backstop:
 * all liquidity comes from participants' limit orders (mainly market makers), so
 * the book can genuinely thin out.
 */
export class OrderBook {
  private bids: RestingOrder[] = []; // sorted descending by price (best bid first)
  private asks: RestingOrder[] = []; // sorted ascending by price (best ask first)
  private stops: RestingStop[] = []; // dormant stop orders, fired when price crosses their trigger
  private lastTradePrice: number;

  constructor(startingPrice: number) {
    this.lastTradePrice = startingPrice;
  }

  getLastTradePrice(): number {
    return this.lastTradePrice;
  }

  getBestBid(): number | null {
    return this.bids[0]?.price ?? null;
  }

  getBestAsk(): number | null {
    return this.asks[0]?.price ?? null;
  }

  getMidPrice(): number {
    const bestBid = this.bids[0]?.price;
    const bestAsk = this.asks[0]?.price;
    if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
    return this.lastTradePrice;
  }

  getTopLevels(depth = 5): { bids: RestingOrder[]; asks: RestingOrder[] } {
    return { bids: this.bids.slice(0, depth), asks: this.asks.slice(0, depth) };
  }

  /**
   * Aggregate the resting book into price levels nearest the spread. Each level
   * reports total resting size and how much of it the user owns (for highlighting).
   */
  getDepth(maxLevels: number): { bids: BookLevel[]; asks: BookLevel[] } {
    const aggregate = (orders: RestingOrder[]): BookLevel[] => {
      // Key by integer tick, not the float price, so orders on the same grid level
      // aggregate exactly (float prices like 100.47000001 won't split a level).
      const levels = new Map<number, BookLevel>();
      for (const o of orders) {
        const tick = priceToTick(o.price);
        const level = levels.get(tick) ?? { price: tickToPrice(tick), size: 0, userSize: 0 };
        level.size += o.size;
        if (o.ownerId === 'user') level.userSize += o.size;
        levels.set(tick, level);
      }
      return [...levels.values()].slice(0, maxLevels); // orders are pre-sorted best-first
    };
    return { bids: aggregate(this.bids), asks: aggregate(this.asks) };
  }

  /** The user's own resting limit orders and stop orders. */
  getUserOrders(): RestingUserOrder[] {
    const limits: RestingUserOrder[] = [...this.asks, ...this.bids]
      .filter((o) => o.ownerId === 'user')
      .map((o) => ({ id: o.id, side: o.side, price: o.price, size: o.size, kind: 'limit' as const }));
    const stops: RestingUserOrder[] = this.stops
      .filter((s) => s.ownerId === 'user')
      .map((s) => ({ id: s.id, side: s.side, price: s.stopPrice, size: s.size, kind: 'stop' as const }));
    return [...limits, ...stops];
  }

  /** Rest a stop order: dormant until `stopPrice` is crossed (see popTriggeredStops). */
  submitStopOrder(side: Side, size: number, stopPrice: number, ownerId: string): void {
    this.stops.push({ side, size, stopPrice: roundToTick(stopPrice), ownerId, id: nextOrderId++ });
    // Cap like the other lists: a resting stop whose trigger is never crossed and is
    // never cancelled would otherwise accumulate forever (drop the oldest). Stops are
    // user-placed only, so 200 is generous.
    if (this.stops.length > MAX_STOPS) this.stops = this.stops.slice(-MAX_STOPS);
  }

  /**
   * Remove and return every stop whose trigger the last trade price has now crossed:
   * a buy-stop fires once price rises to/through it, a sell-stop once price falls to it.
   * Called repeatedly (each fired stop moves price) to produce stop-cascade chains.
   */
  popTriggeredStops(): RestingStop[] {
    const px = this.lastTradePrice;
    const fired: RestingStop[] = [];
    this.stops = this.stops.filter((s) => {
      const hit = s.side === 'buy' ? px >= s.stopPrice : px <= s.stopPrice;
      if (hit) fired.push(s);
      return !hit;
    });
    return fired;
  }

  /** Remove all resting orders (limits and stops) belonging to an owner. */
  cancelOrdersByOwner(ownerId: string): void {
    this.bids = this.bids.filter((o) => o.ownerId !== ownerId);
    this.asks = this.asks.filter((o) => o.ownerId !== ownerId);
    this.stops = this.stops.filter((s) => s.ownerId !== ownerId);
  }

  /**
   * Cash already committed to an owner's resting BUY orders. New buys must be sized
   * against cash minus this, or several resting orders can each spend the same dollars
   * and overdraw the account when they all fill.
   */
  restingBuyNotional(ownerId: string): number {
    let n = 0;
    for (const o of this.bids) if (o.ownerId === ownerId) n += o.price * o.size;
    return n;
  }

  /** Shares already committed to an owner's resting SELL orders. */
  restingSellSize(ownerId: string): number {
    let s = 0;
    for (const o of this.asks) if (o.ownerId === ownerId) s += o.size;
    return s;
  }

  /**
   * The largest quantity a market buy can afford with `cash`, walking the actual ask
   * ladder (each level costs more). Sizing off the best ask alone overspends whenever
   * the order walks past the touch.
   */
  maxBuyableForCash(cash: number, feeBps = 0, ownerId?: string): number {
    const feeMul = 1 + feeBps / 10000;
    let left = cash;
    let shares = 0;
    for (const o of this.asks) {
      if (ownerId != null && o.ownerId === ownerId) continue; // can't buy from itself
      const costPer = o.price * feeMul;
      if (costPer <= 0 || left <= 0) break;
      const affordable = left / costPer;
      if (affordable >= o.size) { shares += o.size; left -= o.size * costPer; }
      else { shares += affordable; left = 0; break; }
    }
    return shares;
  }

  countOrdersByOwner(ownerId: string): number {
    return this.bids.filter((o) => o.ownerId === ownerId).length
      + this.asks.filter((o) => o.ownerId === ownerId).length
      + this.stops.filter((s) => s.ownerId === ownerId).length;
  }

  private insert(order: RestingOrder): void {
    if (order.side === 'buy') {
      this.bids.push(order);
      this.bids.sort((a, b) => b.price - a.price); // V8 sort is stable => price-time priority
    } else {
      this.asks.push(order);
      this.asks.sort((a, b) => a.price - b.price);
    }
  }

  /**
   * Execute a market order: walk the opposite side of the book filling at each
   * level's price until filled or liquidity is exhausted. Unfilled remainder is
   * discarded (the order ran out of liquidity).
   */
  submitMarketOrder(side: Side, size: number, ownerId: string, tick: number): Trade[] {
    return this.matchAgainst(side, size, ownerId, tick, side === 'buy' ? Infinity : 0);
  }

  /**
   * Execute a limit order: fill the portion that crosses the book at prices at
   * least as good as `price`, then rest any remainder at `price` as liquidity.
   */
  submitLimitOrder(side: Side, size: number, price: number, ownerId: string, tick: number): Trade[] {
    // Snap the limit price onto the tick grid (real orders can't sit between ticks).
    price = roundToTick(price);
    const trades = this.matchAgainst(side, size, ownerId, tick, price);
    const filled = trades.reduce((s, t) => s + t.size, 0);
    const remaining = size - filled;
    if (remaining > 1e-9) {
      this.insert({ side, size: remaining, price, ownerId, id: nextOrderId++ });
    }
    return trades;
  }

  /**
   * Shared matcher. `limitPrice` is the worst acceptable price: a buy fills
   * against asks priced <= limitPrice, a sell against bids priced >= limitPrice.
   * Pass Infinity (buy) / 0 (sell) for an unconstrained market order.
   */
  private matchAgainst(side: Side, size: number, ownerId: string, tick: number, limitPrice: number): Trade[] {
    const trades: Trade[] = [];
    let remaining = size;
    const book = side === 'buy' ? this.asks : this.bids;

    // Walk the book with an index so self-match prevention SKIPS the owner's own resting
    // orders and keeps matching the liquidity behind them. Aborting instead (a `break`)
    // would hide a live book: an owner resting at the touch could get "no liquidity" even
    // with plenty of other depth available.
    let i = 0;
    while (remaining > 1e-9 && i < book.length) {
      const best = book[i];
      if (best.ownerId === ownerId) { i++; continue; } // never trade with your own order
      const crosses = side === 'buy' ? best.price <= limitPrice : best.price >= limitPrice;
      if (!crosses) break;

      const fillSize = Math.min(remaining, best.size);
      this.lastTradePrice = best.price;
      trades.push({
        id: nextTradeId++,
        tick,
        side,
        size: fillSize,
        price: best.price,
        buyerId: side === 'buy' ? ownerId : best.ownerId,
        sellerId: side === 'buy' ? best.ownerId : ownerId,
      });

      remaining -= fillSize;
      best.size -= fillSize;
      if (best.size <= 1e-9) book.splice(i, 1); // consumed — next order shifts into place
    }

    return trades;
  }
}
