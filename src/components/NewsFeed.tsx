import { SentimentChart } from './SentimentChart';
import type { SentimentPoint } from '../hooks/useSimulation';

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
  const sentColor = sentiment > 0.05 ? '#4ade80' : sentiment < -0.05 ? '#f87171' : '#888';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>News &amp; Sentiment</h3>
        <label style={{ fontSize: 12, color: '#aaa', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoNews} onChange={toggleAutoNews} />
          Auto events
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button style={newsBtn('#16a34a')} onClick={() => triggerEvent(1)}>📈 Good news</button>
        <button style={newsBtn('#dc2626')} onClick={() => triggerEvent(-1)}>📉 Bad news</button>
      </div>

      <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>
        current sentiment <span style={{ color: sentColor, fontWeight: 600 }}>{sentiment.toFixed(2)}</span>
      </div>
      <SentimentChart series={sentimentSeries} />
    </div>
  );
}
