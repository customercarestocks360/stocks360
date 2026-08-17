export const TIMEFRAMES = ["1H", "1D", "1W", "1M", "ALL"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export type ChartPoint = {
  /** Unix timestamp in seconds — the time format lightweight-charts expects. */
  time: number;
  dateObj: Date;
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

type TfConfig = { count: number; stepMin: number; intraday: boolean; vol: number };

/**
 * Bar counts are deliberately generous so the chart shows realistic data
 * density (and so panning/zooming has somewhere to go) rather than the
 * handful of points a toy dataset would give.
 */
const TF_CONFIG: Record<Timeframe, TfConfig> = {
  "1H": { count: 60, stepMin: 1, intraday: true, vol: 0.0009 },
  "1D": { count: 78, stepMin: 5, intraday: true, vol: 0.0016 },
  "1W": { count: 130, stepMin: 15, intraday: true, vol: 0.0026 },
  "1M": { count: 176, stepMin: 60, intraday: true, vol: 0.0052 },
  ALL: { count: 520, stepMin: 60 * 24, intraday: false, vol: 0.0125 },
};

/** Fixed mock "now" so the generated series never drifts between renders. */
const ANCHOR_UTC = Date.UTC(2026, 7, 16, 20, 0, 0);
/** Regular US session in UTC: 13:30 → 20:00 (09:30 → 16:00 ET). */
const SESSION_OPEN_MIN = 13 * 60 + 30;
const SESSION_CLOSE_MIN = 20 * 60;

function seedFromString(s: string) {
  let h = 0;
  for (const ch of s) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return h >>> 0;
}

/** Deterministic Lehmer RNG — same seed always replays the same series. */
function makeRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Box-Muller normal draw, so returns cluster around the mean like real markets. */
function gauss(rng: () => number) {
  const u = Math.max(rng(), 1e-9);
  const v = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Intraday stamps walking back from the anchor, skipping weekends and closed hours. */
function sessionStamps(count: number, stepMin: number): Date[] {
  const out: Date[] = [];
  let t = ANCHOR_UTC;
  const stepMs = stepMin * 60_000;
  let guard = 0;
  while (out.length < count && guard++ < count * 400) {
    const d = new Date(t);
    const day = d.getUTCDay();
    const min = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (day >= 1 && day <= 5 && min >= SESSION_OPEN_MIN && min <= SESSION_CLOSE_MIN) out.push(d);
    t -= stepMs;
  }
  return out.reverse();
}

/** Daily stamps walking back from the anchor, weekdays only. */
function dailyStamps(count: number): Date[] {
  const out: Date[] = [];
  let t = Date.UTC(2026, 7, 16);
  let guard = 0;
  while (out.length < count && guard++ < count * 5) {
    const d = new Date(t);
    const day = d.getUTCDay();
    if (day >= 1 && day <= 5) out.push(d);
    t -= 86_400_000;
  }
  return out.reverse();
}

function labelFor(d: Date, intraday: boolean) {
  if (intraday) {
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

/**
 * Deterministic dummy OHLCV series — the same seed + timeframe always produces
 * the same candles, so the chart doesn't reshuffle on re-render. The walk is
 * rescaled at the end so the final close lands exactly on `basePrice`, keeping
 * the chart consistent with the quoted price shown elsewhere in the UI.
 */
export function generateSeries(seed: string, timeframe: Timeframe, basePrice: number): ChartPoint[] {
  const cfg = TF_CONFIG[timeframe];
  const rng = makeRng(seedFromString(`${seed}:${timeframe}`));
  const stamps = cfg.intraday ? sessionStamps(cfg.count, cfg.stepMin) : dailyStamps(cfg.count);
  const n = stamps.length;
  if (!n) return [];

  // Relative random walk with volatility clustering + mild mean reversion.
  const closes: number[] = [1];
  let vol = cfg.vol;
  let trend = gauss(rng) * cfg.vol * 0.35;
  for (let i = 1; i < n; i++) {
    if (i % Math.max(8, Math.floor(n / 12)) === 0) trend = gauss(rng) * cfg.vol * 0.35;
    vol = Math.max(cfg.vol * 0.45, Math.min(cfg.vol * 2.2, vol * (0.92 + rng() * 0.17)));
    const pull = (1 - closes[i - 1]!) * 0.012; // gentle pull back toward the origin
    closes.push(Math.max(closes[i - 1]! * (1 + trend + pull + gauss(rng) * vol), 0.02));
  }

  // Rescale so the last close is exactly basePrice.
  const k = basePrice / closes[n - 1]!;
  const scaled = closes.map((c) => c * k);

  const points: ChartPoint[] = [];
  for (let i = 0; i < n; i++) {
    const d = stamps[i]!;
    const close = scaled[i]!;
    const open = i === 0 ? close * (1 - gauss(rng) * vol * 0.3) : scaled[i - 1]!;
    const bodyHi = Math.max(open, close);
    const bodyLo = Math.min(open, close);
    const wick = close * vol * (0.4 + rng() * 1.1);
    const high = bodyHi + wick * rng();
    const low = Math.max(bodyLo - wick * rng(), 0.01);

    // Volume rises with the size of the move, plus a session-shape bias.
    const move = Math.abs(close - open) / (open || 1);
    const shape = cfg.intraday ? 1 + 0.6 * Math.abs(Math.cos((i / Math.max(n - 1, 1)) * Math.PI)) : 1;
    const volume = Math.round((450_000 + move * 90_000_000 + rng() * 900_000) * shape);

    points.push({
      time: Math.floor(d.getTime() / 1000),
      dateObj: d,
      index: i,
      label: labelFor(d, cfg.intraday),
      price: close,
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return points;
}

/** True when the timeframe renders intraday bars (drives time-axis formatting). */
export function isIntraday(timeframe: Timeframe) {
  return TF_CONFIG[timeframe].intraday;
}
