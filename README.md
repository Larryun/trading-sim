# Trading Price Simulator

An interactive, **client-side stock-market simulator** for learning what actually moves a
stock price: **order flow**. A real limit order book is fed by a cast of trading agents plus
your own orders, and the price *emerges* from their buying and selling — no scripted random
walk. Everything is explainable and tunable live.

React 19 + Vite + TypeScript. No backend, no data feed — the whole market is simulated in the
browser.

## Run

```bash
npm install
npm run dev      # open the printed localhost URL
npm run build    # type-check + production build
```

## What it models

- **Emergent price from a limit order book** — market/limit/stop orders, price-time priority,
  a `$0.01` tick grid, walk-the-book slippage, and finite participant-supplied liquidity (the
  book can genuinely thin out).
- **A cast of agents**, each a simple, tunable rule that produces rich emergent dynamics:
  market makers (earn the spread, widen on volatility), a configurable **Trader** with style
  presets (value / trend / contrarian / news / balanced / adaptive-learning), a **FOMO herd**,
  **panic sellers**, a value-timed **institution/whale**, and an **options dealer** (gamma).
- **Earnings-based fair value** — `fair = EPS × multiple`, moved by quarterly earnings
  reports (beats/misses **vs consensus**) and news-as-guidance.
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
src/sim/        pure simulation core (no React): engine, agents, orderBook, options, bars, ringBuffer, types
src/hooks/      useSimulation — owns the engine, steps it, mirrors state to React
src/components/ UI (hand-rolled SVG charts, shared kit + design tokens in ui.ts)
src/views/      the four routes
scripts/        headless evaluation harness
docs/CONCEPTS.md  the educational concepts guide
```

### Headless evaluation

The market can be run without the UI to check its health (tracking error, volatility, spread,
liquidity, cash drift, solvency):

```bash
npx tsx scripts/sim-eval.mts '{"ticks":6000,"autoNews":true}'
```

## Caveats

This is a **teaching model**, not a faithful exchange replica: one stock, discrete ticks, a
single shared fair-value estimate, simplified frictions (a taker fee + dividends, but no
commissions/taxes/borrow fees/latency/auctions/circuit-breakers), and agents that each follow
one tidy rule. Within those bounds it faithfully demonstrates the mechanics that matter — price
emerges from order flow, liquidity is finite, supply is conserved, and the participant mix
decides whether the market trends, oscillates, or crashes.
