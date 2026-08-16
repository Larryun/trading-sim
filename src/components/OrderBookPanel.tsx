import type { BookLevel } from '../sim/orderBook';
import { SectionHeaderRow } from './kit';
import { DepthChart } from './DepthChart';
import { colors, tabularNums } from '../ui';

interface Props {
  bids: BookLevel[];
  asks: BookLevel[];
}

export function OrderBookPanel({ bids, asks }: Props) {
  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;

  return (
    <div>
      <SectionHeaderRow
        right={
          <span style={{ ...tabularNums, fontSize: 10, color: colors.muted }}>
            <span style={{ color: colors.up }}>{bestBid != null ? `$${bestBid.toFixed(2)}` : '—'}</span>
            {' · '}spread {spread != null ? `$${spread.toFixed(2)}` : '—'}{' · '}
            <span style={{ color: colors.down }}>{bestAsk != null ? `$${bestAsk.toFixed(2)}` : '—'}</span>
          </span>
        }
      >Market Depth</SectionHeaderRow>
      <DepthChart bids={bids} asks={asks} />
    </div>
  );
}
