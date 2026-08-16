# Concepts: What Really Drives a Stock Price

## Introduction

The **Trading Price Simulator** is a browser-based sandbox for a single imaginary
stock. You can trade against a crowd of simulated participants, add or remove
those participants, tune how they behave, fire off news, and shrink or grow the
share supply — all while watching the price, volume, sentiment, and ownership
update tick by tick.

It has two pages: the **Market** view (`/`) where you trade and tune, and a
**Statistics** view (`/stats`) that analyzes the *same live market* — profit &
loss by strategy, float ownership, money flows (dividends in vs. fees out), and
how closely price tracks fundamental value. The stats page is the quickest way to
*see* the ideas below playing out (e.g. which strategies actually make money).

The big idea it teaches is this:

> **There is no "true" price handed down from somewhere. The price is simply the
> last price at which two participants agreed to trade. It emerges, moment to
> moment, from the flow of orders.**

Everything else in this document is a consequence of that one idea. When more
people want to buy than sell, buyers have to reach up to higher offers and the
price rises. When sellers dominate, they hit lower and lower bids and the price
falls. The market is a machine for turning a mix of intentions into a single
number, and this sim lets you take that machine apart.

The simulation starts at a price of **100**, with **50,000** shares outstanding,
a handful of pre-loaded agents, and you holding **$10,000** in cash. Time
advances in discrete **ticks** (you control the speed); on each tick, agents
decide what to do, orders hit the book, trades print, and the price updates.

---

## 1. How Prices Form From Order Flow

The current price shown on the chart is the **last trade price** — the price of
the most recent transaction, nothing more. It is not an average, not a
"valuation," and not a number the app decides in advance.

- Every tick, agents (and you) send orders into a shared **order book**.
- A buy order that executes lifts the last trade price toward the sellers'
  asking prices; a sell order drags it down toward the buyers' bids.
- Net buying pressure pushes the price **up**; net selling pressure pushes it
  **down**. Persistent one-sided flow makes a trend; balanced flow makes chop.

**In the app:** the price chart (candles or line) is nothing but a running
record of successive last-trade prices. The volume chart below it splits each
bar into buy-initiated and sell-initiated volume, so you can literally see which
side of the flow is winning and how the price responds.

---

## 2. The Limit Order Book

Behind the chart is a **limit order book** — the ledger of everyone's standing
buy and sell orders.

- **Bids** are resting buy orders (the prices people will pay). **Asks** (or
  offers) are resting sell orders (the prices people will accept).
- The **best bid** is the highest price anyone is currently willing to pay; the
  **best ask** is the lowest price anyone will sell at.
- The gap between them is the **bid-ask spread**. A tight spread means a liquid,
  competitive market; a wide spread means liquidity is scarce or nervous.
- The **mid price** sits halfway between best bid and best ask — a common proxy
  for "where the price is" between trades.

**Three kinds of orders:**

- A **market order** says "fill me now, at whatever price it takes." It **takes
  liquidity** — it consumes resting orders on the opposite side. The person
  sending it is a **taker**.
- A **limit order** says "fill me only at this price or better." Any part that
  can't fill immediately **rests in the book**, adding liquidity for others. The
  person posting it is a **maker**.
- A **stop order** sits **dormant** until the price crosses a trigger, then fires as
  a market order: a **sell-stop** below the market (a stop-loss) triggers when price
  *falls* to it; a **buy-stop** above triggers when price *rises* to it. Because a
  triggered stop is a market order that moves the price, it can trip *other* nearby
  stops — a **stop cascade** (a self-reinforcing chain of selling or buying). You can
  place all three from the trade panel.

**Price-time priority:** orders are matched best-price-first, and among orders at
the same price, first-come-first-served. In the sim the book is kept sorted by
price with a stable sort, so earlier orders at a given price fill before later
ones — the same fairness rule real exchanges use.

**Tick size:** real exchanges quote on a fixed price grid (e.g. $0.01), not a
continuum. The sim snaps every resting order to that grid, so the book always shows
distinct, clean price levels and orders at the same grid price aggregate together.

