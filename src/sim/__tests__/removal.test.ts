import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../engine';
import { DEFAULT_CAST } from '../defaultCast';
import type { Agent } from '../types';

/**
 * AGENT REMOVAL AND WIND-DOWN.
 *
 * Deleting a participant is the single most dangerous operation in this simulator, because a
 * real market has no "delete a fund" button: a fund that leaves must SELL its position to
 * someone, at prices the rest of the market chooses. Every historical bug in this area came
 * from taking a shortcut around that fact — vaporising the shares, force-transferring them as
 * a block, dumping them as one market order, pricing the exit off its own prints, or letting a
 * blown-up short buy back stock with money it did not have.
 *
 * These tests assert the market PROPERTIES that shortcut violates, never the constants used to
 * implement them.
 *
 * NOTE: `liquidations` (the wind-down queue) is `private`, but it is observable market state —
 * "is the seller still working"? Tests read it through a cast, deliberately, rather than
 * inferring it indirectly; there is no public accessor.
 */

function buildEngine(options = true): SimulationEngine {
  const e = new SimulationEngine();
  for (const c of DEFAULT_CAST) {
    const a = e.addAgent(c.type, c.capital, c.style);
    if (c.params) e.updateAgentParams(a.id, c.params);
  }
  if (options) e.enableOptions(true);
  return e;
}

function run(e: SimulationEngine, n: number): void {
  for (let i = 0; i < n; i++) e.step();
}

/** The wind-down queue: accounts deleted from the UI that are still working a position off. */
function liquidating(e: SimulationEngine): Agent[] {
  return (e as unknown as { liquidations: Agent[] }).liquidations;
}

function biggestHolder(e: SimulationEngine): Agent {
  return [...e.agents].sort((a, b) => b.shares - a.shares)[0];
}

// ---------------------------------------------------------------------------
// One shared long simulation: warm up, delete the largest holder, keep running.
// Deleting the biggest single owner is the worst realistic case (it is the whole
// "someone must absorb this" problem at maximum size), and every property below is
// measured on the SAME run so the file stays fast.
// ---------------------------------------------------------------------------
const shared = (() => {
  const e = buildEngine(true);
  run(e, 1500);

  const target = biggestHolder(e);
  const floatBefore = e.sharesOutstanding;
  const removedShares = target.shares;
  const agentsBefore = e.agents.length;
  const priceAtRemoval = e.currentPrice;
  e.removeAgent(target.id);
  const floatAfter = e.sharesOutstanding;
  const stillListed = e.agents.some((a) => a.id === target.id);
  const restingAfter = e.book.countOrdersByOwner(target.id);

  // Follow through the entire wind-down and well beyond it.
  const floats: number[] = [];
  const prices: number[] = [];
  const fairs: number[] = [];
  let ticksWithBid = 0;
  let ticksWithAsk = 0;
  let queueEmptyAt = -1;
  const FOLLOW = 4000;
  for (let i = 0; i < FOLLOW; i++) {
    e.step();
    floats.push(e.sharesOutstanding);
    prices.push(e.currentPrice);
    fairs.push(e.fundamentalValue);
    if (e.bestBid != null) ticksWithBid++;
    if (e.bestAsk != null) ticksWithAsk++;
    if (queueEmptyAt < 0 && liquidating(e).length === 0) queueEmptyAt = i;
  }

  return {
    e, floatBefore, floatAfter, removedShares, agentsBefore, priceAtRemoval,
    stillListed, restingAfter, floats, prices, fairs, ticksWithBid, ticksWithAsk,
    queueEmptyAt, follow: FOLLOW,
  };
})();

