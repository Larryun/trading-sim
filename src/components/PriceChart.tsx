import { memo } from 'react';
import type { Bar } from '../sim/bars';
import { useContainerWidth } from './useContainerWidth';

interface Props {
  bars: Bar[];
}

const HEIGHT = 260;
const PAD_L = 56;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 20;

// Plain-SVG line chart (no charting lib) so it doesn't retain memory over a long
// live session. Plots each bar's close.
export const PriceChart = memo(function PriceChart({ bars }: Props) {
  const [ref, width] = useContainerWidth();
  const plotW = Math.max(1, width - PAD_L - PAD_R);
  const plotH = HEIGHT - PAD_T - PAD_B;

  const closes = bars.length ? bars.map((b) => b.close) : [100];
  const max = Math.max(...closes);
  const min = Math.min(...closes);
  const pad = Math.max((max - min) * 0.1, 1);
  const yMax = max + pad;
  const yMin = min - pad;
  const range = yMax - yMin || 1;

  const x = (i: number) => PAD_L + (bars.length <= 1 ? 0 : (i / (bars.length - 1)) * plotW);
  const y = (v: number) => PAD_T + (1 - (v - yMin) / range) * plotH;

  const points = bars.map((b, i) => `${x(i).toFixed(1)},${y(b.close).toFixed(1)}`).join(' ');
  const ticks = Array.from({ length: 6 }, (_, i) => yMin + (range * i) / 5);

  return (
    <div ref={ref} style={{ width: '100%', height: HEIGHT }}>
      <svg width={width} height={HEIGHT}>
        {ticks.map((t, i) => {
          const yy = y(t);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={yy} x2={width - PAD_R} y2={yy} stroke="#2a2a3a" strokeDasharray="3 3" />
              <text x={PAD_L - 6} y={yy + 3} textAnchor="end" fontSize={11} fill="#888">{t.toFixed(2)}</text>
            </g>
          );
        })}
        {bars.length > 1 && <polyline points={points} fill="none" stroke="#4ade80" strokeWidth={2} />}
      </svg>
    </div>
  );
});
