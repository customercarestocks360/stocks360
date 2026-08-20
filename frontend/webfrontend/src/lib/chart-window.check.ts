/**
 * Self-check for the pure series arithmetic in `chart-window.ts`.
 *
 *     node src/lib/chart-window.check.ts
 *
 * Plain `node:assert` and Node's own type stripping — no test runner, because there isn't one
 * in this project and this file is not worth adding one for. It exists because the timeframe
 * caption is now *derived*, so a mistake here mislabels a real chart instead of failing loudly.
 */
import assert from "node:assert/strict";
import {
  barSeconds,
  coveredSeconds,
  describeSeries,
  durationLabel,
  trimToWindow,
  MIN_BARS,
} from "./chart-window.ts";
import type { ChartPoint } from "./chart-data.ts";

const bar = (time: number): ChartPoint => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 });
/** `count` bars of `step` seconds, ending at `end`. */
const series = (count: number, step: number, end = 1_700_000_000): ChartPoint[] =>
  Array.from({ length: count }, (_, i) => bar(end - (count - 1 - i) * step));

// ── bar size: the median gap, not the mean ────────────────────────────────────────────────
assert.equal(barSeconds([]), 0);
assert.equal(barSeconds([bar(0)]), 0, "one bar has no gap to measure");
assert.equal(barSeconds(series(60, 60)), 60);
// Two 5-minute sessions with a 17-hour overnight between them. The mean gap is over an hour;
// the median is the bar the series is actually made of.
const overnight = [...series(20, 300, 1_000_000), ...series(20, 300, 1_000_000 + 17 * 3600)];
assert.equal(barSeconds(overnight), 300, "overnight gap must not move the median");

// ── covered period: includes the last bar's own duration ──────────────────────────────────
assert.equal(coveredSeconds([]), 0);
assert.equal(coveredSeconds(series(60, 60)), 3600, "60 one-minute bars cover a full hour");
assert.equal(coveredSeconds(series(288, 300)), 86400);

// ── duration labels ───────────────────────────────────────────────────────────────────────
assert.equal(durationLabel(0), "—");
assert.equal(durationLabel(-5), "—");
assert.equal(durationLabel(480), "8m");
assert.equal(durationLabel(3600), "1H");
assert.equal(durationLabel(6 * 3600 + 25 * 60), "6H 25m", "an NSE session is not '6H'");
assert.equal(durationLabel(86400), "1D");
assert.equal(durationLabel(4 * 86400 + 7 * 3600), "4D 7H");
assert.equal(durationLabel(7 * 86400), "1W");
assert.equal(durationLabel(30 * 86400), "1M");
assert.equal(durationLabel(730 * 86400), "2Y", "crypto's ALL request is really two years");
assert.equal(durationLabel(500 * 86400), "1Y 4M", "…and 500 daily bars is really sixteen months");

// ── trimming ──────────────────────────────────────────────────────────────────────────────
assert.deepEqual(trimToWindow([], 1), []);
assert.equal(trimToWindow(series(375, 60), null).length, 375, "ALL is never trimmed");
assert.equal(trimToWindow(series(375, 60), 1).length, 60, "a 1h window of 1m bars is 60 of them");
assert.equal(coveredSeconds(trimToWindow(series(375, 60), 1)), 3600, "…covering exactly an hour");
// A session that opened twenty minutes ago cannot fill an hour, and the caption says so
// rather than the button's "1H".
assert.equal(trimToWindow(series(20, 60), 1).length, 20);
assert.equal(describeSeries(trimToWindow(series(20, 60), 1)).label, "20m");
// The `MIN_BARS` floor is the sharpest case: a window that would keep one bar keeps eight
// instead, so what is drawn can be days wider than what was asked for.
assert.equal(trimToWindow(series(20, 86400), 1).length, MIN_BARS);
assert.equal(describeSeries(trimToWindow(series(20, 86400), 1)).label, "1W 1D");

// ── the caption ───────────────────────────────────────────────────────────────────────────
assert.deepEqual(describeSeries([]), {
  bar: 0,
  covered: 0,
  label: "—",
  barLabel: "—",
  intraday: false,
});
assert.deepEqual(describeSeries(series(60, 60)), {
  bar: 60,
  covered: 3600,
  label: "1H",
  barLabel: "1m",
  intraday: true,
});
// Crypto's 1M: 4-hour bars. The old per-timeframe table called this "not intraday", so the
// axis showed six identically-dated bars a day with no clock.
assert.equal(describeSeries(series(180, 4 * 3600)).intraday, true);
assert.equal(describeSeries(series(180, 4 * 3600)).label, "1M");
assert.equal(describeSeries(series(500, 86400)).intraday, false);

console.log("chart-window: all checks passed");