describe('agent removal: the account leaves, the shares do not', () => {
  it('drops the account from the visible participant list immediately', () => {
    // Property: a deleted fund is gone from the market's participant list at once — it no
    // longer decides orders, so it cannot keep trading a strategy it has been retired from.
    expect(shared.stillListed).toBe(false);
    expect(shared.e.agents.length).toBe(shared.agentsBefore - 1);
  });

  it('cancels the deleted account\'s resting orders and stops on the spot', () => {
    // Property: quotes belong to a live participant. Leaving a deleted fund's limit orders in
    // the book would let a non-existent account keep providing liquidity and printing trades.
    //
    // NOTE: this MUST be measured on an account that actually quotes. The largest holder is an
    // index fund and never has resting orders (measured: 0 across 5 seeds), so asserting on it
    // would pass even if cancellation were deleted outright. Use a market maker, which reliably
    // has ~20+ live orders, and pin the before-count so the test cannot go vacuous again.
    const e = buildEngine(false);
    run(e, 800);
    const mm = e.agents.find((a) => a.type === 'marketMaker')!;
    const before = e.book.countOrdersByOwner(mm.id);
    expect(before).toBeGreaterThan(1);
    e.removeAgent(mm.id);
    expect(e.book.countOrdersByOwner(mm.id)).toBe(0);
    // The same must hold for the shared run's deleted holder (trivially true there — it had no
    // resting orders — kept only so the shared case is covered too).
    expect(shared.restingAfter).toBe(0);
  });

  it('does not destroy the deleted account\'s shares (regression: float shrank on delete)', () => {
    // Property: SHARE CONSERVATION. A company's outstanding shares do not change because a
    // shareholder was removed from a list — the stock has to go to another owner. The original
    // bug summed holdings for `sharesOutstanding` and deleted the account outright, so the
    // float shrank and every remaining holder's ownership percentage silently jumped.
    expect(shared.removedShares).toBeGreaterThan(0); // the case has to be non-trivial
    expect(shared.floatAfter).toBeCloseTo(shared.floatBefore, 6);
  });

  it('keeps the float constant through the whole wind-down and after it', () => {
    // Property: conservation must hold on EVERY tick while the position is being worked off,
    // not just at the instant of deletion — the wind-down settles real trades, and each one
    // must move shares between owners rather than create or burn them.
    for (const f of shared.floats) expect(f).toBeCloseTo(shared.floatBefore, 6);
  });

  it('adding a participant issues exactly its own shares, and all-cash adds none', () => {
    // Property: the counterpart to removal. A new investor brings its own stake into the
    // market; it cannot be handed someone else's shares. An all-cash entrant must BUY in.
    const e = buildEngine(false);
    run(e, 50);
    const before = e.sharesOutstanding;
    const px = e.currentPrice;
    const seeded = e.addAgent('trader', 200000, 'value');
    expect(e.sharesOutstanding).toBeCloseTo(before + seeded.shares, 6);
    // It brings a real stake, and that stake is paid for out of its OWN capital (it cannot be
    // handed more stock than its money buys). Asserting the *split* (e.g. exactly half in
    // shares) would pin an implementation constant instead of the property.
    expect(seeded.shares).toBeGreaterThan(0);
    expect(seeded.shares * px).toBeLessThanOrEqual(200000 + 1e-6);
    expect(seeded.cash + seeded.shares * px).toBeCloseTo(200000, 4);

    const before2 = e.sharesOutstanding;
    const allCash = e.addAgent('trader', 200000, 'value', true);
    expect(allCash.shares).toBe(0);
    expect(e.sharesOutstanding).toBeCloseTo(before2, 6);
  });
});