**In the app:** there is **no backstop** liquidity — the book is only what
participants post. **Market-maker agents** post ladders of resting bids and asks
around the last price to provide most of it, but if they're removed or overwhelmed
the book can genuinely **thin out or go one-sided** (then a market order may not
fully fill). You can send either a **market** order (takes now) or a **limit**
order (rests until the price reaches it).

---

## 3. Price Impact & Slippage

Liquidity is **finite**. The book only holds so many shares at each price level,
so a large market order can't all fill at the best price.

- A market buy first takes the cheapest asks, then the next cheapest, then the
  next — **walking the book** and paying progressively worse prices as it climbs.
- The difference between the price before your order and the average price you
  actually paid is **slippage**.
- **Bigger orders move the price more.** Doubling your size doesn't just cost
  twice as much cash — it can cost a worse *average* price, because you eat
  deeper into the book.

**In the app:** after you trade, the trade panel reports your average fill price
and the resulting **slippage percentage** versus the pre-trade price. Try the
built-in size presets (10 / 100 / 1000) back to back and watch slippage grow
with size. This is price impact in miniature: your own demand is part of what
sets the price.

---

## 4. Market Makers & the Spread

A **market maker (MM)** is a liquidity provider. Instead of betting on
direction, it continuously posts **two-sided quotes** — a bid a little below the
mid and an ask a little above — and profits from the **spread**: buying slightly
low and selling slightly high, over and over.

- The MM earns the spread as compensation for a real risk: **inventory risk**.
  If it keeps buying from sellers, it accumulates a long position it may be
  forced to unload at a loss if the price then falls.
- To manage that, a maker uses **quote skew**: when it is holding too many
  shares it quotes a bit lower (eager to sell, reluctant to buy more); when it is
  short it quotes higher. This nudges its inventory back toward a target.
- **Spreads widen under stress.** When liquidity is scarce or volatility is high,
  makers demand a bigger cushion, so the bid-ask gap grows.

**In the app:** there is **no synthetic backstop** — *all* liquidity comes from
**market-maker agents** (and any limit orders you or other agents place). A maker
posts a two-sided **ladder** of quotes: `Depth` price levels on each side, spaced
by its half-spread (`spreadBps`), each of `quoteSize` shares — which is what gives
the order book its multi-level depth (thin books mean few makers or shallow
ladders). Everyone else trades with market orders, so they *take* liquidity rather
than adding resting depth. The tightest quotes among all makers set the spread;
add makers or deepen their ladders and the book fills out, **remove them all and
the book empties — the market goes illiquid until someone quotes again.**

---

## 5. Fixed Share Supply (Float) & Conservation

The stock has a **fixed number of shares outstanding** (the **float**). Just like
a real company, **every share is held by some participant** — there is no special
entity holding "un-owned" shares. Shares are never created or destroyed by
trading; they only change hands. This is **conservation of shares**:

> all agents' shares + your shares = total float, always.

- The float is simply the sum of everyone's holdings (shown in the supply bar,
  split between agents and you). Adding a participant brings its own shares to the
  market; removing one takes them away.
- **Free float vs. locked shares.** Only shares that holders are *willing to sell*
  are actually available to buy. When a big holder (a **whale**) accumulates and
  sits on a large position, the freely-tradable float shrinks and the stock gets
  **thin and illiquid** — buyers must reach higher and higher to find the few
  remaining sellers, a **scarcity-driven price spike**. This is exactly why
  low-float stocks are so volatile.

**In the app:** the supply bar shows the ownership split between the agents and
you. Because a seller's orders are **capped by the shares they actually hold**,
when holders stop offering, the sell side thins — the mechanism behind squeezes
and scarcity rallies.

### Cash isn't a closed loop: dividends

Trading only *moves* cash between participants (buyer down, seller up), so the
market's total cash is otherwise conserved — and gets progressively **locked up in
positions**, making buying power feel like it dries up. Real markets aren't closed:
money flows in from outside. The sim models this with **dividends** — set as an
**annual yield** and paid **quarterly** (each earnings period), the "company" pays
cash to every shareholder out of its earnings, injecting fresh money. Because it's
paid *from earnings*, a dividend doesn't reduce the company's fair value, and value
traders keep the price anchored to fair — so dividends add shareholder **income**
without inflating the price. (A short position, holding negative shares, *owes* the
dividend, just like in reality.) Turn the **Dividend** control up for a higher yield;
set it to zero for a closed, zero-sum cash pool. This inflow is the mirror image of
transaction fees, which drain cash out of the market (see *Transaction costs* in
section 8).

