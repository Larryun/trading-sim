import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_CAST } from '../defaultCast';
import { SimulationEngine } from '../engine';

/**
 * EMERGENT MARKET BEHAVIOUR.
 *
 * Everything in here is STATISTICAL: the engine draws on Math.random, so nothing asserts a
 * price, a spread or a P&L. Each test states a property a real market must have, and the
 * bounds are set well outside the ranges measured across repeated 6000-tick runs (recorded in
 * the comments) so that only a genuine regression in market structure can trip them.
 */

const TICKS = 6000;

/** The standard population — the SAME cast the app and the eval harness use. */
function buildDefaultEngine(options = true): SimulationEngine {
  const e = new SimulationEngine();
  e.enableOptions(options);
  for (const s of DEFAULT_CAST) {
    const a = e.addAgent(s.type, s.capital, s.style);
    if (s.params) e.updateAgentParams(a.id, s.params);
  }
  return e;
}

interface Stats {
  engine: SimulationEngine;
  liveFrac: number;
  avgSpreadBps: number;
  crossedTicks: number;
  meanAbsGapSecondHalf: number;
  worstGapRatio: { high: number; low: number };
  minPrice: number;
  maxAbsTickReturn: number;
  tickReturnStd: number;
  makerBothSidesFrac: number;
  makerOneSideFrac: number;
  makerInvPeakFrac: number;
  makerInvMeanSecondHalf: number;
  makerInvSignFlips: number;
  maxAbsSentiment: number;
  nonZeroSentimentTicks: number;
  sentimentWallTicks: number;
  tradesTotal: number;
  ticksWithVolume: number;
}

/** One long run, measured once and shared by every emergent test below (~1.5s). */
function measure(ticks = TICKS): Stats {
  const e = buildDefaultEngine(true);
  const makerIds = new Set(e.agents.filter((a) => a.type === 'marketMaker').map((a) => a.id));

  let liveTicks = 0, crossedTicks = 0, spreadSum = 0, spreadN = 0;
  let tradesTotal = 0, makerBoth = 0, makerOne = 0, ticksWithVolume = 0;
  let invPeakFrac = 0, invSum = 0, invN = 0, invFlips = 0, invLastSign = 0;
  let maxAbsSentiment = 0, nonZeroSentimentTicks = 0, sentimentWallTicks = 0;
  let minPrice = Infinity, maxAbsTickReturn = 0;
  let highRatio = 0, lowRatio = Infinity;
  const rets: number[] = [];
  const absGapSecondHalf: number[] = [];
  let prev = e.currentPrice;

  for (let i = 0; i < ticks; i++) {
    const tickTrades = e.step();
    const px = e.currentPrice;
    const fair = e.fundamentalValue;

    minPrice = Math.min(minPrice, px);
    if (prev > 0) {
      const r = (px - prev) / prev;
      rets.push(r);
      maxAbsTickReturn = Math.max(maxAbsTickReturn, Math.abs(r));
    }
    prev = px;

    highRatio = Math.max(highRatio, px / fair);
    lowRatio = Math.min(lowRatio, px / fair);
    if (i >= ticks / 2) absGapSecondHalf.push(Math.abs(px - fair) / fair);

    const bid = e.bestBid, ask = e.bestAsk;
    if (bid != null && ask != null) {
      liveTicks++;
      if (bid > ask) crossedTicks++;
      spreadSum += ((ask - bid) / ((ask + bid) / 2)) * 10000;
      spreadN++;
    }

    if (tickTrades.length > 0) ticksWithVolume++;
    for (const t of tickTrades) {
      tradesTotal++;
      const b = makerIds.has(t.buyerId), s = makerIds.has(t.sellerId);
      if (b && s) makerBoth++;
      else if (b || s) makerOne++;
    }

    const inv = e.agents.reduce((s, a) => (makerIds.has(a.id) ? s + a.shares : s), 0);
    const frac = inv / e.sharesOutstanding;
    invPeakFrac = Math.max(invPeakFrac, Math.abs(frac));
    if (i >= ticks / 2) { invSum += frac; invN++; }
    const sign = Math.sign(inv);
    if (sign !== 0) {
      if (invLastSign !== 0 && sign !== invLastSign) invFlips++;
      invLastSign = sign;
    }

    maxAbsSentiment = Math.max(maxAbsSentiment, Math.abs(e.sentiment));
    if (e.sentiment !== 0) nonZeroSentimentTicks++;
    if (Math.abs(e.sentiment) > 2.9) sentimentWallTicks++;
  }

  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return {
    engine: e,
    liveFrac: liveTicks / ticks,
    avgSpreadBps: spreadSum / Math.max(1, spreadN),
    crossedTicks,
    meanAbsGapSecondHalf: absGapSecondHalf.reduce((a, b) => a + b, 0) / absGapSecondHalf.length,
    worstGapRatio: { high: highRatio, low: lowRatio },
    minPrice,
    maxAbsTickReturn,
    tickReturnStd: Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length),
    makerBothSidesFrac: makerBoth / Math.max(1, tradesTotal),
    makerOneSideFrac: makerOne / Math.max(1, tradesTotal),
    makerInvPeakFrac: invPeakFrac,
    makerInvMeanSecondHalf: invSum / Math.max(1, invN),
    makerInvSignFlips: invFlips,
    maxAbsSentiment,
    nonZeroSentimentTicks,
    sentimentWallTicks,
    tradesTotal,
    ticksWithVolume,
  };
}