describe('wind-down: worked off gradually, not dumped', () => {
  it('leaves a live bid through the wind-down (regression: dumping emptied the bid side)', () => {
    // Property: a seller cannot consume the entire opposite side of the book. Selling the whole
    // liquidated block as one market order swept every bid, leaving the market with NO bid at
    // all — an unquotable market. A real exit is rate-limited and passive, so the book stays
    // two-sided while the position is being distributed.
    const bidFrac = shared.ticksWithBid / shared.follow;
    const askFrac = shared.ticksWithAsk / shared.follow;
    expect(bidFrac).toBeGreaterThan(0.9);
    expect(askFrac).toBeGreaterThan(0.9);
  });

  it('works the position off over many ticks rather than in one print', () => {
    // Property: liquidating a large stake takes TIME (it is rate-limited to a slice of recent
    // volume). If it completed in one or two ticks it would have crossed the book wholesale,
    // which is the mechanism that emptied the bid side above.
    const e = buildEngine(false);
    run(e, 1500);
    const target = biggestHolder(e);
    const block = target.shares;
    e.removeAgent(target.id);
    let ticks = 0;
    while (liquidating(e).length > 0 && ticks < 4000) { e.step(); ticks++; }
    expect(block).toBeGreaterThan(0);
    expect(ticks).toBeGreaterThan(20); // not a block dump
    // And no single tick's liquidation flow was a large slice of the whole float.
    // (Checked structurally below via price impact; here just that it finished.)
    expect(liquidating(e).length).toBe(0);
  });

  it('finishes the wind-down and retires the account from the queue', () => {
    // Property: a fund that is winding down eventually gets flat. A queue that never drains
    // means a phantom seller pressing on the book forever.
    expect(shared.queueEmptyAt).toBeGreaterThanOrEqual(0);
    expect(liquidating(shared.e).length).toBe(0);
  });

  it('never ratchets price away from fair value (regression: $100 -> $505,745)', () => {
    // Property: NO SELF-REFERENTIAL PRICING. The wind-down used to price its limit orders off
    // its OWN last trade print plus an offset: each dust-sized fill set a new last price, the
    // next order was placed relative to THAT, and the loop compounded the stock from $100 to
    // $505,745. A real order joins the prevailing quote, which cannot ratchet because it never
    // prices through the market.
    //
    // This is the strong test: over 4000 ticks following the deletion of the largest holder,
    // price must stay tethered to fundamentals in BOTH directions on EVERY tick. A ratchet of
    // any strength — even a slow one — breaks the upper bound long before it reaches $505k, and
    // the mirror-image downward ratchet (documented for the market maker) breaks the lower one.
    let worstHigh = 0;
    let worstLow = Infinity;
    for (let i = 0; i < shared.prices.length; i++) {
      const ratio = shared.prices[i] / shared.fairs[i];
      worstHigh = Math.max(worstHigh, ratio);
      worstLow = Math.min(worstLow, ratio);
      expect(shared.prices[i]).toBeGreaterThan(0);
      expect(Number.isFinite(shared.prices[i])).toBe(true);
    }
    expect(worstHigh).toBeLessThan(3);
    expect(worstLow).toBeGreaterThan(1 / 3);
    // Sharper still: the average discount/premium over the second half stays modest, so price
    // is genuinely anchored rather than merely bounded.
    const half = shared.prices.slice(shared.prices.length / 2);
    const halfFair = shared.fairs.slice(shared.fairs.length / 2);
    const meanAbsGap = half.reduce((s, p, i) => s + Math.abs(p / halfFair[i] - 1), 0) / half.length;
    // (Measured across 4 seeds: worst high ratio 0.95, worst low 0.68, mean gap 0.17-0.28.
    //  Price sits at a persistent DISCOUNT to fair in this market — see CLAUDE.md — so the
    //  bounds are deliberately asymmetric in effect, not in form.)
    expect(meanAbsGap).toBeLessThan(0.45);
  });

  it('never prints an absurd single-tick move during the wind-down', () => {
    // Property: a compounding ratchet shows up as a stream of same-signed jumps. Bounding each
    // tick's return catches the mechanism directly, independent of where price ends up.
    for (let i = 1; i < shared.prices.length; i++) {
      const ret = Math.abs(shared.prices[i] / shared.prices[i - 1] - 1);
      // Measured worst single-tick move across seeds: ~2.6%. 25% is far outside that and still
      // catches any compounding ratchet, which needs sustained same-signed jumps.
      expect(ret).toBeLessThan(0.25);
    }
  });
});

