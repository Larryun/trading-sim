import { memo, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { Bar } from '../sim/bars';

interface Props {
  bars: Bar[];
}

export const PriceChart = memo(function PriceChart({ bars }: Props) {
  const { data, min, max, pad } = useMemo(() => {
    const d = bars.map((b) => ({ index: b.index, close: Number(b.close.toFixed(2)) }));
    const closes = bars.length ? bars.map((b) => b.close) : [100];
    const lo = Math.min(...closes);
    const hi = Math.max(...closes);
    return { data: d, min: lo, max: hi, pad: Math.max((hi - lo) * 0.1, 1) };
  }, [bars]);

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
          <XAxis dataKey="index" stroke="#888" tick={{ fontSize: 11 }} />
          <YAxis
            domain={[Number((min - pad).toFixed(2)), Number((max + pad).toFixed(2))]}
            stroke="#888"
            tick={{ fontSize: 11 }}
            width={56}
          />
          <Tooltip
            contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 6 }}
            labelStyle={{ color: '#aaa' }}
          />
          <Line type="linear" dataKey="close" stroke="#4ade80" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});
