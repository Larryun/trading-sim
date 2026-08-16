// Minimal Black-Scholes for the options layer: price + the two greeks the sim needs
// (delta for hedging direction, gamma for the squeeze feedback). Rates are ~0.

export type OptionType = 'call' | 'put';

/** One tradeable option contract in the chain. */
export interface OptionContract {
  id: number;
  type: OptionType;
  strike: number;
  expiryTick: number;
}

// Abramowitz-Stegun standard-normal CDF (good to ~1e-7).
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function normPdf(x: number): number {
  return 0.3989422804014327 * Math.exp(-x * x / 2);
}

export interface Greeks {
  price: number;
  delta: number; // ∂price/∂spot (calls 0..1, puts -1..0)
  gamma: number; // ∂delta/∂spot (always ≥ 0 for a long option)
  vega: number; // ∂price/∂vol, per 1.00 (100 vol points) of implied vol
  theta: number; // ∂price/∂time, per YEAR (negative for a long option = time decay)
}

/**
 * Black-Scholes price and greeks. `tau` is time to expiry in YEARS, `vol` is
 * annualized volatility, `r` the risk-free rate (default 0).
 */
export function blackScholes(type: OptionType, spot: number, strike: number, tau: number, vol: number, r = 0): Greeks {
  if (tau <= 1e-9 || vol <= 1e-9 || spot <= 0) {
    // At/after expiry (or no vol): value is pure intrinsic, delta is a step, rest vanish.
    const intrinsic = type === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
    const itm = type === 'call' ? spot > strike : spot < strike;
    return { price: intrinsic, delta: itm ? (type === 'call' ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0 };
  }
  const sqrtT = Math.sqrt(tau);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * vol * vol) * tau) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const disc = Math.exp(-r * tau);
  const pdf1 = normPdf(d1);
  const gamma = pdf1 / (spot * vol * sqrtT);
  const vega = spot * pdf1 * sqrtT; // same for calls and puts
  // Theta: time decay (per year). The first term is the shared vol-decay piece.
  const decay = -(spot * pdf1 * vol) / (2 * sqrtT);
  if (type === 'call') {
    return {
      price: spot * normCdf(d1) - strike * disc * normCdf(d2),
      delta: normCdf(d1),
      gamma, vega,
      theta: decay - r * strike * disc * normCdf(d2),
    };
  }
  return {
    price: strike * disc * normCdf(-d2) - spot * normCdf(-d1),
    delta: normCdf(d1) - 1,
    gamma, vega,
    theta: decay + r * strike * disc * normCdf(-d2),
  };
}

/** Intrinsic value at expiry (cash settlement). */
export function intrinsicValue(type: OptionType, spot: number, strike: number): number {
  return type === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
}