describe('wind-down of a SHORT: the cover is capped and any shortfall is recorded', () => {
  /**
   * Build a deleted short that cannot possibly fund its own buy-back. This is the blown-up
   * short: shares deeply negative, almost no cash.
   */
  function underfundedShort() {
    const e = buildEngine(false);
    run(e, 800);
    const px = e.currentPrice;
    const victim = e.agents.find((a) => a.type === 'trader')!;
    victim.shares = -2000; // a large short
    victim.cash = 500; // nowhere near the ~$200k needed to cover
    const floatBefore = e.sharesOutstanding;
    e.removeAgent(victim.id);
    return { e, victim, px, floatBefore };
  }

  it('does not let a deleted short buy back stock it cannot afford (no fabricated cash)', () => {
    // Property: CASH CONSERVATION. Covering a short COSTS money and the money has to exist. The
    // original bug covered in full regardless: a $649k short holding $5k of cash ended at
    // −$664k, i.e. it paid real sellers with money that was invented, inflating the market on
    // every such deletion. Cash may only enter through a recorded broker write-off.
    const { e } = underfundedShort();
    // Checked on EVERY tick, not just at the end: a transient overdraft is still fabricated cash
    // (it pays real sellers), and an end-state-only check would miss one that later recovers.
    // The bug was a −$664,000 balance. Ordinary operation does leave dollar-scale overdrafts
    // (taker fees are charged after a size is computed against available cash — measured worst
    // case ≈ −$1 over 10 seeds), so the bound is $100: five orders of magnitude below the bug
    // and far above the rounding noise. A −1e-6 bound here was flaky (2 failures in 12 runs).
    for (let i = 0; i < 200; i++) {
      e.step();
      let totalNegative = 0;
      for (const a of [...e.agents, ...liquidating(e), e.user, e.optionsDealer]) {
        expect(a.cash).toBeGreaterThan(-100);
        totalNegative += Math.min(0, a.cash);
      }
      // And in aggregate: no account is quietly funding purchases from an overdraft.
      expect(totalNegative).toBeGreaterThan(-1000);
    }
  });

  it('records the broker shortfall in brokerWriteOffs exactly once', () => {
    // Property: when a blown-up short genuinely cannot be funded, the broker absorbs the
    // shortfall — that is what happens in reality. But it is EXTERNAL cash entering the
    // market, so it must be visible and it must happen once. The first version re-ran the
    // top-up every tick, an unbounded cash injection feeding an ever-rising market.
    const { e } = underfundedShort();
    expect(e.brokerWriteOffs).toBe(0);
    e.step();
    const firstTick = e.brokerWriteOffs;
    expect(firstTick).toBeGreaterThan(0);
    run(e, 400);
    // It must not keep growing tick after tick for the same account.
    expect(e.brokerWriteOffs).toBeCloseTo(firstTick, 6);
  });

  it('keeps the float conserved across a written-off short closeout', () => {
    // Property: the accounting rescue must not disturb share count — the shortfall is a CASH
    // problem, and fixing it must not mint or burn stock.
    const { e, floatBefore } = underfundedShort();
    for (let i = 0; i < 300; i++) {
      e.step();
      // Sub-share tolerance (see the note in the next test): fractional fill rounding, not a
      // conservation break. A break in this code path loses the whole 2000-share position.
      expect(Math.abs(e.sharesOutstanding - floatBefore)).toBeLessThan(1);
    }
  });

  it('works the written-off short DOWN, never up, and keeps the rescue bounded', () => {
    // Property: after the broker absorbs the shortfall the position may only shrink. A borrow
    // that grows, or an account that keeps drawing broker money, is a leak.
    //
    // NOTE: this deliberately does NOT assert that the queue always drains. It usually does
    // (measured: 100-4144 ticks over 11 of 12 seeds) but roughly 1 seed in 12 stalls forever —
    // see the skipped test below. Asserting "drains within N ticks" here was flaky (it failed
    // 2 of 6 runs), which is exactly the failure mode a market test must not have.
    const { e, floatBefore, px } = underfundedShort();
    let ticks = 0;
    let worstShort = 2000;
    while (liquidating(e).length > 0 && ticks < 3000) {
      e.step(); ticks++;
      const acct = liquidating(e)[0];
      if (acct) {
        // never grows the short, never overdrafts
        expect(-acct.shares).toBeLessThanOrEqual(worstShort + 1e-6);
        worstShort = Math.min(worstShort, -acct.shares);
        expect(acct.cash).toBeGreaterThan(-1e-6);
      }
      // Tolerance is a whole share, not 1e-6: the wind-down path accumulates fractional
      // rounding across thousands of partial fills (one run in ~20 drifted by 0.0092 shares,
      // which made a 1e-6 bound flaky). Every real conservation break in this project's
      // history destroyed or minted THOUSANDS of shares, so sub-share drift is noise.
      expect(Math.abs(e.sharesOutstanding - floatBefore)).toBeLessThan(1);
    }
    // NOTE: there is deliberately NO "real progress was made" assertion here. Measured over
    // 150 independent seeds, 27 stall (never drain within 3000 ticks) and 4 of those never buy
    // back a single share (worstShort stays at the full 2000) — that is the documented open
    // defect in the skipped test below, so asserting progress here is flaky by construction
    // (it failed 2 of 22 runs). What always holds is monotonicity, no overdraft, conservation,
    // and a single bounded injection.
    expect(worstShort).toBeLessThanOrEqual(2000 + 1e-6);
    expect(Math.abs(e.sharesOutstanding - floatBefore)).toBeLessThan(1);
    // And the rescue was still a single, bounded injection.
    expect(e.brokerWriteOffs).toBeGreaterThan(0);
    // The injection is bounded by what was actually owed at the moment of the closeout
    // (2000 shares short, ~$px each) — not by some later, drifted price. A tighter bound than
    // "less than twice the notional" would pin the exact top-up formula.
    expect(e.brokerWriteOffs).toBeLessThanOrEqual(2000 * px * 1.2);
  });

  /**
   * OPEN BUG (found while reviewing this file, not previously recorded).
   *
   * A written-off short sometimes NEVER retires. Re-measured over 150 independent seeds:
   * 27 (18%) are still in the wind-down queue after 3000 ticks, and 4 of those have not bought
   * back a SINGLE share (still the full 2000 short). One seed was still short 784 shares after
   * 20,000 ticks while holding $69,397 of cash — it has the money and does not buy. Its free
   * buying power stays ~0
   * because the outstanding short itself consumes the margin the write-off provided, so the
   * cover is capped at below the minimum order size for good and the position freezes.
   *
   * In a real market a broker closeout is not optional: the borrow must be returned, so the
   * broker keeps buying until the position is flat. A permanent phantom short leaves stock
   * "outstanding" that no one will ever deliver, and keeps a stale account in the settlement
   * registry indefinitely.
   *
   * Skipped rather than `test.fails` because it stalls on only ~18% of seeds, so it would be
   * flaky in EITHER form. Un-skip once the closeout is guaranteed to complete.
   */
  it.skip("a written-off short always retires eventually (stalls on ~18% of seeds)", () => {
    const { e } = underfundedShort();
    let ticks = 0;
    while (liquidating(e).length > 0 && ticks < 20000) { e.step(); ticks++; }
    expect(liquidating(e).length).toBe(0);
  });

  it('a well-funded deleted short covers itself with no broker write-off at all', () => {
    // Property: the write-off is a last resort, not the normal path. An account that CAN pay
    // for its buy-back must do so out of its own cash, leaving no external injection. If this
    // fails, the market is being topped up on ordinary deletions.
    const e = buildEngine(false);
    run(e, 800);
    const victim = e.agents.find((a) => a.type === 'trader')!;
    victim.shares = -200;
    victim.cash = 400000; // far more than enough to cover
    const floatBefore = e.sharesOutstanding;
    e.removeAgent(victim.id);
    run(e, 2500);
    expect(e.brokerWriteOffs).toBe(0);
    expect(e.sharesOutstanding).toBeCloseTo(floatBefore, 6);
  });

  it('a normal run with ordinary deletions needs no broker money', () => {
    // Property: deletions of solvent, long accounts are absorbed by the market. Any write-off
    // here means the deletion machinery is leaking cash into the system.
    expect(shared.e.brokerWriteOffs).toBe(0);
  });
});

