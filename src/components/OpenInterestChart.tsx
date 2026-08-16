import { useContainerWidth } from './useContainerWidth';
import { colors, mono } from '../ui';

interface Row {
  strike: number;
  callOi: number;
  putOi: number;
  callGamma: number;
  putGamma: number;
}

/**
 * Open interest by strike — the "gamma wall" view. Calls plot up (green), puts down
 * (red), with a dashed marker at spot. Where OI piles up is where dealer hedging
 * pressure concentrates, so these walls are what price tends to accelerate through
 * or pin against.
 */
export function OpenInterestChart({ rows, spot, height = 150 }: { rows: Row[]; spot: number; height?: number }) {
  const [ref, width] = useContainerWidth();
  const PAD_T = 14, PAD_B = 18, PAD_L = 4, PAD_R = 4;
  const plotH = height - PAD_T - PAD_B;
  const midY = PAD_T + plotH / 2;

  const maxOi = Math.max(1, ...rows.map((r) => Math.max(r.callOi, r.putOi)));
  const sorted = [...rows].sort((a, b) => a.strike - b.strike);
  const n = Math.max(1, sorted.length);
  const slot = (width - PAD_L - PAD_R) / n;
  const bw = Math.min(slot * 0.5, 26);

  // The bars sit on an ORDINAL (evenly-spaced) scale, so the spot marker has to be placed
  // on that same scale — interpolating between the two strikes that bracket spot. Using a
  // linear price scale here would misplace the marker (and pin it to an edge once spot
  // leaves the strike range).
  const cxOf = (i: number) => PAD_L + slot * (i + 0.5);
  let spotX = cxOf(0);
  if (sorted.length === 1) spotX = cxOf(0);
  else if (spot <= sorted[0].strike) spotX = cxOf(0);
  else if (spot >= sorted[sorted.length - 1].strike) spotX = cxOf(sorted.length - 1);
  else {
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].strike, b = sorted[i + 1].strike;
      if (spot >= a && spot <= b) {
        const t = b > a ? (spot - a) / (b - a) : 0;
        spotX = cxOf(i) + t * (cxOf(i + 1) - cxOf(i));
        break;
      }
    }
  }

  const totalOi = rows.reduce((s, r) => s + r.callOi + r.putOi, 0);

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {totalOi === 0 ? (
        <div style={{ color: colors.muted, fontSize: 12, padding: 8 }}>
          No open interest yet — buy an option below, or add an <b>Options speculator</b> agent, to build positions the dealer must hedge.
        </div>
      ) : (
        <svg width={width} height={height}>
          <line x1={0} y1={midY} x2={width} y2={midY} stroke={colors.border} />
          {/* spot marker */}
          <line x1={spotX} y1={PAD_T - 6} x2={spotX} y2={PAD_T + plotH} stroke={colors.accent} strokeDasharray="3 3" />
          <text x={spotX} y={PAD_T - 8} textAnchor="middle" fontSize={9} fontFamily={mono} fill={colors.accent}>spot {spot.toFixed(0)}</text>

          {sorted.map((r, i) => {
            const cx = PAD_L + slot * (i + 0.5);
            const ch = (r.callOi / maxOi) * (plotH / 2);
            const ph = (r.putOi / maxOi) * (plotH / 2);
            return (
              <g key={r.strike}>
                {r.callOi > 0 && <rect x={cx - bw / 2} y={midY - ch} width={bw} height={ch} fill={colors.up} fillOpacity={0.75} />}
                {r.putOi > 0 && <rect x={cx - bw / 2} y={midY} width={bw} height={ph} fill={colors.down} fillOpacity={0.75} />}
                <text x={cx} y={height - 5} textAnchor="middle" fontSize={9} fontFamily={mono} fill={colors.muted}>{r.strike}</text>
              </g>
            );
          })}
          <text x={PAD_L} y={PAD_T + 4} fontSize={9} fontFamily={mono} fill={colors.up}>calls ▲ {maxOi} max</text>
          <text x={PAD_L} y={height - PAD_B + 2} fontSize={9} fontFamily={mono} fill={colors.down}>puts ▼</text>
        </svg>
      )}
    </div>
  );
}
