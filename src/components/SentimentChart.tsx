import { memo } from 'react';
import type { SentimentPoint } from '../hooks/useSimulation';
import { useContainerWidth } from './useContainerWidth';
import { colors, mono } from '../ui';

interface Props {
  series: SentimentPoint[];
}

const HEIGHT = 120;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 8;
const PAD_B = 16;

// Plain-SVG sentiment line with a zero baseline (no charting lib).
export const SentimentChart = memo(function SentimentChart({ series }: Props) {
  const [ref, width] = useContainerWidth();
  const plotW = Math.max(1, width - PAD_L - PAD_R);
  const plotH = HEIGHT - PAD_T - PAD_B;

  const vals = series.length ? series.map((p) => Math.abs(p.value)) : [0];
  const bound = Math.max(0.5, Math.ceil(Math.max(...vals) * 10) / 10);

  const x = (i: number) => PAD_L + (series.length <= 1 ? 0 : (i / (series.length - 1)) * plotW);
  const y = (v: number) => PAD_T + (1 - (v + bound) / (2 * bound)) * plotH;

  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  return (
    <div ref={ref} style={{ width: '100%', height: HEIGHT }}>
      <svg width={width} height={HEIGHT}>
        {[bound, 0, -bound].map((t, i) => {
          const yy = y(t);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={yy} x2={width - PAD_R} y2={yy} stroke={colors.border} strokeDasharray={t === 0 ? undefined : '3 3'} />
              <text x={PAD_L - 6} y={yy + 3} textAnchor="end" fontSize={11} fontFamily={mono} fill={colors.muted}>{t.toFixed(1)}</text>
            </g>
          );
        })}
        {series.length > 1 && <polyline points={points} fill="none" stroke={colors.accent} strokeWidth={2} />}
      </svg>
    </div>
  );
});
