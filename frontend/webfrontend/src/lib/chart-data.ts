/**
 * The chart's data shape and the small helpers that operate on it.
 *
 * This replaces `dummy-chart-data.ts`, which also held a seeded random-walk generator used to
 * fake a candle series whenever the real one was unavailable. The candle endpoints are public
 * now, so there is always a real series to draw and the generator is gone — along with the
 * risk it carried, since a synthetic candlestick chart is indistinguishable from a real one.
 *
 * A `ChartPoint` is only what the chart actually reads. It used to also carry `dateObj`, a
 * pre-formatted `label`, a positional `index` and `price` (a duplicate of `close`); none was
 * ever read — lightweight-charts formats its own axis from `time`, and the drawing layer
 * hit-tests through a time→position map — so they were four fields to keep in sync for
 * nothing, and the `label` in particular baked in a timeframe guess that this module is no
 * longer in a position to make. See `describeSeries` in `chart-window.ts`, which derives
 * everything of that kind from the bars themselves.
 */
import type { AssetClass } from "@/lib/trading-api";

export const TIMEFRAMES = ["1H", "1D", "1W", "1M", "ALL"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/**
 * Which timeframe buttons a class shows. Equities have no `1W`: NSE/BSE close for the
 * weekend, so a "week" of daily bars is really four or five, and the button's job here is
 * to pick a candle size — `1H` means 1-minute candles, not "the last hour" — so a size that
 * only ever half-applies is worse than one that isn't offered.
 */
export const TIMEFRAMES_FOR: Record<AssetClass, readonly Timeframe[]> = {
  crypto: TIMEFRAMES,
  forex: TIMEFRAMES,
  stocks: ["1H", "1D", "1M", "ALL"],
};

export type ChartPoint = {
  /** Unix timestamp in seconds — the time format lightweight-charts expects. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** `0` where the feed genuinely publishes none, as FX does. */
  volume: number;
  ma?: number;
};

/**
 * Folds a live price tick into the in-progress bar: extends the high/low and moves the close,
 * without touching `time` or `open`. Keeps updating the same bar until the next poll rolls the
 * series to a new one — which `useChartSeries` now does on the bar's own cadence, so a fresh
 * bar appears within half a bar of the venue opening it.
 */
export function mergeLiveTick(bar: ChartPoint, price: number): ChartPoint {
  return { ...bar, high: Math.max(bar.high, price), low: Math.min(bar.low, price), close: price };
}