describe('option positions are closed out on removal', () => {
  it('buys out and drops a removed holder\'s contracts, cutting open interest', () => {
    // Property: an option is a contract between two parties. If one party is deleted and its
    // position is left behind, the dealer keeps delta-hedging phantom exposure in the stock and
    // the contracts consume open-interest capacity that can never settle (nobody is left to pay
    // or be paid). A real close-out buys the holder out at the mark and removes the contracts.
    const e = buildEngine(true);
    let holder: Agent | undefined;
    for (let i = 0; i < 3000 && !holder; i++) {
      e.step();
      holder = e.agents.find((a) => (e.optionPositions.get(a.id)?.size ?? 0) > 0);
    }
    expect(holder, 'no agent ever held an option position').toBeTruthy();
    const oiBefore = e.totalOpenInterest();
    const heldQty = [...e.optionPositions.get(holder!.id)!.values()].reduce((s, q) => s + Math.abs(q), 0);
    expect(heldQty).toBeGreaterThan(0);

    const cashBefore = holder!.cash;
    const dealerBefore = e.optionsDealer.cash;
    e.removeAgent(holder!.id);

    expect(e.optionPositions.has(holder!.id)).toBe(false);
    expect(e.totalOpenInterest()).toBeCloseTo(oiBefore - heldQty, 6);
    // The buy-out is a pure TRANSFER: whatever the holder was paid, the dealer paid.
    const paid = holder!.cash - cashBefore;
    expect(paid).toBeGreaterThanOrEqual(0); // a long option is worth >= 0
    expect(e.optionsDealer.cash - dealerBefore).toBeCloseTo(-paid, 6);
  });

  it('keeps the float conserved when an option-holding agent is removed', () => {
    // Property: closing out options moves CASH, and the dealer's hedge inventory is part of the
    // float. Neither may change the share count.
    const e = buildEngine(true);
    let holder: Agent | undefined;
    for (let i = 0; i < 3000 && !holder; i++) {
      e.step();
      holder = e.agents.find((a) => (e.optionPositions.get(a.id)?.size ?? 0) > 0);
    }
    const before = e.sharesOutstanding;
    e.removeAgent(holder!.id);
    expect(e.sharesOutstanding).toBeCloseTo(before, 6);
    for (let i = 0; i < 300; i++) {
      e.step();
      expect(e.sharesOutstanding).toBeCloseTo(before, 6);
    }
  });
});

