export const BULLISH_HEADLINES = [
  'Company beats earnings expectations',
  'Analyst upgrades stock to "Buy"',
  'New product launch exceeds forecasts',
  'Major partnership announced',
  'Regulators approve key acquisition',
  'Guidance raised for next quarter',
  'Insider buying reported',
  'Sector rallies on strong demand',
];

export const BEARISH_HEADLINES = [
  'Company misses earnings expectations',
  'Analyst downgrades stock to "Sell"',
  'Product recall announced',
  'Key partnership falls through',
  'Regulators open investigation',
  'Guidance cut for next quarter',
  'Insider selling reported',
  'Sector slumps on weak demand',
];

/** Pick a random headline whose tone matches the sign of `sentiment`. */
export function randomHeadline(sentiment: number): string {
  const pool = sentiment >= 0 ? BULLISH_HEADLINES : BEARISH_HEADLINES;
  return pool[Math.floor(Math.random() * pool.length)];
}