---

## 6. Agent Archetypes and the Behaviors They Create

The market's character comes from *who is trading*. Each agent type follows a
simple rule, but a **population** of them produces rich, emergent dynamics. You
can add, remove, and tune each type. The *initial* agents start with capital split
roughly half cash / half shares (so the market opens with a float to trade). An
agent **you add** to a running market starts with **only cash** and must *buy* its
position from the market — a realistic new entrant that doesn't conjure new shares
into existence.

- **Noise traders** — buy or sell essentially at random, with an adjustable
  frequency and order size. *Emergent effect:* random-walk jitter with no
  persistent trend. They are the market's background hum and provide the volume
  that other strategies feed on.

- **Trader (one configurable agent, many *styles*)** — real markets aren't made
  of a handful of rigid archetypes; they're a spectrum of people weighing the
  same information differently. So the directional strategies are unified into a
  **single trader** that holds a **target exposure** driven by a **weighted blend
  of four signals**: `value` (cheap vs. fair value), `momentum` (recent trend),
  `mean-reversion` (distance from a moving average), and `sentiment`. Its
  **style** is just a preset of those (signed) weights — its *personality*:

  | Style | Leans on | Behaves like |
  |---|---|---|
  | **Value** | + value, − sentiment | Buys cheap vs. fair value, fades panic — contrarian and **stabilizing** (the main force tethering price to fundamentals). |
  | **Trend** | + momentum | Chases the move — **positive feedback**, the engine of trends and bubbles. |
  | **Contrarian** | + mean-reversion, − momentum | Fades extremes — **negative feedback**, damps swings. |
  | **News** | + sentiment | Trades information shocks into directional moves. |
  | **Balanced** | all four equally | A generalist. |
  | **Adaptive** | starts balanced, then **learns** | Re-weights its signals toward whichever has recently predicted returns. |

  Every style has a **learning rate**: `0` = a *fixed* personality (weights never
  change); `> 0` = it **adapts** its weights over time (only *Adaptive* does this
  by default, but you can turn learning on for any style). Instead of firing an
  order every tick, a trader rebalances only when its position drifts meaningfully
  off its target exposure — so a stable view means little trading, and a flipped
  view means it reverses. Traders may also **short** (see section 8).

- **FOMO herd (retail)** — chase *accelerating* up-moves, piling in late as a
  rally steepens. *Emergent effect:* they pour fuel on bubbles near the top and
  then get caught in the reversal, amplifying both the blow-off and the
  subsequent drop.

- **Whale / large institution** — trades in **large size** on a **value thesis**:
  it **accumulates** a stake while the stock is undervalued (price below fair) and
  **distributes** it while overvalued — buy low, sell high — patiently, in small
  **sliced** child orders to disguise its footprint and limit slippage (and it eases
  off when its own trades are moving the price). *Emergent effect:* one big, patient
  participant can bend the whole market, and profits from mean-reversion to fair.

- **Panic sellers** — dump holdings when losses mount. *Emergent effect:*
  **capitulation** and **stop-loss cascades** — one wave of selling drops the
  price, which triggers the next wave, producing sharp, self-reinforcing crashes.

- **Market maker** — provides liquidity and earns the spread (section 4). *Emergent
  effect:* tighter spreads, smoother fills, and a general damping of volatility.

- **Options dealer** — doesn't bet on direction; it **delta-hedges** an options book,
  trading only to stay neutral (`Δhedge ≈ −gamma × Δprice`). When **short gamma** (the
  default) it must **buy as price rises and sell as it falls**, an accelerant — one of
  the biggest real intraday forces (a **gamma squeeze**), and it chains with the short
  buy-in cascade below. When **long gamma** it fades moves, **pinning** price toward
  the option strike. *Emergent effect:* amplified breakouts / crashes, or pinning near
  a strike, depending on its positioning.

