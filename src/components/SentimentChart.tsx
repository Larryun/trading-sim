import { memo, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import type { SentimentPoint } from '../hooks/useSimulation';

interface Props {
  series: SentimentPoint[];
}

export const SentimentChart = memo(function SentimentChart({ series }: Props) {
  const bound = useMemo(() => {
    const values = series.length ? series.map((p) => Math.abs(p.value)) : [0];
    return Math.max(0.5, Math.ceil(Math.max(...values) * 10) / 10);
  }, [series]);

  return (
    <div style={{ width: '100%', height: 120 }}>
      <ResponsiveContainer>
        <LineChart data={series} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
          <XAxis dataKey="index" stroke="#888" tick={{ fontSize: 11 }} />
          <YAxis domain={[-bound, bound]} stroke="#888" tick={{ fontSize: 11 }} width={44} />
          <ReferenceLine y={0} stroke="#555" />
          <Tooltip
            contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 6 }}
            labelStyle={{ color: '#aaa' }}
          />
          <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});
