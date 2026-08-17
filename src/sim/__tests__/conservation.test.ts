// @ts-expect-error - the app tsconfig doesn't pull in node's types; tests run under vitest/node.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { applyTrade } from '../agents';
import { DEFAULT_CAST } from '../defaultCast';
import { SimulationEngine } from '../engine';
import type { AgentAccount } from '../types';

/**
 * CONSERVATION AND ACCOUNTING.
 *
 * A market is a closed system with a small number of declared doors. Shares only move between
 * holders; cash only enters or leaves through three named channels (dividends in, taker fees
 * out, broker write-offs in). Every historical bug in this file's blast radius — a deleted
 * agent's shares vaporising, a short's cover being paid with money that did not exist, a
 * write-off re-firing every tick — showed up first as one of these identities drifting.
 *
 * These tests therefore assert IDENTITIES and BOUNDS, never prices.
 */

// ---------------------------------------------------------------- helpers

/** The engine keeps wound-down-but-not-yet-flat accounts in a private list; they still hold
 *  stock and cash, so every conservation sum has to include them. */
function liquidationsOf(e: SimulationEngine): AgentAccount[] {
  return (e as unknown as { liquidations: AgentAccount[] }).liquidations;
}

/** Every cash-holding account inside the participant system. */
function cashPool(e: SimulationEngine): number {
  return e.agents.reduce((s, a) => s + a.cash, 0)
    + liquidationsOf(e).reduce((s, a) => s + a.cash, 0)
    + e.user.cash + e.optionsDealer.cash;
}

function allAccounts(e: SimulationEngine): AgentAccount[] {
  return [...e.agents, ...liquidationsOf(e), e.user, e.optionsDealer];
}

