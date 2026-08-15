export interface Bar {
  index: number; // absolute bar number (stable across ticks)
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Aggregate a per-tick price series into OHLC bars of `interval` ticks each,
 * Robinhood/candlestick style.
 *
 * Bars are aligned to an *absolute* sample index (`startIndex` is the absolute
 * index of `priceHistory[0]`), so a given tick always falls in the same bar even
 * after old samples are trimmed from the front of the history. Without this,
 * chunking a sliding window re-buckets every tick and the candles visibly wobble.
 * The final (partial) bar is the currently-forming candle.
 */
export interface VolumeBar {
  index: number; // absolute bar number, aligned with the price bars
  buy: number;
  sell: number;
}

/**
 * Aggregate per-tick buy/sell volume into bars aligned to the same absolute
 * boundaries as `buildBars`, so each volume bar lines up with its price bar.
 */
export function buildVolumeBars(
  buyVol: number[],
  sellVol: number[],
  interval: number,
  startIndex = 0,
): VolumeBar[] {
  if (buyVol.length === 0 || interval < 1) return [];
  const bars: VolumeBar[] = [];
  let current: VolumeBar | null = null;
  let currentBarNo = -1;

  for (let i = 0; i < buyVol.length; i++) {
    const barNo = Math.floor((startIndex + i) / interval);
    if (barNo !== currentBarNo) {
      current = { index: barNo, buy: buyVol[i], sell: sellVol[i] ?? 0 };
      bars.push(current);
      currentBarNo = barNo;
    } else if (current) {
      current.buy += buyVol[i];
      current.sell += sellVol[i] ?? 0;
    }
  }
  return bars;
}

export function buildBars(priceHistory: number[], interval: number, startIndex = 0): Bar[] {
  if (priceHistory.length === 0 || interval < 1) return [];
  const bars: Bar[] = [];
  let current: Bar | null = null;
  let currentBarNo = -1;

  for (let i = 0; i < priceHistory.length; i++) {
    const price = priceHistory[i];
    const barNo = Math.floor((startIndex + i) / interval);
    if (barNo !== currentBarNo) {
      current = { index: barNo, open: price, high: price, low: price, close: price };
      bars.push(current);
      currentBarNo = barNo;
    } else if (current) {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
    }
  }
  return bars;
}