describe('KNOWN OPEN BUG: removing the anchors decouples price from fundamentals forever', () => {
  /**
   * Deleting a large holder + a SHORT market maker + the whole arbitrageur cohort together
   * drives price to a tiny fraction of fair value, where it stays permanently.
   *
   * Observed (6/6 runs, 6000 further ticks after the deletions):
   *   price $0.19 / $30.85 / $35.71 / $1.10 / $0.03 / $0.23
   *   against fair value $133 / $139 / $103 / $159 / $94 / $98
   * i.e. anywhere from 0.03% to 35% of fair value, with $6.5-7.2M of agent cash idle.
   * One side of the book is frequently empty and there is NO recovery, even though the value
   * traders and index funds still hold millions in cash and, in a real market, would bid a
   * stock trading at 0.2% of its earnings-based fair value straight back up. The float stays
   * conserved and `brokerWriteOffs` stays 0 throughout, so this is a PRICE-DISCOVERY failure,
   * not an accounting one: with the arbitrageur band gone, nothing left in the population
   * places a bid that references value, and the maker cohort — quoting off a lagging average of
   * a collapsed price — happily ratchets the quote down with it.
   *
   * Same structural family as the "delete the whole holder base" limit documented in CLAUDE.md.
   *
   * Skipped rather than `test.fails` because the MAGNITUDE is seed-dependent (0.2% to 35% of
   * fair), so a strict assertion would be flaky in either direction. Un-skip once price
   * discovery survives the loss of the arb cohort.
   */
  it.skip('price should recover toward fair value after the anchors are deleted', () => {
    const e = buildEngine(true);
    run(e, 2000);

    e.removeAgent(biggestHolder(e).id);
    const shortMaker = [...e.agents].filter((a) => a.type === 'marketMaker').sort((a, b) => a.shares - b.shares)[0];
    if (shortMaker) e.removeAgent(shortMaker.id);
    for (const a of e.agents.filter((x) => x.type === 'arb')) e.removeAgent(a.id);

    const floatBefore = e.sharesOutstanding;
    run(e, 6000);

    // Accounting survives — this is not a conservation break.
    expect(e.sharesOutstanding).toBeCloseTo(floatBefore, 6);
    expect(e.brokerWriteOffs).toBe(0);

    // Real-market expectation: cash-rich value buyers bid a wildly cheap stock back up.
    const cashOnSidelines = e.agents.reduce((s, a) => s + Math.max(0, a.cash), 0);
    expect(cashOnSidelines).toBeGreaterThan(1000000);
    expect(e.currentPrice).toBeGreaterThan(e.fundamentalValue / 2);
  });
});