> All of these are implemented and can be added, removed, and tuned live from the
> Agents panel: **noise, market maker, FOMO herd, whale, panic seller, options
> dealer**, and the **Trader** (with the Value / Trend / Contrarian / News /
> Balanced / Adaptive styles). The **Agent Decisions** view explains what each one
> would do right now and why.

---

## 7. Fair Value, Earnings, Sentiment & News

**Fair value is *derived*, not guessed.** The company has **earnings per share
(EPS)**, and its fair value is those earnings **capitalized at a multiple**:

```
fair value = EPS × valuation multiple
```

This is the essence of a real valuation (a P/E multiple, or equivalently a
discounted-cash-flow / Gordon-growth model). EPS starts so fair value equals the
opening price, then changes for concrete, *objective* reasons:

- **Quarterly earnings reports** (every earnings period) grow EPS by a baseline
  amount plus a random **beat/miss surprise**. The surprise is the main driver of
  fair-value moves and also colors the mood (a beat is bullish); it's logged as a
  news event ("Earnings beat +1.8%").
- **News = mostly sentiment** (hype, chatter, analyst opinion). A news event mainly
  moves the **mood**, and only *barely* nudges earnings — so day-to-day news drives
  the sentiment premium, while the **fundamentals** are set by actual earnings. This
  keeps hype from making fair value run away.

Because fair value is `EPS × multiple`, it isn't a number nudged by hand — it falls
out of the fundamentals. (Real fair value is *also* genuinely subjective — analysts
disagree — but it's grounded in these objective inputs; here we use one shared
estimate for clarity.)

So the two channels are cleanly separated: **earnings** move the **fundamental** fair
value (permanent), while **news/sentiment** moves the **valuation premium** around it
(a lasting regime that eventually mean-reverts).

**Value-style traders anchor to this evolving fundamental** (not a fixed
price): when price sits below it they accumulate, pulling the market back toward
fair value; above it they sell. So the market oscillates *around a moving
fundamental* — overreacting on the way, then converging.

**How sentiment moves price — a valuation premium.** Sentiment doesn't just tweak
order flow; it re-rates what the market is *willing to pay*. The pool anchors to a
**sentiment-adjusted fair value** — `fair × (1 + premium × sentiment)` — so a
bullish mood makes the stock trade at a **premium** above earnings-fair (multiple
expansion) and a bearish mood at a **discount**, bounded and mean-reverting as the
mood fades. That's why the gap between price and the dashed fair line tracks the
sentiment line.

**Mood has three layers**, so it behaves like a real market's mood rather than
noise:

- A slow **bull/bear regime** — the market sits in one regime that only occasionally
  flips, giving **sustained** optimistic or fearful *periods* (hundreds of ticks),
  not a coin flip. This is the lasting tide.
- **News shocks** on top — each event bumps the mood, then leaks toward the regime
  at a **half-life you set** (the *Mood persistence* control).
- A fast **reflexive** layer — rallies breed optimism, drops breed fear (a bit
  sharper: the **fear asymmetry**), plus a little wobble; it decays in a few ticks,
  so it adds texture but never becomes the trend.

News drives **sentiment** (mood/hype); the company's **earnings reports** drive fair
value — so hype can't make the fundamentals run away.

Because agents trade *with* the mood, reflexivity is a **positive feedback loop**
(mood → buying → higher price → more optimism) that, unchecked, would run away and
**pin** the mood at its extreme. Real markets don't — euphoria *exhausts* buyers,
panic *exhausts* sellers. The sim reproduces this with a **self-limiting gain**
(the feedback fades to zero as the mood nears its cap) and a **soft ceiling**
instead of a hard wall, so extremes are unstable points the mood always falls back
from. Keeping the fear asymmetry in the *fast* layer also means it can't quietly
bias the long-run mood in either direction, at any persistence setting.

