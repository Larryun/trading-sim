import { memo, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { VolumeBar } from '../sim/bars';

interface Props {
  volumeBars: VolumeBar[];
}

export const VolumeChart = memo(function VolumeChart({ volumeBars }: Props) {
  const data = useMemo(() => volumeBars.map((b) => ({
    index: b.index,
    buy: Number(b.buy.toFixed(1)),
    sell: Number(b.sell.toFixed(1)),
  })), [volumeBars]);

  return (
    <div style={{ width: '100%', height: 84 }}>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#888', marginBottom: 2 }}>
        <span><span style={{ color: '#4ade80' }}>■</span> buy volume</span>
        <span><span style={{ color: '#f87171' }}>■</span> sell volume</span>
      </div>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 0 }} barGap={0} barCategoryGap="10%">
          <XAxis dataKey="index" stroke="#888" tick={{ fontSize: 11 }} />
          <YAxis stroke="#888" tick={{ fontSize: 11 }} width={56} />
          <Tooltip
            contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 6 }}
            labelStyle={{ color: '#aaa' }}
            cursor={{ fill: '#ffffff10' }}
          />
          <Bar dataKey="buy" fill="#4ade80" isAnimationActive={false} />
          <Bar dataKey="sell" fill="#f87171" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});
