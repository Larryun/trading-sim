import type { AgentType, TraderStyle } from './types';

/**
 * The opening cast, defined ONCE.
 *
 * This used to be written twice — imperatively in `createEngine` (the app) and again as a
 * literal `DEFAULT_SEED` in `scripts/sim-eval.mts` (the headless harness). They silently
 * drifted apart: the eval ended up with 6 holders instead of 3 and a stray extra contrarian
 * desk, which means the eval was grading a DIFFERENT market than the one the app runs. Since
 * every tuning decision here is made on eval numbers, a divergent ruler is the most damaging
 * kind of bug in this project. One definition, imported by both, makes that drift impossible.
 */
export interface CastEntry {
  type: AgentType;
  capital: number;
  style?: TraderStyle;
  params?: Record<string, number>;
  note?: string;
}

/**
 * The cast mirrors a real market's participant pyramid: a handful of well-capitalized
 * institutions hold most of the capital, a few market makers provide nearly all the
 * liquidity, a small professional cohort trades signals, and a numerous but individually
 * small retail crowd supplies the churn.
 *
 * Sizing here is load-bearing in several places — see the notes below and the invariants in
 * CLAUDE.md before changing any capital figure.
 */
export const DEFAULT_CAST: CastEntry[] = [
  // — Liquidity providers: several names, but deliberately a MINORITY of the capital. A maker
  //   that out-capitalizes the informed traders ends up setting the price with its own quotes
  //   rather than intermediating, which decouples price from fundamentals. Sized to ABSORB the
  //   retail flow below: retail is liquidity-TAKING, so a realistic retail crowd needs
  //   proportionally more maker capacity or the book empties out (6x400k left the market
  //   two-sided only ~83% of ticks against this much retail flow).
  ...rep(6, { type: 'marketMaker', capital: 900000 }),

  // — Passive/index funds: a large, near-inert slice of the float, in line with real passive
  //   ownership of a big company. They barely trade.
  ...rep(2, { type: 'indexFund', capital: 1100000 }),

  // — The long-term RETAIL holder base: the long tail of small shareholders. Without them the
  //   whole float belongs to a handful of big funds, so one cohort inevitably looks like it
  //   owns the company — real free float is not concentrated that way.
  ...rep(3, { type: 'holder', capital: 1400000 }),

  // — Institutions: the most capital, the fewest names. The value cohort is what tethers price
  //   to fair value — but it is NO LONGER the only thing doing so, which is what let this be
  //   halved from $1.5M to $750k each. At $1.5M each fund held 14-16% of the entire market cap
  //   and 5-8% of the float: five whales dressed as ordinary funds (a real active fund holds
  //   ~1-2% of a company). The band arbitrageur now carries the anchor, so shrinking these is
  //   safe; before it existed, cutting value capital collapsed the market (tracking 99.9%).
  ...rep(5, { type: 'trader', capital: 750000, style: 'value', note: 'long-only value' }),
  { type: 'whale', capital: 1500000, params: { targetShares: 3000, sliceSize: 60 }, note: 'rotates a large stake on valuation' },

  // — Professional desks with REAL size, so value has genuine opposition. Informed capital is
  //   DIVERSIFIED across strategies: when 96% of it was value, that cohort was the only force
  //   able to move price, it won consistently, and it compounded into owning most of the float.
  { type: 'trader', capital: 500000, style: 'trend', note: 'managed futures / CTA' },
  { type: 'trader', capital: 350000, style: 'trend', note: 'a second, faster momentum book' },
  { type: 'trader', capital: 400000, style: 'contrarian', note: 'stat-arb / mean-reversion desk' },
  { type: 'trader', capital: 300000, style: 'balanced', note: 'multi-factor quant' },
  { type: 'trader', capital: 250000, style: 'adaptive', note: 'a learning multi-signal fund' },
  { type: 'trader', capital: 200000, style: 'news', note: 'event-driven' },

  // — Retail: MANY participants, each individually small. The SHAPE matters: real retail is
  //   ~20% of traded volume spread across a huge number of small accounts, not a handful of
  //   medium ones. With only 4 noise accounts retail was ~2% of volume, which made the market
  //   a conversation between makers and institutions only.
  ...rep(30, { type: 'noise', capital: 25000 }),
  //   Plus the two behavioral extremes that make rallies overshoot and selloffs cascade.
  ...rep(4, { type: 'fomoHerd', capital: 28000 }),
  ...rep(4, { type: 'panicSeller', capital: 32000 }),

  // — Arbitrageurs: the structural anchor to value. See ArbAgent in types.ts for why this is a
  //   BAND participant and why that matters more than its size.
  ...rep(4, { type: 'arb', capital: 1200000 }),

  // — Options speculators express views through calls/puts, and their open interest is what
  //   the dealer delta-hedges in the stock — so gamma effects (squeezes, pinning) arise on
  //   their own from real option demand.
  { type: 'speculator', capital: 150000 },
  { type: 'speculator', capital: 100000 },
];

function rep(n: number, entry: CastEntry): CastEntry[] {
  return Array.from({ length: n }, () => ({ ...entry }));
}