**In the app:** use "Good news" / "Bad news" to inject events manually, or toggle
**Auto events** for random headlines. The sentiment chart shows the transient
spike decaying to zero, while the **dashed "fair" line** on the price chart (and
the `fair $…` readout) shows the fundamental stepping to its new level and price
chasing it.

---

## 8. Capital Constraints, Positions & PnL

Every participant — agents and you — has a real, finite account: some **cash**
and some **shares**. Orders are constrained by that account.

- **You trade a cash/margin account.** Buys can't spend more cash than you have
  (the order is trimmed to what you can afford at the current price, including the
  fee). By default sells can't exceed the shares you hold, but flip on the **Short**
  toggle and you can **sell short** — collateralized by cash, with a maintenance
  margin, so a rising price can margin-call (buy in) your short just like the agents.
  If an order can't fully execute, the trade panel tells you why (limited by your
  cash, by your shares, out of liquidity, or resting). Orders placed while the sim
  is **paused** fill immediately against the current book.
- **Short selling** — bearish **Trader** agents (and you, with the toggle on) can
  sell shares they don't own by borrowing them (the position goes negative), collateralized by cash.
  A short **profits when the price falls** and loses when it rises. This is the real
  way a bear expresses a view — not a permanent "sell bias." It's also what lets
  an *overvalued* stock be pushed back down: once long holders run out of shares to
  sell, shorts keep the downward pressure on.
- **Margin calls & short squeezes** — a short is only collateralized up to its
  cash. If the price rises enough to wipe out that collateral, the short is
  **forced to buy back** to cover — which pushes the price up further and can
  force *other* shorts to cover too: a **short squeeze**.
- Each account tracks an **average cost basis** — the blended price you paid for
  the shares you hold, updated each time you buy more.
- **Realized PnL** is profit/loss locked in when you *sell* (sale price minus
  average cost, times shares sold). **Unrealized PnL** is the paper gain/loss on
  shares you still hold, marked at the current price. Realized is booked;
  unrealized moves every tick with the price.

**In the app:** the trade panel shows your cash, shares, average cost, equity,
and unrealized PnL; the order-history view logs each executed order with its
average fill price and any realized gain.

### Transaction costs (fees)

Trading isn't free. Every fill charges the **taker** (whoever crossed the spread
to trade *now*) a fee, set by the **Fee** control in basis points of the trade's
value. Crucially, that cash **leaves the market entirely** — it goes to the
broker/exchange, it is *not* paid to the other side. So fees are a steady **drain**
on total participant cash (the mirror image of dividends, which are an inflow).

This has real consequences you can watch:
- **Takers pay, makers don't.** Market makers post resting quotes (they're the
  passive side), so they avoid the taker fee and keep earning the spread — which is
  exactly why liquidity provision is a viable business.
- **Overtrading bleeds.** Crank the fee up and the high-churn agents (noise, and
  anything that flips often) slowly lose to costs, while patient strategies suffer
  less. Turn it to zero for a frictionless market.

---

## 9. Profit-Taking & Stop-Losses

Most agents carry two exit rules relative to their average cost (defaulting to
about ±6%), and these rules shape the price action in important ways.

- **Take-profit:** once a holding is up by the target percent, the agent sells to
  lock in the gain. Because many agents bought around similar prices, their
  take-profit levels cluster **above** cost — creating a band of selling, i.e.
  **resistance**, that a rally has to chew through.
- **Stop-loss:** once a holding is down by the target percent, the agent sells to
  cut the loss. The danger is a **cascade**: a falling price trips one batch of
  stops, that selling pushes the price lower, which trips the next batch — a
  self-reinforcing plunge.
- These behaviors illustrate the **disposition effect** (the human tendency to
  realize gains and losses at reference points) and **reflexivity** (prices and
  behavior feeding back on each other, rather than prices merely reflecting
  fundamentals).

**In the app:** take-profit and stop-loss are tunable per agent (set to 0 to turn
off). Load up on agents with tight stops and then trigger bad news to watch a
cascade; loosen or disable them to see how much steadier the market becomes.

---

## 10. Feedback Loops & Emergent Phenomena

Zoom out and the whole market is a system of competing feedback loops. Which
behavior dominates is decided by the **mix of participants**, not by any single
rule.

