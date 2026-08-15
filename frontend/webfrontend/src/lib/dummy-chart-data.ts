export const TIMEFRAMES = ["1H", "1D", "1W", "1M", "ALL"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export type ChartPoint = {
  index: number;
  label: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma?: number;
};

const POINT_COUNTS: Record<Timeframe, number> = { "1H": 30, "1D": 24, "1W": 7, "1M": 30, ALL: 90 };

function seedFromString(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function labelFor(timeframe: Timeframe, i: number) {
  if (timeframe === "1H") return `${i * 2}m`;
  if (timeframe === "1D") return `${i}:00`;
  if (timeframe === "1W") return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i % 7]!;
  if (timeframe === "1M") return `D${i + 1}`;
  return `W${i + 1}`;
}

/**
 * Deterministic dummy OHLCV series — same seed + timeframe always produces the
 * same candles, so the chart doesn't reshuffle on every re-render. No live data
 * feed exists yet.
 */
export function generateSeries(seed: string, timeframe: Timeframe, basePrice: number): ChartPoint[] {
  const count = POINT_COUNTS[timeframe];
  const seedNum = seedFromString(`${seed}:${timeframe}`);
  const points: ChartPoint[] = [];
  let prevClose = basePrice * (1 + (Math.sin(seedNum % 5) * 0.004));

  for (let i = 0; i < count; i++) {
    const wave = Math.sin((i + (seedNum % 17)) * 0.55) * 0.02;
    const wave2 = Math.sin((i + (seedNum % 11)) * 0.21) * 0.012;
    const drift = (((seedNum % 13) - 6) / 6) * 0.0009 * i;
    const close = Math.max(basePrice * (1 + wave + wave2 + drift), 0.0001);
    const open = prevClose;

    const bodyHigh = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    const wickBias = Math.abs(Math.sin((i + (seedNum % 9)) * 0.9));
    const wickSize = close * 0.0045 * (0.5 + wickBias);
    const high = bodyHigh + wickSize * (0.4 + Math.abs(Math.sin((i + seedNum) * 0.3)));
    const low = Math.max(bodyLow - wickSize * (0.4 + Math.abs(Math.cos((i + seedNum) * 0.3))), 0.0001);

    const volume = Math.round(800 + Math.abs(wave * 6000) + Math.abs(wave2 * 4000) + ((seedNum + i * 37) % 900));

    points.push({ index: i, label: labelFor(timeframe, i), price: close, open, high, low, close, volume });
    prevClose = close;
  }
  return points;
}
