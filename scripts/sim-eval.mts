/**
 * Headless evaluation harness for tuning the simulator.
 *
 * Usage:  npx tsx scripts/sim-eval.mts <config.json | inline-json>
 *
 * Config (all fields optional; omitted -> current engine/agent defaults):
 * {
 *   "ticks": 2000,
 *   "autoNews": true,
 *   "dividendPerShare": 0.04,
 *   "feeBps": 5,
 *   "fundamentalImpact": 0.03,
 *   "sentimentDecay": 0.92,
 *   "seed": [ { "type": "marketMaker", "capital": 300000, "params": { "levels": 6 } }, ... ]
 * }
 *
 * Prints a JSON metrics object to stdout.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_CAST } from '../src/sim/defaultCast';
import { SimulationEngine } from '../src/sim/engine';
import type { AgentType, TraderStyle } from '../src/sim/types';

interface SeedEntry { type: AgentType; capital: number; style?: TraderStyle; params?: Record<string, number> }
interface Config {
  ticks?: number;
  autoNews?: boolean;
  dividendYieldPct?: number;
  feeBps?: number;
  fundamentalImpact?: number;
  sentimentDecay?: number;
  optionsEnabled?: boolean;
  seed?: SeedEntry[];
}

// The cast is imported, NOT duplicated: a hand-copied seed here silently drifted from the
// app's (6 holders vs 3, plus a stray contrarian desk), which meant this harness was grading a
// different market than the app runs. Every tuning decision is made on these numbers.
const DEFAULT_SEED: SeedEntry[] = DEFAULT_CAST;

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

function evaluate(cfg: Config) {
  const e = new SimulationEngine();
  e.autoNews = cfg.autoNews ?? true;
  if (cfg.dividendYieldPct != null) e.dividendYieldPct = cfg.dividendYieldPct;
  if (cfg.feeBps != null) e.feeBps = cfg.feeBps;
  if (cfg.fundamentalImpact != null) e.fundamentalImpact = cfg.fundamentalImpact;
  if (cfg.sentimentDecay != null) e.sentimentDecay = cfg.sentimentDecay;
  e.enableOptions(cfg.optionsEnabled ?? true);

  for (const s of cfg.seed ?? DEFAULT_SEED) {
    const a = e.addAgent(s.type, s.capital, s.style);
    if (s.params) e.updateAgentParams(a.id, s.params);
  }

  const ticks = cfg.ticks ?? 2000;
  const startCash = e.agents.reduce((s, a) => s + a.cash, 0) + e.user.cash;
  const prices: number[] = [];
  const returns: number[] = [];
  const trackErr: number[] = [];
  // SIGNED gap, not just |gap|. Absolute tracking error hides direction, and the market turned
  // out to sit at a persistent one-sided DISCOUNT to fair value rather than oscillating around
  // it — which absolute error cannot show, and which changes what a fix has to do.
  const signedGap: number[] = [];
  const spreadBps: number[] = [];
  let liveTicks = 0;

  for (let i = 0; i < ticks; i++) {
    e.step();
    const p = e.currentPrice;
    prices.push(p);
    if (prices.length > 1) {
      const prev = prices[prices.length - 2];
      if (prev > 0) returns.push((p - prev) / prev);
    }
    const fair = e.fundamentalValue;
    if (fair > 0 && i > ticks / 2) {
      trackErr.push(Math.abs(p - fair) / fair);
      signedGap.push((p - fair) / fair); // + = trading above fair, - = at a discount
    }
    const bb = e.bestBid, ba = e.bestAsk;
    if (bb != null && ba != null) { liveTicks++; spreadBps.push(((ba - bb) / ((ba + bb) / 2)) * 10000); }
  }

  const endCash = e.agents.reduce((s, a) => s + a.cash, 0) + e.user.cash;
  const solvent = e.agents.filter((a) => a.cash + a.shares * e.currentPrice > 0).length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const pct = (xs: number[], q: number) => {
    if (!xs.length) return 0;
    const v = [...xs].sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(q * v.length))];
  };
  const frac = (xs: number[], f: (x: number) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0);

  return {
    trackingErrorPct: +(mean(trackErr) * 100).toFixed(2),
    signedGapMeanPct: +(mean(signedGap) * 100).toFixed(2),
    fracAboveFairPct: +(frac(signedGap, (x) => x > 0.015) * 100).toFixed(1),
    fracBelowFairPct: +(frac(signedGap, (x) => x < -0.015) * 100).toFixed(1),
    p90TrackingPct: +(pct(trackErr, 0.9) * 100).toFixed(2),
    volatilityPct: +(std(returns) * 100).toFixed(3),
    avgSpreadBps: +mean(spreadBps).toFixed(1),
    liveFractionPct: +((liveTicks / ticks) * 100).toFixed(1),
    priceMin: +Math.min(...prices).toFixed(1),
    priceMax: +Math.max(...prices).toFixed(1),
    priceFinal: +e.currentPrice.toFixed(1),
    fairFinal: +e.fundamentalValue.toFixed(1),
    cashDriftPct: +(((endCash - startCash) / startCash) * 100).toFixed(1),
    solventPct: +((solvent / e.agents.length) * 100).toFixed(0),
    tradesPerTick: +(e.trades.length / Math.min(ticks, 500)).toFixed(2),
    agents: e.agents.length,
    float: +e.sharesOutstanding.toFixed(0),
  };
}

const arg = process.argv[2] ?? '{}';
const cfg: Config = arg.trim().startsWith('{') ? JSON.parse(arg) : JSON.parse(readFileSync(arg, 'utf8'));
console.log(JSON.stringify(evaluate(cfg), null, 2));