- **Positive feedback** (momentum, FOMO, stop-loss cascades) is
  self-**amplifying**. A move begets a bigger move. This is how **bubbles** and
  **crashes** form: price detaches from any fair value and overshoots.
- **Negative feedback** (mean-reversion, value investing, market-making) is
  self-**correcting**. It pushes back against extremes and produces **stability**
  and mean-reverting oscillation.
- The **balance between them** determines the regime:
  - momentum-heavy → **trending and bubble-prone**
  - reversion/value-heavy → **calm and range-bound**
  - a blend → realistic churn with occasional runs
- **Liquidity crises** are the extreme case: if the sell side (or buy side) of
  the book thins out — few makers, a small float, or a stampede all going one
  way — even a modest order produces enormous slippage and the price gaps
  violently. Liquidity, not just sentiment, sets how far a given order moves the
  market.

The key lesson: **the price path is an emergent property of the population.**
Change who's in the room, and you change the market's entire personality.

---

## Try These Experiments

Use the agent panel to add/remove/tune participants, the supply bar to change the
float, the news controls to inject sentiment, and the trade panel to place your
own orders. Then try:

- **See slippage directly.** Remove or zero out the agents so the book is quiet,
  then place one large market buy (e.g. 1000 shares). Watch the fill price and
  the reported slippage — your order alone walks the book.

- **Grow a trend / bubble.** Clear the board, add only momentum agents, and nudge
  the price with a small buy or a bit of good news. The positive feedback loop
  takes over and a trend (and eventually a reversal) forms on its own.

- **Stabilize it.** Into that momentum-driven market, add mean-reversion (or
  value) agents. Watch the swings shrink as the negative-feedback crowd fades
  every extreme.

- **Create scarcity.** Shrink the shares outstanding in the supply bar, then buy.
  With the ask side thinned out, the same order spikes the price far more than it
  did with a large float.

- **Trade the news.** Add several news/informed agents, then hit "Good news" or
  "Bad news." Watch sentiment jump and the informed traders push the price in
  that direction — then watch it fade as sentiment decays.

- **Tighten the spread.** Add a market-maker agent and compare the bid/ask before
  and after. Its inside quotes narrow the spread and smooth your fills.

- **Trigger a cascade.** Give agents tight stop-losses, build up a rally, then
  hit them with bad news. Watch stops trip in sequence and drive a sharp drop.

- **Watch conservation.** Keep an eye on the supply bar's ownership split as you
  and the agents trade. Shares only move between the market maker, the agents,
  and you — the total never changes unless you change it.

---

## Caveats & Simplifications

This is a **teaching model**, not a faithful replica of real markets. Keep the
simplifications in mind:

- **One stock, one market.** No portfolios across assets, no correlations, no
  index effects, no macroeconomy.
- **Liquidity is only what participants post.** There is no synthetic backstop, so
  a market with no market makers genuinely goes illiquid — realistic, but it means
  the seeded market relies on its maker agents to stay alive.
- **Simplified matching.** Discrete ticks, a single price-time-priority book, and
  simplified order types. Any unfilled market-order remainder is simply dropped.
- **Few frictions.** There *is* a taker fee (to the broker) and quarterly
  dividends, but no commissions, taxes, borrow fees, latency, circuit breakers,
  or auctions.
- **Stylized fundamentals.** Fair value is derived from a simple **earnings** model
  (EPS × a fixed multiple), moved by earnings reports and news — but there are no
  real cash flows, balance sheets, interest rates, or analyst consensus underneath,
  and it's a single shared estimate rather than many subjective ones.
- **Simplified shorting/leverage.** Shorting is collateralized crudely (by cash,
  with a simple maintenance-margin buy-in) rather than a real securities-lending
  market with borrow fees and locate constraints.
- **Agents are caricatures.** Each follows one tidy rule. Real participants blend
  many motives, adapt, and learn — which the sim does not attempt.

Within those bounds, the sim faithfully demonstrates the mechanics that matter:
**price emerges from order flow, liquidity is finite, supply is conserved, and
the mix of participants decides whether a market trends, oscillates, or stays
calm.**
