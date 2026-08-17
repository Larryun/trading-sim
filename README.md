# Trading Price Simulator

An interactive, **client-side stock-market simulator** for learning what actually moves a
stock price: **order flow**. A real limit order book is fed by a cast of trading agents plus
your own orders, and the price *emerges* from their buying and selling — no scripted random
walk. Everything is explainable and tunable live.

React 19 + Vite + TypeScript. No backend, no data feed — the whole market is simulated in the
browser.

**Live demo: [larryun.github.io/trading-sim](https://larryun.github.io/trading-sim/)**

## Run

```bash
npm install
npm run dev      # open the printed localhost URL
npm run build    # type-check + production build
npm test         # simulation test suite
```

### Deploying

Pushing to `main` builds and publishes to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). It needs **Settings → Pages →
Source = GitHub Actions** enabled once on the repository.

Because Pages serves the app from a subpath, the workflow builds with `GITHUB_PAGES=1`, which
sets Vite's `base` to `/trading-sim/` and emits a `404.html` copy of `index.html` — the router
reads the same base, so deep links like `/trading-sim/stats` survive a refresh on a host that
has no server-side rewrites.

## What it models

- **Emergent price from a limit order book** — market/limit/stop orders, price-time priority,
  a `$0.01` tick grid, walk-the-book slippage, and finite participant-supplied liquidity (the
  book can genuinely thin out).
- **A cast of agents**, each a simple, tunable rule that produces rich emergent dynamics:
  **market makers** (Avellaneda–Stoikov style — they target flat inventory, may go short, and
  express inventory through a reservation price), a configurable **Trader** with style presets
  (value / trend / contrarian / news / balanced / adaptive-learning), a **FOMO herd**, **panic
  sellers**, a value-timed **institution/whale**, an **options dealer** (gamma), plus the
  participants that make the ownership structure realistic — **index/passive funds**, a
  **long-term retail holder base**, and an **arbitrageur**.
- **A realistic participant mix**, tuned against *two separate* real-world facts: who **owns**
  the float and who generates the **volume**. These differ wildly — market makers own almost
  nothing yet are roughly half of all trading, while passive funds own a fifth of the company
  and barely trade at all.
- **Earnings-based fair value** — `fair = EPS × multiple`, moved by quarterly earnings
  reports (beats/misses **vs consensus**) and news-as-guidance.
- **A structural anchor to value.** Modelling value investors alone is not enough: a demand
  curve that simply buys more as the stock cheapens settles at a permanent *discount* rather
  than at fair value, so the market could never trade above fair or form a bubble. A
  **band arbitrageur** — inactive inside a band of the consensus valuation, then trading at
  full size outside it — pins price to value regardless of whose capital is largest. It is
  rate-limited, so dislocations still take hundreds of ticks to close (limits to arbitrage).
- **Sentiment as a lasting regime** — a slow bull/bear tide + medium news shocks + fast
  reflexive texture, self-limiting and mean-reverting, priced as a **valuation premium** over
  fair value.
- **Dividends** (quarterly yield), **maker/taker fees**, **short selling** with margin calls
  and squeezes, **options** (Black-Scholes chain; the dealer delta-hedges → **gamma
  squeezes**), and **stop-order cascades**.
- **You** trade a real cash/margin account (long or short, market/limit/stop) into the same
  book, with a live P&L, positions, and order queue.

The educational write-up of every mechanism is in **[`docs/CONCEPTS.md`](docs/CONCEPTS.md)**.

## Views

| Route | What it shows |
|---|---|
| `/` **Market** | Price/volume charts, order book, your trade ticket + positions + order queue, the agent table, sentiment breakdown, news. |
| `/options` **Options** | A tradeable calls/puts chain; the dealer takes the other side and hedges → emergent gamma squeezes. |
| `/stats` **Statistics** | P&L by strategy, float ownership, money flows (dividends in vs fees out). |
| `/decisions` **Decisions** | What each kind of agent would do right now, and why (its live signals). |

## Project structure

```
src/sim/            pure simulation core (no React): engine, agents, orderBook, options,
                    defaultCast (the opening population), bars, ringBuffer, types
src/sim/__tests__/  vitest suite asserting real-market properties per mechanism
src/hooks/          useSimulation — owns the engine, steps it, mirrors state to React
src/components/     UI (hand-rolled SVG charts, shared kit + design tokens in ui.ts)
src/views/          the four routes
scripts/            headless evaluation harness
docs/CONCEPTS.md    the educational concepts guide
```

The opening cast lives in a single place (`src/sim/defaultCast.ts`) that both the app and the
headless harness import, so the two can never simulate different markets.

### Tests

```bash
npm test
```

The suite asserts **market properties** rather than implementation details — shares are
conserved across every operation, cash is never fabricated, short capacity cannot self-finance,
a liquidating account cannot ratchet the price, options obey put-call parity, and over long runs
price stays tethered to fair value with a two-sided book. Because the engine uses `Math.random`,
the behavioural tests assert bounds and statistics rather than exact prices.

### Headless evaluation

The market can be run without the UI to check its health:

```bash
npx tsx scripts/sim-eval.mts '{"ticks":20000,"autoNews":true}'
```

It reports tracking error against fair value, the **signed** gap (plus the fraction of ticks
spent above and below fair — absolute error hides a systematic one-sided discount), volatility,
spread, book liveness, cash drift and solvency.

## Caveats

This is a **teaching model**, not a faithful exchange replica: one stock, discrete ticks, a
single shared fair-value estimate, simplified frictions (a taker fee + dividends, but no
commissions/taxes/borrow fees/latency/auctions/circuit-breakers), and agents that each follow
one tidy rule. Within those bounds it faithfully demonstrates the mechanics that matter — price
emerges from order flow, liquidity is finite, supply is conserved, and the participant mix
decides whether the market trends, oscillates, or crashes.

Known limitations, kept explicit rather than hidden:

- Price sits at a modest **discount** to fair value on average, and trades above it a minority
  of the time. The band arbitrageur greatly reduced this but did not eliminate it.
- Over very long runs (60k+ ticks) the tether loosens, because compounding earnings raise fair
  value faster than a **fixed float** of long-biased agents can chase it.
- Deleting most of the long-term holder base at once collapses the market. The float has to be
  owned by participants who want to hold it; the direction is arguably right, the magnitude
  is not.

`docs/CONCEPTS.md` explains each mechanism, and — where a naive model fails — why.
