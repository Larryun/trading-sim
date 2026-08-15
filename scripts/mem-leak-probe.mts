/**
 * Headless MEMORY / LEAK probe for the simulation engine.
 *
 * Constructs the engine with the exact default seed from
 * src/hooks/useSimulation.ts createEngine(), enables autoNews, runs 150,000
 * ticks, and periodically logs heap usage plus the size of every structure that
 * could conceivably grow without bound. The goal is to prove definitively
 * whether the ENGINE (as opposed to the React/render layer) leaks.
 *
 * Run:  node --expose-gc scripts/mem-leak-probe.mts
 *       (--expose-gc optional; if present we force GC before each sample so the
 *        heap reading reflects retained/live memory, not transient garbage.)
 */
import { SimulationEngine } from '../src/sim/engine';

// --- mirror useSimulation.ts createEngine() exactly ---
function createEngine(): SimulationEngine {
  const engine = new SimulationEngine();
  engine.addAgent('marketMaker', 300000);
  engine.addAgent('marketMaker', 300000);
  engine.addAgent('noise', 20000);
  engine.addAgent('noise', 20000);
  engine.addAgent('momentum', 20000);
  engine.addAgent('meanReversion', 30000);
  engine.addAgent('news', 20000);
  engine.addAgent('value', 80000);
  engine.addAgent('value', 80000);
  engine.addAgent('value', 80000);
  engine.addAgent('fomoHerd', 20000);
  engine.addAgent('fomoHerd', 20000);
  engine.addAgent('panicSeller', 40000);
  engine.addAgent('panicSeller', 40000);
  return engine;
}

const TICKS = 150_000;
const SAMPLE_EVERY = 20_000;

const engine = createEngine();
engine.autoNews = true;

const gc: (() => void) | undefined = (globalThis as unknown as { gc?: () => void }).gc;

// Reach into private OrderBook fields for resting-order counts (probe only).
function restingCount(): { bids: number; asks: number; total: number } {
  const book = engine.book as unknown as { bids: unknown[]; asks: unknown[] };
  const bids = book.bids.length;
  const asks = book.asks.length;
  return { bids, asks, total: bids + asks };
}

function stepPerf(n: number): number {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) engine.step();
  return (performance.now() - t0) / n; // ms per step
}

interface Sample {
  tick: number;
  heapUsedMB: number;
  rssMB: number;
  externalMB: number;
  arrayBuffersMB: number;
  restingBids: number;
  restingAsks: number;
  restingTotal: number;
  trades: number;
  events: number;
  userOrders: number;
  agents: number;
  price: number;
  fundamental: number;
  finite: boolean;
  msPerStep: number;
}

const samples: Sample[] = [];

function sample(tick: number, msPerStep: number): void {
  if (gc) gc();
  const m = process.memoryUsage();
  const rc = restingCount();
  const price = engine.currentPrice;
  const fundamental = engine.fundamentalValue;
  const finite =
    Number.isFinite(price) &&
    Number.isFinite(fundamental) &&
    Number.isFinite(engine.sentiment) &&
    Number.isFinite(engine.sharesOutstanding);
  samples.push({
    tick,
    heapUsedMB: +(m.heapUsed / 1048576).toFixed(2),
    rssMB: +(m.rss / 1048576).toFixed(2),
    externalMB: +(m.external / 1048576).toFixed(2),
    arrayBuffersMB: +(m.arrayBuffers / 1048576).toFixed(2),
    restingBids: rc.bids,
    restingAsks: rc.asks,
    restingTotal: rc.total,
    trades: engine.trades.length,
    events: engine.events.length,
    userOrders: engine.userOrders.length,
    agents: engine.agents.length,
    price: +price.toFixed(3),
    fundamental: +fundamental.toFixed(3),
    finite,
    msPerStep: +msPerStep.toFixed(5),
  });
}

// Baseline sample at tick 0 (post-construction, pre-run).
sample(0, 0);

let done = 0;
while (done < TICKS) {
  const chunk = Math.min(SAMPLE_EVERY, TICKS - done);
  const ms = stepPerf(chunk);
  done += chunk;
  sample(done, ms);
}

// Also probe monotonic ID counters via a couple more steps to confirm they
// don't allocate — they are plain numbers, but report final trade id proxy.
const finalTrades = engine.trades.length;

console.log(JSON.stringify(samples, null, 2));

// --- summary / verdict ---
const first = samples[1]; // first post-run sample (20k)
const last = samples[samples.length - 1];
const heapGrowthMB = +(last.heapUsedMB - first.heapUsedMB).toFixed(2);
const ticksBetween = last.tick - first.tick;
const bytesPerTick = ((last.heapUsedMB - first.heapUsedMB) * 1048576) / ticksBetween;

const allFinite = samples.every((s) => s.finite);
const restingBounded = Math.max(...samples.map((s) => s.restingTotal));
const tradesBounded = Math.max(...samples.map((s) => s.trades));
const eventsBounded = Math.max(...samples.map((s) => s.events));

console.log('\n===== VERDICT =====');
console.log(`ticks run:            ${TICKS}`);
console.log(`heap @20k:            ${first.heapUsedMB} MB`);
console.log(`heap @150k:           ${last.heapUsedMB} MB`);
console.log(`heap growth 20k->150k:${heapGrowthMB} MB over ${ticksBetween} ticks (${bytesPerTick.toFixed(3)} bytes/tick)`);
console.log(`rss @150k:            ${last.rssMB} MB`);
console.log(`arrayBuffers @150k:   ${last.arrayBuffersMB} MB`);
console.log(`max resting orders:   ${restingBounded}`);
console.log(`max trades array:     ${tradesBounded}`);
console.log(`max events array:     ${eventsBounded}`);
console.log(`userOrders @150k:     ${last.userOrders}`);
console.log(`final trades length:  ${finalTrades}`);
console.log(`price/fundamental finite the whole run: ${allFinite}`);
console.log(`price @150k:          ${last.price}   fundamental @150k: ${last.fundamental}`);
console.log(`gc forced before samples: ${gc ? 'yes' : 'no (run with --expose-gc for cleaner numbers)'}`);
