# Concepts: What Really Drives a Stock Price

## Introduction

The **Trading Price Simulator** is a browser-based sandbox for a single imaginary
stock. You can trade against a crowd of simulated participants, add or remove
those participants, tune how they behave, fire off news, and shrink or grow the
share supply — all while watching the price, volume, sentiment, and ownership
update tick by tick.

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

**Two kinds of orders:**

- A **market order** says "fill me now, at whatever price it takes." It **takes
  liquidity** — it consumes resting orders on the opposite side. The person
  sending it is a **taker**.
- A **limit order** says "fill me only at this price or better." Any part that
  can't fill immediately **rests in the book**, adding liquidity for others. The
  person posting it is a **maker**.

**Price-time priority:** orders are matched best-price-first, and among orders at
the same price, first-come-first-served. In the sim the book is kept sorted by
price with a stable sort, so earlier orders at a given price fill before later
ones — the same fairness rule real exchanges use.

**In the app:** the built-in market maker continuously posts a ladder of resting
bids and asks around the last price, so there is always a two-sided book for your
orders to hit. Your buys and sells (and the agents') arrive as market orders that
take from that book.

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
agent posts two-sided quotes with a configurable half-spread (`spreadBps`), quote
size, and inventory-skew strength; the tightest quotes among all makers set the
spread. Add more makers and the spread narrows; **remove them all and the book
empties — the market goes illiquid and trades stop until someone quotes again.**

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

**In the app:** the supply bar shows the ownership split between the market maker,
the agents, and you, and lets you set the total shares outstanding. Because the
maker's asks are **capped by the shares it actually holds**, shrinking the float
directly thins the sell side of the book — the mechanism behind squeezes and
scarcity rallies.

---

## 6. Agent Archetypes and the Behaviors They Create

The market's character comes from *who is trading*. Each agent type follows a
simple rule, but a **population** of them produces rich, emergent dynamics. You
can add, remove, and tune each type. Agents start with capital split roughly
half in cash and half in shares, so they can trade either direction immediately.

- **Noise traders** — buy or sell essentially at random, with an adjustable
  frequency and directional lean (`bias`). *Emergent effect:* random-walk jitter
  with no persistent trend. They are the market's background hum and provide the
  volume that other strategies feed on.

- **Momentum / trend-followers** — measure the recent price change over a
  lookback window and trade *with* it: buy when it's rising, sell when it's
  falling, sizing up as the move accelerates. *Emergent effect:* **positive
  feedback** — buying begets more buying. This is the engine of **trends and
  bubbles** (and, in reverse, crashes).

- **Mean-reversion traders** — compare price to a moving average and **fade**
  deviations: sell when price runs above its average, buy when it dips below,
  once the gap exceeds a threshold. *Emergent effect:* **negative feedback** —
  they lean against extremes, damping swings and pulling price back toward its
  recent center. A force for **stability**.

- **News / informed traders** — trade in the direction of current market
  **sentiment** (see section 7): buy on good news, sell on bad, sizing up with
  the strength of the signal. *Emergent effect:* they translate information
  shocks into directional price moves.

- **Value / fundamental investors** — anchor to an estimated **intrinsic "fair
  value"** and demand a **margin of safety**: buy only when price is well below
  fair value, sell when it's well above. *Emergent effect:* deeply **contrarian
  and stabilizing** — they buy when others panic and sell into euphoria, putting
  a floor under crashes and a ceiling on manias. Conceptually it's mean-reversion
  anchored to a fixed **fair value** rather than a recent moving average, and it
  **fades sentiment** (buys panics, sells euphoria).

- **FOMO herd (retail)** — chase *accelerating* up-moves, piling in late as a
  rally steepens. *Emergent effect:* they pour fuel on bubbles near the top and
  then get caught in the reversal, amplifying both the blow-off and the
  subsequent drop.

- **Whale / large institution** — trades in **large size** with heavy price
  impact. It **accumulates** (buys quietly over time) or **distributes** (sells
  into strength), often **splitting orders** to disguise its footprint and limit
  slippage. *Emergent effect:* one big participant can bend the whole market.

- **Panic sellers** — dump holdings when losses mount. *Emergent effect:*
  **capitulation** and **stop-loss cascades** — one wave of selling drops the
  price, which triggers the next wave, producing sharp, self-reinforcing crashes.

- **Market maker** — provides liquidity and earns the spread (section 4). *Emergent
  effect:* tighter spreads, smoother fills, and a general damping of volatility.

> All nine archetypes above are implemented and can be added, removed, and tuned
> live from the Agents panel: noise, momentum, mean-reversion, news, market maker,
> value, FOMO herd, whale, and panic seller.

---

## 7. Sentiment & News Events

Real markets aren't a pure random walk because **information keeps arriving**.
The sim models this as discrete **news events**.

- Firing a news event injects a burst of **sentiment** — positive (bullish) or
  negative (bearish) — accompanied by a headline.
- Sentiment **decays** toward zero over the following ticks (each tick it shrinks
  to a fraction of its previous value). So news drives a *burst* of directional
  flow, not a permanent level shift — unless fresh news keeps arriving.
- **News/informed agents react** to the standing sentiment, buying or selling in
  its direction and thereby moving the price.

**In the app:** use the "Good news" / "Bad news" buttons to inject sentiment
manually, or toggle **Auto events** to have random headlines fire on their own.
The sentiment chart shows the level rising on a shock and decaying back to zero
between events. With no news agents present, news does little; add some and watch
each headline translate into a price move.

---

## 8. Capital Constraints, Positions & PnL

Every participant — agents and you — has a real, finite account: some **cash**
and some **shares**. Orders are constrained by that account.

- **You can't spend cash you don't have** — buys are limited by available cash
  (with a little headroom for slippage).
- **No naked shorting** — you can't sell shares you don't own. Sell orders are
  capped at your current share count, so a position can never go negative. (Your
  *buys*, however, are limited only by the available float, so a big buy really
  can shock the price.)
- Each account tracks an **average cost basis** — the blended price you paid for
  the shares you hold, updated each time you buy more.
- **Realized PnL** is profit/loss locked in when you *sell* (sale price minus
  average cost, times shares sold). **Unrealized PnL** is the paper gain/loss on
  shares you still hold, marked at the current price. Realized is booked;
  unrealized moves every tick with the price.

**In the app:** the trade panel shows your cash, shares, average cost, equity,
and unrealized PnL; the order-history view logs each executed order with its
average fill price and any realized gain.

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
- **No frictions.** No commissions, no fees, no taxes, no bid-ask cost beyond the
  modeled spread, no latency, no partial-day mechanics, no circuit breakers.
- **No real fundamentals.** "Sentiment" is an abstract number and "fair value"
  (for value agents) is a modeling assumption — there are no earnings, cash
  flows, or balance sheets underneath.
- **Simplified shorting/leverage.** No naked shorting and no margin; accounts are
  constrained to cash and shares on hand.
- **Agents are caricatures.** Each follows one tidy rule. Real participants blend
  many motives, adapt, and learn — which the sim does not attempt.

Within those bounds, the sim faithfully demonstrates the mechanics that matter:
**price emerges from order flow, liquidity is finite, supply is conserved, and
the mix of participants decides whether a market trends, oscillates, or stays
calm.**
