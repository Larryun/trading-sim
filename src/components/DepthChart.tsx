import type { BookLevel } from '../sim/orderBook';
import { useContainerWidth } from './useContainerWidth';
import { colors, mono } from '../ui';

/**
 * Market-depth ("DOM") chart: cumulative resting size as a step area — bids in green
 * cumulating away from the touch on the left, asks in red on the right, with the
 * spread as the gap in the middle. Taller/steeper walls = deeper liquidity.
 */
export function DepthChart({ bids, asks, height = 150 }: { bids: BookLevel[]; asks: BookLevel[]; height?: number }) {
  const [ref, width] = useContainerWidth();
  const PAD_L = 4, PAD_R = 4, PAD_T = 8, PAD_B = 16;

  // Cumulative depth from the touch outward.
  const bidCum: { price: number; cum: number }[] = [];
  let b = 0;
  for (const l of bids) { b += l.size; bidCum.push({ price: l.price, cum: b }); }
  const askCum: { price: number; cum: number }[] = [];
  let a = 0;
  for (const l of asks) { a += l.size; askCum.push({ price: l.price, cum: a }); }

  const empty = bidCum.length === 0 && askCum.length === 0;
  const prices = [...bidCum, ...askCum].map((p) => p.price);
  const xMin = empty ? 0 : Math.min(...prices);
  const xMax = empty ? 1 : Math.max(...prices);
  const yMax = Math.max(1, b, a);
  const plotW = Math.max(1, width - PAD_L - PAD_R);
  const plotH = height - PAD_T - PAD_B;
  const x = (p: number) => PAD_L + (xMax > xMin ? (p - xMin) / (xMax - xMin) : 0.5) * plotW;
  const y = (c: number) => PAD_T + (1 - c / yMax) * plotH;
  const baseY = PAD_T + plotH;

  // Step-area path for one side. `sorted` is by ascending price.
  const area = (pts: { price: number; cum: number }[]): string => {
    if (pts.length === 0) return '';
    const sorted = [...pts].sort((p, q) => p.price - q.price);
    let d = `M${x(sorted[0].price).toFixed(1)},${baseY.toFixed(1)}`;
    let prevX = x(sorted[0].price);
    for (const pt of sorted) {
      const yy = y(pt.cum).toFixed(1);
      d += ` L${prevX.toFixed(1)},${yy} L${x(pt.price).toFixed(1)},${yy}`; // step: horizontal then to point height
      prevX = x(pt.price);
    }
    d += ` L${prevX.toFixed(1)},${baseY.toFixed(1)} Z`;
    return d;
  };

  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;
  const midX = bestBid != null && bestAsk != null ? x((bestBid + bestAsk) / 2) : null;

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {empty ? (
        <div style={{ color: colors.muted, padding: 8, fontSize: 12 }}>Book is empty.</div>
      ) : (
        <svg width={width} height={height}>
          <path d={area(bidCum)} fill={`${colors.up}33`} stroke={colors.up} strokeWidth={1.25} />
          <path d={area(askCum)} fill={`${colors.down}33`} stroke={colors.down} strokeWidth={1.25} />
          {midX != null && <line x1={midX} y1={PAD_T} x2={midX} y2={baseY} stroke={colors.border} strokeDasharray="2 3" />}
          {/* price axis: min / mid / max */}
          <text x={PAD_L} y={height - 4} fontSize={10} fontFamily={mono} fill={colors.muted}>${xMin.toFixed(2)}</text>
          {bestBid != null && bestAsk != null && (
            <text x={midX ?? 0} y={height - 4} textAnchor="middle" fontSize={10} fontFamily={mono} fill={colors.muted}>${((bestBid + bestAsk) / 2).toFixed(2)}</text>
          )}
          <text x={width - PAD_R} y={height - 4} textAnchor="end" fontSize={10} fontFamily={mono} fill={colors.muted}>${xMax.toFixed(2)}</text>
          {/* depth axis top label */}
          <text x={PAD_L} y={PAD_T + 2} fontSize={10} fontFamily={mono} fill={colors.muted}>{Math.round(yMax).toLocaleString()} sh</text>
        </svg>
      )}
    </div>
  );
}