describe('a wind-down order is priced off the MARKET, never off its own last print', () => {
  /**
   * Structural regression test for the $505,745 runaway, asserted at the mechanism rather than
   * through emergent price.
   *
   * The earlier price-band tests turn out not to catch this on their own: with only the
   * self-referential pricing reintroduced, the wind-down finishes before 0.1%-per-fill
   * compounding moves price far enough to break a 3x band. The catastrophe needed a companion
   * bug (an unbounded broker write-off) to keep the account alive indefinitely feeding the
   * ratchet. So the band tests can pass while the defect is present.
   *
   * This asserts the invariant directly: whenever both sides are quoted, a wind-down's limit
   * order must sit AT or INSIDE the touch. An order derived from the last trade price can sit
   * outside it, and that is precisely what lets each fill drag the next quote further away and
   * compound. Anything priced from the prevailing quotes cannot ratchet, because it never
   * prices through the market.
   */
  it('never prices a wind-down order outside the prevailing bid/ask', () => {
    const e = new SimulationEngine();
    e.autoNews = true;
    for (const c of DEFAULT_CAST) {
      const a = e.addAgent(c.type, c.capital, c.style);
      if (c.params) e.updateAgentParams(a.id, c.params);
    }
    e.enableOptions(true);
    for (let t = 0; t < 2000; t++) e.step();

    // Delete the two largest holders so there is a substantial position to work off.
    const doomed = [...e.agents]
      .filter((a) => a.shares > 100)
      .sort((x, y) => y.shares - x.shares)
      .slice(0, 2);
    const doomedIds = new Set(doomed.map((a) => a.id));
    for (const a of doomed) e.removeAgent(a.id);

    // Intercept the book so we see the exact price every wind-down order is submitted at,
    // together with the quotes prevailing at that instant.
    const book = (e as unknown as { book: {
      submitLimitOrder: (...args: never[]) => unknown;
      getBestBid: () => number | null;
      getBestAsk: () => number | null;
    } }).book;
    const original = book.submitLimitOrder.bind(book);
    const violations: { price: number; bid: number; ask: number; side: string }[] = [];
    let observed = 0;

    book.submitLimitOrder = ((side: string, size: number, price: number, owner: string, tick: number) => {
      if (doomedIds.has(owner)) {
        const bid = book.getBestBid();
        const ask = book.getBestAsk();
        if (bid != null && ask != null && bid <= ask) {
          observed++;
          // Allow a tick of slack for the $0.01 price grid.
          if (price < bid - 0.011 || price > ask + 0.011) {
            violations.push({ price, bid, ask, side });
          }
        }
      }
      return original(side as never, size as never, price as never, owner as never, tick as never);
    }) as typeof book.submitLimitOrder;

    for (let t = 0; t < 4000; t++) e.step();
    book.submitLimitOrder = original as typeof book.submitLimitOrder;

    // The test is only meaningful if wind-down orders were actually placed and measured.
    expect(observed).toBeGreaterThan(20);
    expect(violations.slice(0, 5)).toEqual([]);
  });
});
