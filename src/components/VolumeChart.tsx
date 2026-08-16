import { memo } from 'react';
import type { VolumeBar } from '../sim/bars';
import { useContainerWidth } from './useContainerWidth';
import { colors } from '../ui';

interface Props {
  volumeBars: VolumeBar[];
}

const HEIGHT = 84;
const PAD_L = 56;
const PAD_R = 12;
const PAD_B = 2;

// Plain-SVG buy/sell volume bars (no charting lib).
export const VolumeChart = memo(function VolumeChart({ volumeBars }: Props) {
  const [ref, width] = useContainerWidth();
  const plotW = Math.max(1, width - PAD_L - PAD_R);
  const plotH = HEIGHT - PAD_B - 2;
  const max = Math.max(1, ...volumeBars.map((b) => Math.max(b.buy, b.sell)));
  const slot = plotW / Math.max(volumeBars.length, 1);
  const bw = Math.max(1, Math.min(slot / 2 - 0.5, 8));

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: colors.muted, marginBottom: 2 }}>
        <span><span style={{ color: colors.up }}>■</span> buy volume</span>
        <span><span style={{ color: colors.down }}>■</span> sell volume</span>
      </div>
      <div ref={ref} style={{ width: '100%', height: HEIGHT }}>
        <svg width={width} height={HEIGHT}>
          {volumeBars.map((b, i) => {
            const cx = PAD_L + slot * (i + 0.5);
            const buyH = (b.buy / max) * plotH;
            const sellH = (b.sell / max) * plotH;
            const base = HEIGHT - PAD_B;
            return (
              <g key={i}>
                <rect x={cx - bw} y={base - buyH} width={bw} height={buyH} fill={colors.up} />
                <rect x={cx} y={base - sellH} width={bw} height={sellH} fill={colors.down} />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
});
