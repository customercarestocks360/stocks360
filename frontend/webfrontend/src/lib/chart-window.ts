/**
 * What a loaded series *actually* is — the period it covers and the size of one bar — read
 * off the bars themselves rather than off the button that requested them.
 *
 * Kept apart from `candles.ts` because that module pulls in the API clients, and this is pure
 * arithmetic over a series — the part worth testing on its own. `chart-window.check.ts` is
 * that test; run it with `node src/lib/chart-window.check.ts`.
 *
 * This used to also own the trim that enforced a timeframe button's promised calendar window
 * (`1H` meaning "the last hour," `1D` "the last day," …) — `WINDOW_HOURS` and `trimToWindow`,
 * since removed. Every feed's buttons are candle-size selectors now (`candles.ts`), each asking
 * for enough bars to clear ~1000 on its own, so there is no window left to trim to; a `1H` chart
 * that got a shorter or longer span than expected is not a bug to hide, it is what the venue had,
 * and `describeSeries` below is what makes that visible instead of silent.
 */
import type { ChartPoint } from "@/lib/chart-data";

const DAY = 86400;

/**
 * The bar size, as the median gap between consecutive bars.
 *
 * Median and not mean: an equity series is mostly 5-minute gaps punctuated by a 17-hour
 * overnight and a 65-hour weekend, and a mean over that reports a "20 minute" bar. The median
 * is the gap the series is actually made of.
 */
export function barSeconds(points: ChartPoint[]): number {
  if (points.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const gap = points[i]!.time - points[i - 1]!.time;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/**
 * The period the series covers, in seconds: first bar's open to last bar's *close*.
 *
 * The final bar's own duration is part of the coverage, and including it is what makes the
 * arithmetic land on the round numbers a reader expects — sixty one-minute bars span 59
 * minutes end-to-end but cover a full hour, and "59m" under a button marked `1H` reads as a
 * bug rather than as the truth it is.
 */
export function coveredSeconds(points: ChartPoint[]): number {
  if (points.length === 0) return 0;
  const span = points[points.length - 1]!.time - points[0]!.time;
  return span + barSeconds(points);
}

/** Largest first — the label uses the coarsest unit the duration fills. */
const UNITS: readonly (readonly [string, number])[] = [
  ["Y", 365 * DAY],
  ["M", 30 * DAY],
  ["W", 7 * DAY],
  ["D", DAY],
  ["H", 3600],
  ["m", 60],
  ["s", 1],
];

/**
 * `1H`, `4H 30m`, `4D 7H`, `2Y` — a duration in at most two units.
 *
 * Two units rather than one because one unit has to either round or truncate, and both lie by
 * up to half a unit: an NSE session is 6h20m, which rounds to "6H" and truncates to "6H" while
 * a Nasdaq session's 6h35m rounds to "7H". The second unit is dropped when it is zero, so the
 * common case is still the single token the timeframe buttons use.
 */
export function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return "—";
  for (let i = 0; i < UNITS.length; i++) {
    const [suffix, size] = UNITS[i]!;
    if (seconds < size) continue;
    const whole = Math.floor(seconds / size);
    const next = UNITS[i + 1];
    // Floor, not round: rounding the remainder up overstates the period — 500 daily bars is a
    // year and four and a half months, and "1Y 5M" claims fifteen days the series does not have.
    const rest = next ? Math.floor((seconds - whole * size) / next[1]) : 0;
    return rest > 0 ? `${whole}${suffix} ${rest}${next![0]}` : `${whole}${suffix}`;
  }
  return "—";
}

export type SeriesShape = {
  /** Median bar size in seconds; `0` for a series too short to have one. */
  bar: number;
  /** Period covered, in seconds. */
  covered: number;
  /** What the covered period is, e.g. `1H` or `4D 7H`. `—` when there is nothing to draw. */
  label: string;
  /** Bar size as a label, e.g. `5m` or `1D`. */
  barLabel: string;
  /**
   * Whether the bars are finer than a day, which is what decides if the time axis shows a
   * clock. Read off the bars instead of the timeframe button: crypto's `1M` is built from
   * 4-hour bars, and a per-timeframe table said "not intraday" for it, so six bars a day all
   * carried the same date and the axis dropped the time entirely.
   */
  intraday: boolean;
};

/**
 * What a series actually is, as opposed to what was asked for. The chart caption comes from
 * here, so a timeframe button that could not be honoured is visible rather than silent.
 */
export function describeSeries(points: ChartPoint[]): SeriesShape {
  const bar = barSeconds(points);
  const covered = coveredSeconds(points);
  return {
    bar,
    covered,
    label: durationLabel(covered),
    barLabel: durationLabel(bar),
    intraday: bar > 0 && bar < DAY,
  };
}