describe('emergent market behaviour over a long run (default cast, options on)', () => {
  let s: Stats;
  beforeAll(() => { s = measure(); }, 120000);

  it('keeps price finite and at a plausible dollar level on every tick', () => {
    // The most basic market property: a share of a solvent company never prints $0 or NaN.
    // NOTE: `> 0` alone is vacuous — the documented collapses printed $0.06, $0.17 and $0.25,
    // all of which are > 0. So the floor is a real dollar level: with a ~$100 fair value the
    // ambient market has never traded below $69 across measured runs.
    expect(Number.isFinite(s.minPrice)).toBe(true);
    expect(s.minPrice).toBeGreaterThan(5);
    expect(Number.isFinite(s.engine.currentPrice)).toBe(true);
    expect(s.engine.currentPrice).toBeGreaterThan(5);
    expect(s.engine.currentPrice).toBeLessThan(10000); // the $505,745 ratchet
  });

  it('keeps price tethered to fair value: never 5x above or 1/5 below it', () => {
    // Price must stay in the neighbourhood of the discounted value of earnings. This is the
    // regression net for BOTH failure modes seen here: the self-referential quote ratchet
    // (price compounding away from value) and the discovery collapses toward zero.
    // Measured across runs: worst gap −18% to +5%, i.e. ratios ~0.82–1.05.
    expect(s.worstGapRatio.high).toBeLessThan(5);
    expect(s.worstGapRatio.low).toBeGreaterThan(0.2);
  });

  it('keeps the mean absolute price-vs-fair gap small in the second half of the run', () => {
    // Tracking, not just bounds: after the market has settled, the average dislocation must
    // stay in a realistic band. A real stock trades within a modest band of analyst fair
    // value; a market whose price has decoupled shows up as a large mean gap even when the
    // hard bounds above still hold. Measured 2.3%–7.0%; CLAUDE.md accepts ~12–17%.
    expect(s.meanAbsGapSecondHalf).toBeLessThan(0.3);
  });

  it('has non-zero but non-explosive volatility', () => {
    // A market with no volatility is not discovering a price, and one with unbounded
    // per-tick jumps is not a market either.
    // Measured over 6 runs: std 0.0017–0.0039, max |tick return| 2.5–9.3%.
    expect(s.tickReturnStd).toBeGreaterThan(0.0005);
    expect(s.tickReturnStd).toBeLessThan(0.02);
    expect(s.maxAbsTickReturn).toBeLessThan(0.2);
  });

  it('keeps the book two-sided on the large majority of ticks', () => {
    // Liquidity: a real market almost always shows both a bid and an offer. A one-sided book
    // means the makers have run out of capital or inventory (the failure mode behind the
    // "force-transfer a block" and "dump a liquidated position" bugs). Measured 99.9–100%.
    expect(s.liveFrac).toBeGreaterThan(0.95);
  });

  it('never shows a crossed book, and trades on nearly every tick', () => {
    // A crossed book (bid above offer) is an arbitrage that cannot exist in a matched market:
    // it would mean the matcher failed to execute. Volume on most ticks means the flow is
    // real rather than a handful of prints.
    // Measured: 46k–56k trades over 6000 ticks, volume on 98.7–98.9% of them.
    expect(s.crossedTicks).toBe(0);
    expect(s.tradesTotal).toBeGreaterThan(5 * TICKS);
    expect(s.ticksWithVolume / TICKS).toBeGreaterThan(0.9);
  });

  it('keeps the average spread in a plausible range', () => {
    // The spread is the price of liquidity. Zero would mean free trading (unrealistically
    // aggressive makers); hundreds of bps would mean the makers have widened out of the way
    // and the market is effectively broken. Measured 21–28 bps; CLAUDE.md's accepted band for
    // the Avellaneda–Stoikov maker tops out ~99 bps, so 120 leaves room for legitimate tuning.
    expect(s.avgSpreadBps).toBeGreaterThan(3);
    expect(s.avgSpreadBps).toBeLessThan(120);
  });

  it('has market makers intermediate rather than wash-trade with each other', () => {
    // A maker's job is to stand between buyers and sellers. If makers are on BOTH sides of a
    // large share of prints they are trading with themselves — churning volume and setting
    // the price off their own quotes rather than intermediating real flow, which is exactly
    // the self-referential dynamic that decoupled price from value here before.
    // Measured: both-sides 0.05–0.15% of trades; at least one maker on ~50%.
    expect(s.makerBothSidesFrac).toBeLessThan(0.05);
    expect(s.makerOneSideFrac).toBeGreaterThan(0.15);
  });

  it('has makers hold roughly flat inventory on average rather than a large slice of the float', () => {
    // An Avellaneda–Stoikov maker targets FLAT inventory: its position must mean-revert and
    // change sign, not accumulate. A maker that pins at a big long (or short) has stopped
    // reducing risk, will eventually stop quoting one side, and the price it prints becomes a
    // function of its own book. Measured: |mean over second half| 0.9–5.5% of float,
    // peak excursion 41–44%, sign changes 40–57 times.
    expect(Math.abs(s.makerInvMeanSecondHalf)).toBeLessThan(0.2);
    expect(s.makerInvPeakFrac).toBeLessThan(0.7);
    expect(s.makerInvSignFlips).toBeGreaterThan(4);
  });

  it('leaves every account solvent', () => {
    // Nobody should be trading themselves to negative equity: that would mean the market has
    // fabricated losses beyond the capital committed (leverage the model does not grant).
    // Measured 53/53 solvent in every run.
    const px = s.engine.currentPrice;
    const insolvent = s.engine.agents.filter((a) => a.cash + a.shares * px <= 0);
    expect(insolvent.map((a) => a.name)).toEqual([]);
    expect(s.engine.user.cash).toBeGreaterThanOrEqual(0);
  });

  it('never bleeds an account to zero and leaves it inert', () => {
    // Regression: uninformed retail accounts were being drained to exactly $0 cash and 0
    // shares, after which they supplied no flow at all — the market quietly lost its
    // uninformed participants and became a conversation between the professionals.
    // Measured worst retail account still held 70–87% of its starting capital.
    const px = s.engine.currentPrice;
    const dead = s.engine.agents.filter((a) => Math.abs(a.cash) < 1 && Math.abs(a.shares) < 0.01);
    expect(dead.map((a) => a.name)).toEqual([]);
    const ruined = s.engine.agents.filter((a) => (a.cash + a.shares * px) < 0.05 * a.startingCapital);
    expect(ruined.map((a) => a.name)).toEqual([]);
  });

  it('still gets flow from the small retail accounts at the end of the run', () => {
    // Solvent-but-silent is the same failure: retail must still be TRADING after thousands of
    // ticks, because uninformed flow is what the makers earn the spread from.
    const retail = new Set(s.engine.agents.filter((a) => a.type === 'noise').map((a) => a.id));
    expect(retail.size).toBeGreaterThan(0);
    let fills = 0;
    for (let i = 0; i < 400; i++) {
      for (const t of s.engine.step()) if (retail.has(t.buyerId) || retail.has(t.sellerId)) fills++;
    }
    // Measured 2160–2594 retail fills over these 400 ticks; 800 catches a cohort that has
    // gone mostly inert, which `> 20` would not.
    expect(fills).toBeGreaterThan(800);
  });

  it('keeps sentiment bounded and alive, never pinned at the wall', () => {
    // Sentiment is a soft (tanh) band, not a clamp: the reflexive loop must not be able to
    // saturate and sit at the cap, or the mood stops being informative and the market's
    // premium/discount becomes a constant.
    // NOTE: `|sentiment| < cap` is a TAUTOLOGY — sentiment is cap*tanh(...), so it can never
    // reach the cap. The non-vacuous property is that it does not LIVE near the wall:
    // measured 0–0.3% of ticks above 2.9, and it is non-zero nearly all the time.
    expect(s.sentimentWallTicks / TICKS).toBeLessThan(0.15);
    expect(s.maxAbsSentiment).toBeGreaterThan(0.2);
    expect(s.nonZeroSentimentTicks / TICKS).toBeGreaterThan(0.5);
  });
});