function buildEngine(options = false): SimulationEngine {
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

interface CashSnapshot { pool: number; div: number; fees: number; writeOffs: number }

function snapshot(e: SimulationEngine): CashSnapshot {
  return { pool: cashPool(e), div: e.totalDividendsPaid, fees: e.totalFeesPaid, writeOffs: e.brokerWriteOffs };
}

/** The one legal cash identity: since the snapshot, the pool may only have changed by
 *  dividends in, fees out and broker write-offs in. Returns the residual, which must be ~0. */
function cashResidual(e: SimulationEngine, s: CashSnapshot): number {
  const expected = s.pool
    + (e.totalDividendsPaid - s.div)
    - (e.totalFeesPaid - s.fees)
    + (e.brokerWriteOffs - s.writeOffs);
  return cashPool(e) - expected;
}

// ---------------------------------------------------------------- applyTrade

describe('applyTrade: position and P&L arithmetic', () => {
  // Property: a trade moves shares from seller to buyer and cash the other way, with no
  // leakage. If this leaks, every higher-level conservation law is already broken.
  it('moves exactly `size` shares and `price*size` of cash between the two sides', () => {
    const buyer: AgentAccount = { startingCapital: 1000, cash: 1000, shares: 0, avgCost: 0, realizedPnl: 0, tradeCount: 0 };
    const seller: AgentAccount = { startingCapital: 1000, cash: 0, shares: 10, avgCost: 5, realizedPnl: 0, tradeCount: 0 };
    applyTrade(buyer, 'buy', 20, 4);
    applyTrade(seller, 'sell', 20, 4);
    expect(buyer.shares + seller.shares).toBeCloseTo(10, 9);
    expect(buyer.cash + seller.cash).toBeCloseTo(1000, 9);
    expect(buyer.shares).toBeCloseTo(4, 9);
  });

  // Property: average cost is a weighted average while a position is being built, so
  // unrealized P&L is honest. A wrong avgCost silently misstates every agent's equity.
  it('blends average cost while adding to a long, and realizes P&L only on the closing part', () => {
    const a: AgentAccount = { startingCapital: 0, cash: 0, shares: 0, avgCost: 0, realizedPnl: 0, tradeCount: 0 };
    applyTrade(a, 'buy', 10, 10);
    applyTrade(a, 'buy', 20, 10);
    expect(a.avgCost).toBeCloseTo(15, 9);
    applyTrade(a, 'sell', 25, 5); // partial close
    expect(a.realizedPnl).toBeCloseTo((25 - 15) * 5, 9);
    expect(a.avgCost).toBeCloseTo(15, 9); // unchanged by a partial close
    expect(a.shares).toBeCloseTo(15, 9);
  });

  // Property: a short is the mirror image — it profits when price falls. Getting the sign
  // wrong here would make shorting a free money machine.
  it('realizes short P&L with the opposite sign', () => {
    const a: AgentAccount = { startingCapital: 0, cash: 0, shares: 0, avgCost: 0, realizedPnl: 0, tradeCount: 0 };
    applyTrade(a, 'sell', 100, 10); // open short
    expect(a.shares).toBeCloseTo(-10, 9);
    expect(a.avgCost).toBeCloseTo(100, 9);
    applyTrade(a, 'buy', 90, 10); // cover lower => profit
    expect(a.shares).toBe(0);
    expect(a.realizedPnl).toBeCloseTo(100, 9);
    expect(a.avgCost).toBe(0); // flat position carries no cost basis
  });

  // Property: an order that flips through zero closes the old position and opens a fresh one
  // at the fill price. Otherwise the new position inherits a meaningless basis.
  it('closes the old position and re-bases when a trade flips through zero', () => {
    const a: AgentAccount = { startingCapital: 0, cash: 0, shares: 5, avgCost: 10, realizedPnl: 0, tradeCount: 0 };
    applyTrade(a, 'sell', 12, 8); // 5 long closed, 3 short opened
    expect(a.shares).toBeCloseTo(-3, 9);
    expect(a.realizedPnl).toBeCloseTo((12 - 10) * 5, 9);
    expect(a.avgCost).toBeCloseTo(12, 9);
  });

  // Property: cash is a pure function of the fills, independent of direction bookkeeping —
  // a sell always credits, a buy always debits, including for shorts.
  it('credits cash on every sell and debits on every buy, short or long', () => {
    const a: AgentAccount = { startingCapital: 0, cash: 0, shares: 0, avgCost: 0, realizedPnl: 0, tradeCount: 0 };
    applyTrade(a, 'sell', 50, 3);
    expect(a.cash).toBeCloseTo(150, 9);
    applyTrade(a, 'buy', 40, 3);
    expect(a.cash).toBeCloseTo(30, 9);
    expect(a.tradeCount).toBe(2);
  });
});

// ---------------------------------------------------------------- share conservation

describe('share conservation', () => {
  // Property: the float is fixed. No mechanism in a secondary market creates or destroys
  // shares, so `sharesOutstanding` must be invariant tick over tick — through trades, stop
  // cascades, margin calls, option settlement and dealer hedging.
  it('keeps the float exactly constant over a long run with options live', () => {
    const e = buildEngine(true);
    const start = e.sharesOutstanding;
    expect(start).toBeGreaterThan(0);
    for (let i = 0; i < 4000; i++) {
      e.step();
      expect(Math.abs(e.sharesOutstanding - start)).toBeLessThan(1e-6);
    }
  });

  // Property (regression: deleting an agent destroyed its shares). A fund closing down does
  // not retire stock — someone still owns it until it is sold. The float must be unchanged at
  // the instant of removal and at every tick of the wind-down.
  it('does not destroy shares when an agent is deleted mid-run', () => {
    const e = buildEngine();
    run(e, 800);
    const before = e.sharesOutstanding;
    // Delete the largest holder — the worst case for the wind-down machinery.
    const biggest = [...e.agents].sort((x, y) => y.shares - x.shares)[0];
    expect(biggest.shares).toBeGreaterThan(0);
    e.removeAgent(biggest.id);
    expect(e.agents.find((a) => a.id === biggest.id)).toBeUndefined();
    expect(Math.abs(e.sharesOutstanding - before)).toBeLessThan(1e-6);
    for (let i = 0; i < 1200; i++) {
      e.step();
      expect(Math.abs(e.sharesOutstanding - before)).toBeLessThan(1e-6);
    }
  });

  // Property: an entrant brings its own capital and its own share of the float; it cannot
  // materialise shares out of the existing holders' pockets. And an all-cash entrant (the
  // realistic case for a new fund) must buy in from the market instead.
  it('issues exactly the entrant\'s seeded shares and nothing for an all-cash entrant', () => {
    const e = buildEngine();
    run(e, 200);
    const px = e.currentPrice;

    const before = e.sharesOutstanding;
    const a = e.addAgent('trader', 400000, 'value');
    expect(a.shares).toBeCloseTo(400000 / 2 / px, 6); // half cash, half stock
    expect(e.sharesOutstanding - before).toBeCloseTo(a.shares, 6);

    const before2 = e.sharesOutstanding;
    const b = e.addAgent('trader', 400000, 'value', true);
    expect(b.shares).toBe(0);
    expect(e.sharesOutstanding).toBeCloseTo(before2, 6);
  });

  // Property: each archetype's seeding matches its mandate — a passive fund exists to HOLD
  // stock, an arbitrageur starts with none and must buy in, so no cohort is handed a position
  // it would never have acquired. (Regression: option speculators seeded holding stock they
  // never trade polluted their P&L.)
  it('seeds each archetype with the share/cash split its mandate implies', () => {
    const e = new SimulationEngine();
    const px = e.currentPrice;
    const frac = (cap: number, shares: number) => (shares * px) / cap;
    // Bands, not the tuned constants: what must hold is the MANDATE (passive money is nearly
    // fully invested, a whale keeps most of its capital dry to accumulate with, an arbitrageur
    // and an options speculator start with no stock at all, a maker is roughly balanced so it
    // can quote both sides). Retuning 0.95 -> 0.93 is legitimate; inverting a mandate is not.
    const idx = frac(1000000, e.addAgent('indexFund', 1000000).shares);
    const hold = frac(1000000, e.addAgent('holder', 1000000).shares);
    const whale = frac(1000000, e.addAgent('whale', 1000000).shares);
    const maker = frac(1000000, e.addAgent('marketMaker', 1000000).shares);
    expect(idx).toBeGreaterThan(0.85);
    expect(idx).toBeLessThanOrEqual(1);
    expect(hold).toBeGreaterThan(0.85);
    expect(hold).toBeLessThanOrEqual(1);
    expect(whale).toBeLessThan(0.3); // mostly dry powder
    expect(whale).toBeGreaterThan(0);
    expect(maker).toBeGreaterThan(0.25); // inventory to sell from...
    expect(maker).toBeLessThan(0.75); // ...and cash to bid with
    expect(e.addAgent('arb', 1000000).shares).toBe(0);
    expect(e.addAgent('speculator', 100000).shares).toBe(0);
  });

  // Property: shares are only ever transferred, so the sum of every trade's signed size per
  // owner must reconcile to each account's position change. This is the ledger-level version
  // of the float invariant and catches settlement that misses one side.
  it('reconciles every account\'s position change against the trade tape', () => {
    const e = buildEngine();
    run(e, 100); // warm up so the tape is representative
    const labelled = (): [string, AgentAccount][] => [
      ...e.agents.map((a) => [a.id, a as AgentAccount] as [string, AgentAccount]),
      ...liquidationsOf(e).map((a) => [(a as unknown as { id: string }).id, a] as [string, AgentAccount]),
      ['user', e.user], ['optionsDealer', e.optionsDealer],
    ];
    const posBefore = new Map(labelled().map(([id, a]) => [id, a.shares]));
    const delta = new Map<string, number>();
    for (let i = 0; i < 40; i++) {
      for (const t of e.step()) {
        delta.set(t.buyerId, (delta.get(t.buyerId) ?? 0) + t.size);
        delta.set(t.sellerId, (delta.get(t.sellerId) ?? 0) - t.size);
        expect(t.buyerId).not.toBe(t.sellerId); // nobody trades with themselves
        expect(t.size).toBeGreaterThan(0);
        expect(t.price).toBeGreaterThan(0);
      }
    }
    for (const [id, a] of labelled()) {
      const expected = (posBefore.get(id) ?? 0) + (delta.get(id) ?? 0);
      expect(Math.abs(a.shares - expected)).toBeLessThan(1e-6);
    }
  });
});

// ---------------------------------------------------------------- fees

describe('trade cash flows', () => {
  // Property: a trade is a transfer. The only cash that leaves the participant system is the
  // taker fee (it goes to the broker/exchange). Anything else is fabricated money.
  it('is cash-neutral apart from the taker fee, and the fee is charged to the aggressor only', () => {
    const e = new SimulationEngine();
    const maker = e.addAgent('marketMaker', 200000);
    e.feeBps = 5;
    const px = e.currentPrice;
    // Maker rests an offer; the user lifts it, so the USER is the aggressor.
    e.book.submitLimitOrder('sell', 10, px, maker.id, 0);
    const poolBefore = maker.cash + e.user.cash;
    const makerCashBefore = maker.cash;
    e.queueUserOrder('buy', 10);
    e.flushUserOrders();
    const traded = e.trades[e.trades.length - 1];
    expect(traded.size).toBeCloseTo(10, 6);
    const fee = traded.price * 10 * 5 / 10000;
    expect(e.totalFeesPaid).toBeCloseTo(fee, 6);
    // The passive side receives the full notional; only the taker is docked.
    expect(maker.cash - makerCashBefore).toBeCloseTo(traded.price * 10, 6);
    expect(maker.cash + e.user.cash).toBeCloseTo(poolBefore - fee, 6);
  });

  // Property: with fees switched off the market is a strictly closed cash loop (no dividends
  // either). Any drift then is pure fabrication.
  it('conserves cash EXACTLY when fees and dividends are switched off', () => {
    const e = buildEngine();
    e.feeBps = 0;
    e.dividendYieldPct = 0;
    const pool = cashPool(e);
    run(e, 1500);
    expect(e.totalFeesPaid).toBe(0);
    expect(e.totalDividendsPaid).toBe(0);
    expect(Math.abs(cashPool(e) - pool)).toBeLessThan(1e-6 * Math.abs(pool));
  });
});

// ---------------------------------------------------------------- the cash identity

describe('the cash identity', () => {
  // Property: THE accounting law of the whole simulation. Cash may only enter via dividends
  // and broker write-offs, and only leave via fees. Every other mechanism (trades, options,
  // margin calls, wind-downs) is an internal transfer. A non-zero residual means money is
  // being conjured somewhere, which silently inflates the market.
  it('holds over a long run with options, dividends and fees all live', () => {
    const e = buildEngine(true);
    const snap = snapshot(e);
    run(e, 4000);
    expect(e.totalFeesPaid).toBeGreaterThan(0);
    expect(e.totalDividendsPaid).toBeGreaterThan(0);
    expect(Math.abs(cashResidual(e, snap))).toBeLessThan(1e-6 * snap.pool);
  });

  // Property: option premiums, expiry payouts and close-outs are zero-sum against the dealer.
  // Turning the market off must not leave (or create) cash anywhere.
  it('is unaffected by enabling, trading and disabling the option market', () => {
    const e = buildEngine(true);
    const snap = snapshot(e);
    run(e, 1200);
    // Trade some contracts as the user, then close the whole market out.
    const chain = e.getOptionChain();
    expect(chain.length).toBeGreaterThan(0);
    e.tradeOption(chain[0].id, 2);
    run(e, 300);
    e.enableOptions(false);
    expect(e.totalOpenInterest()).toBe(0);
    expect(Math.abs(cashResidual(e, snap))).toBeLessThan(1e-6 * snap.pool);
  });

  // Property: no participant is ever left holding fabricated (negative) cash. Buying power is
  // capped by equity, so an account can be broke but never overdrawn without a recorded
  // broker write-off.
  it('never leaves an account overdrawn without a recorded write-off', () => {
    const e = buildEngine(true);
    run(e, 3000);
    expect(e.brokerWriteOffs).toBe(0); // no deletions => no closeouts => no injections
    for (const a of allAccounts(e)) expect(a.cash).toBeGreaterThan(-1e-6);
  });
});

// ---------------------------------------------------------------- dividends

describe('dividends', () => {
  // Property: a dividend is external income paid per share, quarterly. It is the only routine
  // cash inflow, so its size must equal exactly shares × per-share — no more.
  it('pays every holder per share on the quarterly schedule and nothing in between', () => {
    const e = new SimulationEngine();
    const holder = e.addAgent('holder', 1000000);
    e.dividendYieldPct = 2;
    e.feeBps = 0;
    const cashBefore = holder.cash;
    run(e, 199);
    expect(e.totalDividendsPaid).toBe(0); // nothing before the report tick
    expect(holder.cash).toBeCloseTo(cashBefore, 6);
    const px = e.currentPrice;
    e.step(); // tick 200
    const perShare = (2 / 100) * px / 4;
    expect(e.totalDividendsPaid).toBeCloseTo(e.sharesOutstanding * perShare, 6);
    expect(holder.cash - cashBefore).toBeCloseTo(holder.shares * perShare, 6);
  });

  // Property: a short seller has borrowed the stock, so it OWES the dividend. If shorts were
  // paid (or exempt) shorting would carry a free carry advantage.
  // A short seller that also TRADES loses cash for trading reasons too, so the dividend has to
  // be isolated: reconcile the account's cash against its own fills from the tape, and the only
  // unexplained movement on the dividend tick must be exactly −shares × perShare.
  it('charges the dividend to a short position', () => {
    const e = buildEngine();
    e.dividendYieldPct = 4;
    e.feeBps = 0;
    const short = e.addAgent('trader', 500000, 'value');
    short.shares = -100;
    short.avgCost = e.currentPrice;
    // Tape-implied cash flow for this account: sells credit, buys debit (fees are off).
    const tapeCash = (trades: { buyerId: string; sellerId: string; price: number; size: number }[]) =>
      trades.reduce((s, t) => s
        + (t.sellerId === short.id ? t.price * t.size : 0)
        - (t.buyerId === short.id ? t.price * t.size : 0), 0);

    let tape = 0;
    const cash0 = short.cash;
    for (let i = 0; i < 199; i++) tape += tapeCash(e.step());
    // No dividend yet: cash is fully explained by the tape.
    expect(Math.abs(short.cash - (cash0 + tape))).toBeLessThan(1e-6 * Math.abs(cash0));
    expect(e.totalDividendsPaid).toBe(0);

    // The trader may well have covered by now, so re-impose the short right before the payment.
    short.shares = -100;
    short.avgCost = e.currentPrice;
    const sharesAtDiv = short.shares;
    const perShare = (4 / 100) * e.currentPrice / 4; // priced off the last print before the tick
    const cashBefore = short.cash;
    tape = tapeCash(e.step()); // tick 200: the dividend tick
    const unexplained = short.cash - cashBefore - tape;
    expect(unexplained).toBeCloseTo(sharesAtDiv * perShare, 6); // negative: the short OWES it
    expect(unexplained).toBeLessThan(0);
  });

  // Property: a dividend is paid out of earnings, so it distributes cash without changing the
  // company's earning power — fair value (= EPS × multiple) must not move on a dividend tick.
  // Otherwise the payout would look like a repricing of the business.
  // Property: paying a dividend distributes cash without consuming earning power, so it must
  // not reprice the business. The dividend tick coincides with the earnings report, so a
  // single-engine before/after cannot separate them; instead run two engines DIFFERING ONLY in
  // yield with Math.random pinned, past two dividend ticks, and require the fundamental path to
  // be bit-identical. If the payout touched EPS, the fundamental or the multiple, the two paths
  // would separate at the first payment.
  it('does not move EPS or fair value', () => {
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const paying = buildEngine();
      const notPaying = buildEngine();
      paying.dividendYieldPct = 6;
      notPaying.dividendYieldPct = 0;
      for (const e of [paying, notPaying]) e.autoNews = false;
      expect(paying.eps).toBe(notPaying.eps);

      run(paying, 420); // two dividend/earnings ticks
      run(notPaying, 420);

      expect(paying.totalDividendsPaid).toBeGreaterThan(0); // the mechanism really fired
      expect(notPaying.totalDividendsPaid).toBe(0);
      expect(paying.eps).toBe(notPaying.eps);
      expect(paying.consensusEps).toBe(notPaying.consensusEps);
      expect(paying.valuationMultiple).toBe(notPaying.valuationMultiple);
      expect(paying.fundamentalValue).toBe(notPaying.fundamentalValue);
      expect(paying.consensusValue).toBe(notPaying.consensusValue);
    } finally {
      rand.mockRestore();
    }
  });

  /**
   * KNOWN DEFECT (documented, not fixed here).
   *
   * Real-market property: the dividend is paid to the HOLDER OF RECORD, whoever that is, and
   * the reported total distribution must equal the cash that actually reached shareholders.
   *
   * The engine pays `agents`, `user` and `optionsDealer`, but NOT the wind-down accounts in the
   * private `liquidations` list — even though `sharesOutstanding` (and hence
   * `totalDividendsPaid`) counts their shares. A deleted-but-not-yet-flat holder therefore:
   *   (a) gets no dividend on stock it still legally owns, and
   *   (b) makes `totalDividendsPaid` OVERSTATE the cash injected, by that account's share of
   *       the payment. Measured: a wind-down account holding 12,274 of ~124k shares made the
   *       cash identity's residual −$5,740 on a $56,847 distribution (~10% overstated).
   * The direction is safe (the ledger claims more cash entered than did, so it can't hide
   * fabricated money) but the accounting is wrong, and it makes the cash identity unusable as
   * a check for exactly the scenario — agent deletion — that has produced the most bugs here.
   */
  it.fails('pays the dividend to wind-down accounts that still hold the stock', () => {
    const e = buildEngine();
    e.feeBps = 0;
    e.dividendYieldPct = 2;
    run(e, 100);
    const biggest = [...e.agents].sort((x, y) => y.shares - x.shares)[0];
    e.removeAgent(biggest.id);
    const winding = liquidationsOf(e)[0];
    expect(winding.shares).toBeGreaterThan(0);
    const snap = snapshot(e);
    run(e, 105); // crosses the tick-200 dividend
    expect(e.totalDividendsPaid).toBeGreaterThan(snap.div);
    expect(Math.abs(cashResidual(e, snap))).toBeLessThan(1e-6 * snap.pool);
  });
});

