/**
 * How much history each timeframe button promises, the trim that enforces it, and — because
 * the promise cannot always be kept — the description of what a series *actually* covers.
 *
 * Kept apart from `candles.ts` because that module pulls in the API clients, and this is pure
 * arithmetic over a series — the part worth testing on its own. `chart-window.check.ts` is
 * that test; run it with `node src/lib/chart-window.check.ts`.
 *
 * The upstreams cannot be asked for an arbitrary window. Yahoo's shortest `range` is `1d`, so a
 * `1H` request returns a whole session: `1H` and `1D` were rendering the *same* span for
 * equities and only the bar size differed, which makes the buttons look inert. FX, on the same
 * feed, was showing a month under `1W`. So the range is picked to *cover* the window and the
 * series is trimmed to it here.
 *
 * Trimming closes the gap but cannot close it completely, and this is where the chart used to
 * start lying. A venue only has the bars it has: `1W` on an equity is five sessions, which is
 * four calendar days of bars, not seven; a session that opened twenty minutes ago has twenty
 * minutes under `1H`; `ALL` was captioned "2Y" on a button while crypto asked for 500 daily
 * bars, which is sixteen months. The window is a *request*. `describeSeries` reads what came
 * back, and that is what the chart is captioned with.
 */
import type { ChartPoint, Timeframe } from "@/lib/chart-data";

export const WINDOW_HOURS: Record<Timeframe, number | null> = {
  "1H": 1,
  "1D": 24,
  "1W": 24 * 7,
  "1M": 24 * 30,
  /** No trim: the request range already *is* the window. */
  ALL: null,
};

/** Below this many bars a trimmed window reads as broken, so keep the tail instead. */
export const MIN_BARS = 8;

const DAY = 86400;

/**
 * Trims `points` to the last `hours` of the series.
 *
 * Anchored on the newest bar rather than `Date.now()`: over a weekend, or for an equity whose
 * session closed hours ago, "the last hour" has to mean the last hour that *traded*, otherwise
 * the cutoff lands past the final bar and the chart comes back empty.
 */
export function trimToWindow(points: ChartPoint[], hours: number | null): ChartPoint[] {
  if (hours === null || points.length === 0) return points;
  const newest = points[points.length - 1]!.time;
  const cutoff = newest - hours * 3600;
  // Strictly after the cutoff. `>=` also kept the bar sitting exactly on it, so a one-hour
  // window of one-minute bars was 61 bars and the chart reported covering "1H 1m".
  const windowed = points.filter((p) => p.time > cutoff);
  return windowed.length >= MIN_BARS ? windowed : points.slice(-MIN_BARS);
}

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