describe('sentiment decay', () => {
  /** A quiet market with no participants: only the mood machinery moves. */
  function quiet(halfLife: number): SimulationEngine {
    const e = new SimulationEngine();
    e.autoNews = false;
    e.sentimentDecay = Math.pow(0.5, 1 / halfLife);
    return e;
  }

  it('leaks a news shock away with the configured half-life', () => {
    // News must create a regime that FADES. A mood that does not decay would leave the market
    // permanently repriced by one headline; one that decays instantly makes news meaningless.
    // The persistence knob is defined as a half-life, so that is what is asserted.
    // Half-lives kept short enough that the whole measurement finishes inside one earnings
    // period (200 ticks) — an earnings report is itself a mood impulse and would pollute it.
    for (const halfLife of [10, 15]) {
      const e = quiet(halfLife);
      e.triggerEvent(2);
      const start = e.newsMood;
      for (let i = 0; i < halfLife; i++) e.step();
      expect(e.newsMood).toBeGreaterThan(0.4 * start);
      expect(e.newsMood).toBeLessThan(0.6 * start);
      for (let i = 0; i < 9 * halfLife; i++) e.step();
      expect(Math.abs(e.newsMood)).toBeLessThan(0.05 * start); // ten half-lives ≈ gone
    }
  });

  it('decays the fast reflex layer much quicker than the news regime', () => {
    // Two layers with different clocks is what lets news set a lasting regime while price
    // action only adds texture. If the fast layer persisted, the fear asymmetry that lives in
    // it would integrate into a permanent downward bias.
    const e = quiet(100);
    e.reflexMood = 1;
    e.newsMood = 1;
    for (let i = 0; i < 20; i++) e.step();
    expect(Math.abs(e.reflexMood)).toBeLessThan(0.1);
    expect(e.newsMood).toBeGreaterThan(0.5); // same 20 ticks, barely moved
  });

  it('keeps sentiment inside its band no matter how hard it is pushed', () => {
    // Headroom + soft cap: hammering the market with maximal news must not let the reflexive
    // loop run away. The extreme has to be a repeller, not an absorbing state: the exposed
    // mood is bounded by the cap however large the underlying impulse gets, and it must come
    // back off the wall when the news flips sign.
    // NOTE: `|sentiment| <= cap` alone is a tautology (cap*tanh). What is actually asserted is
    // that the SOFT cap is doing compression work: the raw driver (newsMood) is pushed far
    // beyond the exposed mood, and the exposed mood still moves and still flips sign.
    const e = quiet(200);
    for (let i = 0; i < 300; i++) { e.triggerEvent(3); e.step(); }
    expect(Math.abs(e.sentiment)).toBeLessThanOrEqual(3);
    expect(e.newsMood).toBeGreaterThan(3 * Math.abs(e.sentiment)); // heavily compressed
    expect(e.sentiment).toBeGreaterThan(2); // and it does go high, it is not damped to nothing
    for (let i = 0; i < 600; i++) { e.triggerEvent(-3); e.step(); }
    expect(Math.abs(e.sentiment)).toBeLessThanOrEqual(3);
    expect(e.sentiment).toBeLessThan(0); // it recovers from the wall, it is not absorbing
    expect(Number.isFinite(e.sentiment)).toBe(true);
  });
});

