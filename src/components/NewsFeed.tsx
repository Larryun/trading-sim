import { SentimentChart } from './SentimentChart';
import type { SentimentPoint } from '../hooks/useSimulation';
import { colors, tabularNums, pnlColor } from '../ui';
import { SectionHeaderRow } from './kit';

interface Props {
  sentimentSeries: SentimentPoint[];
  sentiment: number;
  autoNews: boolean;
  triggerEvent: (sentimentDelta: number) => void;
  toggleAutoNews: () => void;
}

const newsBtn = (bg: string): React.CSSProperties => ({
  flex: 1,
  padding: '8px 0',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  color: '#fff',
  background: bg,
});

export function NewsFeed({ sentimentSeries, sentiment, autoNews, triggerEvent, toggleAutoNews }: Props) {
  const sentColor = pnlColor(sentiment, 0.05);

  return (
    <div>
      <SectionHeaderRow right={
        <label style={{ fontSize: 12, color: colors.muted, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoNews} onChange={toggleAutoNews} />
          Auto events
        </label>
      }>News &amp; Sentiment</SectionHeaderRow>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button style={newsBtn(colors.up)} onClick={() => triggerEvent(1)}>📈 Good news</button>
        <button style={newsBtn(colors.down)} onClick={() => triggerEvent(-1)}>📉 Bad news</button>
      </div>

      <div style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>
        current sentiment <span style={{ ...tabularNums, color: sentColor, fontWeight: 600 }}>{sentiment.toFixed(2)}</span>
      </div>
      <SentimentChart series={sentimentSeries} />
    </div>
  );
}
