import { memo, useEffect, useRef, useState } from 'react';
import type { Bar } from '../sim/bars';

interface Props {
  bars: Bar[];
}

const HEIGHT = 260;
const PAD_LEFT = 56;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;
const UP = '#4ade80';
const DOWN = '#f87171';

export const CandleChart = memo(function CandleChart({ bars }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plotW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const highs = bars.length ? bars.map((b) => b.high) : [101];
  const lows = bars.length ? bars.map((b) => b.low) : [99];
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const pad = Math.max((max - min) * 0.1, 0.5);
  const yMax = max + pad;
  const yMin = min - pad;
  const range = yMax - yMin || 1;

  const yScale = (price: number) => PAD_TOP + (1 - (price - yMin) / range) * plotH;

  // Only show the most recent candles that fit at a readable width.
  const slotW = plotW / Math.max(bars.length, 1);
  const bodyW = Math.max(1, Math.min(slotW * 0.7, 14));

  const gridLines = 5;
  const yTicks = Array.from({ length: gridLines + 1 }, (_, i) => yMin + (range * i) / gridLines);

  return (
    <div ref={containerRef} style={{ width: '100%', height: HEIGHT }}>
      <svg width={width} height={HEIGHT}>
        {/* horizontal gridlines + price labels */}
        {yTicks.map((price, i) => {
          const y = yScale(price);
          return (
            <g key={i}>
              <line x1={PAD_LEFT} y1={y} x2={width - PAD_RIGHT} y2={y} stroke="#2a2a3a" strokeDasharray="3 3" />
              <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fontSize={11} fill="#888">
                {price.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* candles */}
        {bars.map((b, i) => {
          const cx = PAD_LEFT + slotW * (i + 0.5);
          const up = b.close >= b.open;
          const color = up ? UP : DOWN;
          const bodyTop = yScale(Math.max(b.open, b.close));
          const bodyBottom = yScale(Math.min(b.open, b.close));
          const bodyH = Math.max(1, bodyBottom - bodyTop);
          return (
            <g key={b.index}>
              <line x1={cx} y1={yScale(b.high)} x2={cx} y2={yScale(b.low)} stroke={color} strokeWidth={1} />
              <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
            </g>
          );
        })}
      </svg>
    </div>
  );
});
