/**
 * ENGINE MEMORY AUDIT — headless, no React/DOM/Recharts.
 *
 * Builds the engine with the EXACT current default seed from
 * src/hooks/useSimulation.ts createEngine(), enables autoNews, and runs 500,000
 * ticks. Every ~100k ticks it logs process.memoryUsage().heapUsed plus the size
 * of every retained structure that could conceivably grow without bound:
 *   - trades.length
 *   - events.length
 *   - userOrders.length
 *   - book resting-order count via book.getDepth(99999) (bids+asks levels)
 *   - raw resting-order counts (private bids/asks arrays)
 *   - ring buffer sizes (priceRing/buyVolRing/sellVolRing/sentimentRing)
 * Also verifies short selling is active (some agent.shares < 0) at least once.
 *
 * Run:  node --expose-gc scripts/engine-mem-audit.mts
 */
import { SimulationEngine } from '../src/sim/engine';
import type { AgentType } from '../src/sim/types';

// --- mirror useSimulation.ts createEngine() EXACTLY (current version) ---
function createEngine(): SimulationEngine {
  const engine = new SimulationEngine();
  for (let i = 0; i < 5; i++) engine.addAgent('marketMaker', 750000);
  for (let i = 0; i < 4; i++) engine.addAgent('value', 500000);
  engine.addAgent('momentum', 30000);
  engine.addAgent('momentum', 30000);
  engine.addAgent('noise', 25000);
  engine.addAgent('noise', 25000);
  engine.addAgent('panicSeller', 40000);
  engine.addAgent('panicSeller', 40000);
  engine.addAgent('news', 40000);
  return engine;
}

const TICKS = 500_000;
const SAMPLE_EVERY = 100_000;
const CAN_SHORT = new Set<AgentType>(['value', 'meanReversion', 'momentum', 'news']);

const engine = createEngine();
engine.autoNews = true;

const gc: (() => void) | undefined = (globalThis as unknown as { gc?: () => void }).gc;

// Reach into private OrderBook fields for raw resting-order counts (probe only).
function rawResting(): { bids: number; asks: number } {
  const book = engine.book as unknown as { bids: unknown[]; asks: unknown[] };
  return { bids: book.bids.length, asks: book.asks.length };
}

function ringSizes() {
  const e = engine as unknown as {
    priceRing: { size: number };
    buyVolRing: { size: number };
    sellVolRing: { size: number };
    sentimentRing: { size: number };
  };
  return {
    price: e.priceRing.size,
    buyVol: e.buyVolRing.size,
    sellVol: e.sellVolRing.size,
    sentiment: e.sentimentRing.size,
  };
}

// Track that short selling actually happens over the run.
let everShorted = false;
let maxShortShares = 0; // most-negative agent.shares seen (as a positive magnitude)
let maxCoverTrades = 0; // biggest single-tick trade count (squeeze proxy)

function scanShorts(): void {
  for (const a of engine.agents) {
    if (a.shares < 0) {
      everShorted = true;
      if (-a.shares > maxShortShares) maxShortShares = -a.shares;
    }
  }
}

function sample(tick: number, msPerStep: number): void {
  if (gc) gc();
  const m = process.memoryUsage();
  const raw = rawResting();
  const depth = engine.book.getDepth(99999);
  const rings = ringSizes();
  scanShorts();
  const shortAgents = engine.agents.filter((a) => a.shares < 0).length;
  console.log(
    JSON.stringify({
      tick,
      heapUsedMB: +(m.heapUsed / 1048576).toFixed(2),
      rssMB: +(m.rss / 1048576).toFixed(2),
      externalMB: +(m.external / 1048576).toFixed(2),
      arrayBuffersMB: +(m.arrayBuffers / 1048576).toFixed(2),
      trades: engine.trades.length,
      events: engine.events.length,
      userOrders: engine.userOrders.length,
      depthBidLevels: depth.bids.length,
      depthAskLevels: depth.asks.length,
      restingBids: raw.bids,
      restingAsks: raw.asks,
      restingTotal: raw.bids + raw.asks,
      ringPrice: rings.price,
      ringBuyVol: rings.buyVol,
      ringSellVol: rings.sellVol,
      ringSentiment: rings.sentiment,
      agents: engine.agents.length,
      shortAgentsNow: shortAgents,
      everShorted,
      maxShortShares: +maxShortShares.toFixed(2),
      price: +engine.currentPrice.toFixed(3),
      fundamental: +engine.fundamentalValue.toFixed(3),
      finite:
        Number.isFinite(engine.currentPrice) &&
        Number.isFinite(engine.fundamentalValue) &&
        Number.isFinite(engine.sentiment),
      msPerStep: +msPerStep.toFixed(6),
    }),
  );
}

sample(0, 0); // baseline: post-construction, pre-run

let done = 0;
while (done < TICKS) {
  const chunk = Math.min(SAMPLE_EVERY, TICKS - done);
  const t0 = performance.now();
  for (let i = 0; i < chunk; i++) {
    const tickTrades = engine.step();
    if (tickTrades.length > maxCoverTrades) maxCoverTrades = tickTrades.length;
    // Cheap per-tick short scan every 1000 ticks so we don't miss transient shorts.
    if (i % 1000 === 0) scanShorts();
  }
  const ms = (performance.now() - t0) / chunk;
  done += chunk;
  sample(done, ms);
}

console.log(
  JSON.stringify({
    summary: true,
    everShorted,
    maxShortShares: +maxShortShares.toFixed(2),
    maxSingleTickTrades: maxCoverTrades,
  }),
);