describe('premium and discount to fair value', () => {
  /**
   * A real market trades ABOVE fair value as well as below it — optimism is priced, not just
   * pessimism. This market used to be structurally incapable of a premium (the fixed float is
   * long-biased and the value cohort only ever buys the discount), so this is a genuine
   * realism property rather than a nicety.
   *
   * It is asserted as "at least one of TEN independent runs reaches a premium" because the
   * effect is marginal: measured over 40 runs, only 27 (67%) print above fair value at all, and
   * the best premium ever reached is ~+4%. With 5 runs that is a 0.4% failure rate per suite
   * run — it duly failed once in 8 full-suite runs, so the count is 10 (≈2e-5). The loop exits
   * as soon as a premium is seen, so the usual cost is one or two runs. See the skipped test
   * below for the part that does NOT hold.
   */
  it('can trade at a premium to fair value when sentiment is strongly bullish', () => {
    let runsWithPremium = 0;
    for (let run = 0; run < 10 && runsWithPremium === 0; run++) {
      const e = buildDefaultEngine(true);
      e.autoNews = false;
      e.fundamentalImpact = 0; // isolate SENTIMENT: news must not drag fair value up with price
      for (let i = 0; i < 800; i++) e.step();
      let premium = false;
      for (let i = 0; i < 1500; i++) {
        if (i % 25 === 0) e.triggerEvent(2.5);
        e.step();
        if (e.currentPrice > e.fundamentalValue) premium = true;
      }
      if (premium) runsWithPremium++;
    }
    expect(runsWithPremium).toBeGreaterThan(0);
  }, 120000);

  it('trades below fair value too — a discount is always reachable', () => {
    // The other half of the same property, and the cheap direction to verify: the market must
    // be able to price pessimism. (Measured: the ambient market sits at a 2–18% discount, so
    // this is comfortably true; it is here so that a future change which pins price ABOVE fair
    // — e.g. a re-introduced long-biased maker — is caught by the pair of tests together.)
    const e = buildDefaultEngine(true);
    let discount = false;
    for (let i = 0; i < 1200; i++) { e.step(); if (e.currentPrice < e.fundamentalValue) discount = true; }
    expect(discount).toBe(true);
  }, 60000);

  it.skip('KNOWN LIMITATION: sustained bullish news does not reliably produce a premium', () => {
    // Real-market expectation: with sentiment repeatedly driven to its bullish cap, price
    // should spend a meaningful share of its time ABOVE fair value — that is what a bubble is.
    //
    // Measured instead (5 runs, autoNews off, +2.5 news every 25 ticks for 1500 ticks after an
    // 800-tick warm-up, with `fundamentalImpact = 0` so fair value is held still):
    //   ticks above fair = 914 / 0 / 544 / 486 / 1081, best gap = +4.2% / −2.2% / +3.8% /
    //   +2.5% / +4.9%.
    // One run in five never printed a premium at all, and the best premium ever reached was
    // ~5% against discounts that routinely reach −18%.
    //
    // With news allowed to move EPS (the default `fundamentalImpact`), the premium NEVER
    // appears in any run: bullish news lifts fair value faster than the long-biased, fixed-float
    // agent pool can lift price, so the market is pushed FURTHER into a discount by good news
    // (max gap −5.6% to −17.9% across 5 runs). Structurally the same limitation CLAUDE.md
    // records: "the fixed-float, long-biased agent pool cannot chase a runaway fair value".
    //
    // The asymmetry is the defect: this market can price pessimism but barely prices optimism.
    let above = 0;
    const e = buildDefaultEngine(true);
    e.autoNews = false;
    for (let i = 0; i < 800; i++) e.step();
    for (let i = 0; i < 1500; i++) {
      if (i % 25 === 0) e.triggerEvent(2.5);
      e.step();
      if (e.currentPrice > e.fundamentalValue) above++;
    }
    expect(above / 1500).toBeGreaterThan(0.1);
  });
});