// ---------------------------------------------------------------- broker write-offs

describe('broker write-offs when a blown-up short is closed out', () => {
  /** An account with a short it cannot possibly fund, then deleted. */
  function blownUpShort(): { e: SimulationEngine; acct: AgentAccount } {
    const e = buildEngine();
    e.dividendYieldPct = 0; // isolate the closeout as the only cash inflow
    run(e, 400);
    const a = e.addAgent('trader', 100000, 'value');
    a.shares = -400; // borrowed far more stock than the cash can cover
    a.cash = 50;
    e.removeAgent(a.id);
    return { e, acct: a };
  }

  // Property (regression: a winding-down short bought back stock it could not afford and its
  // cash went to −$664k). Real cash cannot be spent twice: either the account funds the cover,
  // or the broker eats the shortfall — and that injection must be VISIBLE, not silent.
  it('records the shortfall in brokerWriteOffs instead of letting cash go negative', () => {
    const { e, acct } = blownUpShort();
    const snap = snapshot(e);
    // Step 50 ticks, but track the cash that leaves with the fund when it finally goes flat and
    // retires from the queue: that WITHDRAWAL is legitimate (the fund takes its money home) but
    // the engine records it nowhere, so the identity below has to account for it explicitly.
    // Measured: the account retires inside this window on ~8% of seeds, carrying $1300–1800 —
    // which is exactly how this assertion came to flake (2 failures in 10 full-suite runs).
    let withdrawn = 0;
    for (let i = 0; i < 50; i++) {
      const before = [...liquidationsOf(e)];
      e.step();
      const still = new Set(liquidationsOf(e));
      // Read `a.cash` AFTER the step: the account trades and then retires within the same tick,
      // so its post-step balance is the amount that actually left the market.
      for (const a of before) if (!still.has(a)) withdrawn += a.cash;
    }
    expect(e.brokerWriteOffs).toBeGreaterThan(0);
    // Tolerance is a dollar, not 1e-6: ordinary operation leaves cent-scale overdrafts because
    // the taker fee is charged after a size has been computed against available cash (measured
    // worst case −$0.11; a −1e-6 bound flaked once in 6 full-suite runs). The bug this guards
    // against was a −$664,000 balance, so a $1 floor is six orders of magnitude away from it.
    expect(acct.cash).toBeGreaterThan(-1);
    let totalNegative = 0;
    for (const a of allAccounts(e)) {
      expect(a.cash).toBeGreaterThan(-1);
      totalNegative += Math.min(0, a.cash);
    }
    // In aggregate, nobody is quietly funding purchases out of an overdraft.
    expect(totalNegative).toBeGreaterThan(-100);
    // And the injection is exactly accounted for by the identity: pool change = dividends in
    // − fees out + write-offs in − cash withdrawn by a retiring fund. Nothing else.
    expect(Math.abs(cashResidual(e, snap) + withdrawn)).toBeLessThan(1e-6 * snap.pool);
  });

  // Property (regression: the write-off re-fired every tick => unbounded cash injection).
  // A closeout happens ONCE per account. A repeating injection is a money printer that
  // inflates the whole market for as long as the account exists.
  it('injects cash exactly once, not every tick', () => {
    const { e } = blownUpShort();
    run(e, 5);
    const firstInjection = e.brokerWriteOffs;
    expect(firstInjection).toBeGreaterThan(0);
    run(e, 600);
    expect(e.brokerWriteOffs).toBeCloseTo(firstInjection, 6);
  });

  // Property: a solvent account winding down a short needs no help at all — the broker only
  // steps in for a genuine blow-up. And when the fund finally retires, the cash it takes with
  // it is a WITHDRAWAL: the pool may only shrink, and only by that account's remaining cash.
  // Cash must never be created on the way out.
  it('needs no write-off when the winding-down short can fund its own cover', () => {
    const e = buildEngine();
    e.dividendYieldPct = 0; // isolate: the only cash movements are fees out and the fund leaving
    run(e, 400);
    const a = e.addAgent('trader', 800000, 'value');
    a.shares = -20;
    a.cash = 800000; // amply collateralized
    e.removeAgent(a.id);
    const snap = snapshot(e);
    run(e, 1500);
    expect(e.brokerWriteOffs).toBe(0);
    expect(Math.abs(a.shares)).toBeLessThan(0.01); // covered in full
    expect(liquidationsOf(e).length).toBe(0); // the wind-down finished
    // The residual is exactly the retired fund's own cash walking out of the market.
    expect(cashResidual(e, snap)).toBeCloseTo(-a.cash, 4);
    expect(cashResidual(e, snap)).toBeLessThanOrEqual(1e-6); // never MORE cash than accounted for
  });

  // Property: shares stay conserved even through the ugliest path — an unfundable short being
  // closed out. An accounting failure must never be "fixed" by quietly retiring stock.
  it('keeps the float conserved throughout an unfundable closeout', () => {
    const { e } = blownUpShort();
    const float = e.sharesOutstanding;
    for (let i = 0; i < 300; i++) {
      e.step();
      expect(Math.abs(e.sharesOutstanding - float)).toBeLessThan(1e-6);
    }
  });
});

