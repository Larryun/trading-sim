import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import type { Bar } from '../sim/bars';

interface Props {
  bars: Bar[];
  fundamental?: number;
}

export function PriceChart({ bars, fundamental }: Props) {
  const data = bars.map((b) => ({ index: b.index, close: Number(b.close.toFixed(2)) }));

  // Pad the y-axis a little around the observed range so movement is visible.
  const closes = bars.length ? bars.map((b) => b.close) : [100];
  const min = Math.min(...closes, fundamental ?? Infinity);
  const max = Math.max(...closes, fundamental ?? -Infinity);
  const pad = Math.max((max - min) * 0.1, 1);

  return (
    <div style={{ width: '100%', height: 320 }}>
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
          {fundamental != null && (
            <ReferenceLine y={Number(fundamental.toFixed(2))} stroke="#22d3ee" strokeDasharray="4 4"
              label={{ value: 'fair', fill: '#22d3ee', fontSize: 10, position: 'insideTopLeft' }} />
          )}
          <Line type="linear" dataKey="close" stroke="#4ade80" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
