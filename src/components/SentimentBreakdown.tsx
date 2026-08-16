interface Breakdown {
  tide: number; // slow regime baseline
  news: number; // medium-lived news shocks
  reflex: number; // fast price-action reflex
  total: number; // exposed, soft-clamped sentiment
}

const CAP = 3; // matches SENTIMENT_CAP in the engine

function moodLabel(s: number): { label: string; color: string } {
  if (s > 1.5) return { label: 'Extremely bullish', color: '#22c55e' };
  if (s > 0.4) return { label: 'Bullish', color: '#4ade80' };
  if (s < -1.5) return { label: 'Extremely bearish', color: '#dc2626' };
  if (s < -0.4) return { label: 'Bearish', color: '#f87171' };
  return { label: 'Neutral', color: '#9ca3af' };
}

// The sentiment × price-momentum regime (the 2×2): mood alone can mislead, so pair it
// with whether price is actually confirming. The off-diagonal quadrants are the tells.
function regime(sentiment: number, momentum: number): { label: string; color: string; note: string } {
  const bull = sentiment > 0.2;
  const bear = sentiment < -0.2;
  const up = momentum > 0.001;
  const down = momentum < -0.001;
  if (bull && up) return { label: 'Confirmed bull', color: '#22c55e', note: 'mood bullish and price rising' };
  if (bull && down) return { label: 'Distribution risk', color: '#f59e0b', note: 'bullish mood but price falling — crowded / not translating into buying' };
  if (bear && up) return { label: 'Absorbing / reversal', color: '#38bdf8', note: 'bearish mood but price rising — bad news getting absorbed' };
  if (bear && down) return { label: 'Confirmed bear', color: '#dc2626', note: 'mood bearish and price falling' };
  return { label: 'Neutral / chop', color: '#9ca3af', note: 'no strong mood or trend' };
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(1, Math.abs(value) / CAP) * 50; // half-width fraction
  const pos = value >= 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <span style={{ width: 78, color: '#999', textAlign: 'right' }}>{label}</span>
      <div style={{ position: 'relative', flex: 1, height: 12, background: '#0f0f1e', borderRadius: 3, border: '1px solid #2a2a3a' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#3a3a4a' }} />
        <div style={{ position: 'absolute', top: 1, bottom: 1, background: color, borderRadius: 2, left: pos ? '50%' : `${50 - pct}%`, width: `${pct}%` }} />
      </div>
      <span style={{ width: 40, textAlign: 'right', color: pos ? '#4ade80' : '#f87171', fontVariantNumeric: 'tabular-nums' }}>
        {pos ? '+' : ''}{value.toFixed(2)}
      </span>
    </div>
  );
}

/**
 * Explains the current mood: the three layers that sum into it (slow regime tide,
 * medium news, fast price-action) plus the sentiment×momentum regime and the
 * resulting valuation premium — so sentiment is legible, not a bare number.
 */
export function SentimentBreakdown({
  breakdown,
  recentPrices,
  currentPrice,
  fundamentalValue,
}: {
  breakdown: Breakdown;
  recentPrices: number[];
  currentPrice: number;
  fundamentalValue: number;
}) {
  const n = recentPrices.length;
  const lookback = Math.min(10, n - 1);
  const past = n > lookback ? recentPrices[n - 1 - lookback] : recentPrices[0] ?? currentPrice;
  const momentum = past > 0 ? (currentPrice - past) / past : 0;
  const premium = fundamentalValue > 0 ? ((currentPrice - fundamentalValue) / fundamentalValue) * 100 : 0;

  const mood = moodLabel(breakdown.total);
  const reg = regime(breakdown.total, momentum);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 13, color: '#ccc' }}>Market sentiment</h4>
        <span style={{ fontSize: 13, fontWeight: 700, color: mood.color }}>
          {mood.label} <span style={{ fontVariantNumeric: 'tabular-nums' }}>({breakdown.total >= 0 ? '+' : ''}{breakdown.total.toFixed(2)})</span>
        </span>
      </div>

      <div style={{ display: 'grid', gap: 4, marginBottom: 10 }}>
        <Bar label="Regime tide" value={breakdown.tide} color="#eab308" />
        <Bar label="News" value={breakdown.news} color="#34d399" />
        <Bar label="Price-action" value={breakdown.reflex} color="#60a5fa" />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
        <span style={{ padding: '3px 8px', borderRadius: 5, background: '#0f0f1e', border: `1px solid ${reg.color}55`, color: reg.color, fontWeight: 600 }}>
          {reg.label}
        </span>
        <span style={{ color: '#888', alignSelf: 'center' }}>{reg.note}</span>
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: '#888' }}>
        <span>10-tick momentum <span style={{ color: momentum >= 0 ? '#4ade80' : '#f87171' }}>{momentum >= 0 ? '+' : ''}{(momentum * 100).toFixed(2)}%</span></span>
        <span>valuation premium <span style={{ color: premium >= 0 ? '#4ade80' : '#f87171' }}>{premium >= 0 ? '+' : ''}{premium.toFixed(1)}%</span></span>
      </div>
    </div>
  );
}
