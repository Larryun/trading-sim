import type { RestingOrder, Side, Trade } from './types';

let nextOrderId = 1;
let nextTradeId = 1;

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

  /** The user's own resting limit orders. */
  getUserOrders(): RestingUserOrder[] {
    return [...this.asks, ...this.bids]
      .filter((o) => o.ownerId === 'user')
      .map((o) => ({ id: o.id, side: o.side, price: o.price, size: o.size }));
  }

  /** Remove all resting orders belonging to an owner (cancel / cancel-replace). */
  cancelOrdersByOwner(ownerId: string): void {
    this.bids = this.bids.filter((o) => o.ownerId !== ownerId);
    this.asks = this.asks.filter((o) => o.ownerId !== ownerId);
  }

  countOrdersByOwner(ownerId: string): number {
    return this.bids.filter((o) => o.ownerId === ownerId).length + this.asks.filter((o) => o.ownerId === ownerId).length;
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

    while (remaining > 1e-9 && book.length > 0) {
      const best = book[0];
      if (best.ownerId === ownerId) break; // never trade with your own resting order
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
      if (best.size <= 1e-9) book.shift();
    }

    return trades;
  }
}