// ---------------------------------------------------------------- one cast, two consumers

describe('one population definition (regression: the eval graded a different market)', () => {
  // Property: the app and the headless eval harness must simulate the IDENTICAL market. When
  // the cast was written out twice they drifted (6 holders vs 3, a stray extra desk), so every
  // tuning number was measured against a market nobody was running.
  it('has the app and the eval harness both seed from DEFAULT_CAST', () => {
    const hook = readFileSync(new URL('../../hooks/useSimulation.ts', import.meta.url), 'utf8');
    const evalHarness = readFileSync(new URL('../../../scripts/sim-eval.mts', import.meta.url), 'utf8');
    for (const src of [hook, evalHarness]) {
      expect(src).toMatch(/import\s+\{[^}]*DEFAULT_CAST[^}]*\}\s+from/);
      expect(src).toMatch(/DEFAULT_CAST/);
    }
    // Neither may contain its own literal cast: a second array of {type, capital} entries is
    // exactly the drift that caused the bug.
    for (const src of [hook, evalHarness]) {
      expect(src).not.toMatch(/type:\s*'(marketMaker|indexFund|holder|noise|arb)'/);
    }
  });

  // Property: the cast is the float's origin. Every seeded account's shares must add up to
  // the float, and the long-term owners (index funds + retail holders) must own most of it —
  // that is what makes everyone else's ownership percentage realistic.
  it('accounts for the whole float from the seeded cast', () => {
    const e = buildEngine();
    const summed = e.agents.reduce((s, a) => s + a.shares, 0);
    expect(e.sharesOutstanding).toBeCloseTo(summed, 6);
    expect(e.user.shares).toBe(0);
    const longTerm = e.agents
      .filter((a) => a.type === 'indexFund' || a.type === 'holder')
      .reduce((s, a) => s + a.shares, 0);
    // ~50% of the float sits with the long-term owners (measured 49.8%) — the dominant
    // cohort by a wide margin over any active book.
    expect(longTerm / summed).toBeGreaterThan(0.45);
    const makers = e.agents.filter((a) => a.type === 'marketMaker').reduce((s, a) => s + a.shares, 0);
    expect(longTerm).toBeGreaterThan(makers);
  });
});
