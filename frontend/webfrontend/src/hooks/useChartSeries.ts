/**
 * Real candles for the selected symbol and timeframe, kept live, for `AssetChart`.
 *
 * The candle endpoints are public — the same stance `/market/overview/stream` takes, since this
 * is exchange data from keyless upstreams, not anything about the user. So every visitor gets
 * real candles, signed in or not.
 *
 * That matters because of what the alternative was. These endpoints used to require a token, so
 * a signed-out visitor got `series: undefined`, which `AssetChart` read as "draw the seeded
 * random walk instead" — a synthetic chart, captioned as a sample but pixel-identical to a real
 * one, sitting under a UI that says "Live". A failed request did the same thing, so a signed-in
 * user whose candles errored also silently got invented prices. `series` is now always a real
 * array: empty when there is nothing to draw, never fabricated.
 *
 * **Real is not the same as live.** This used to fetch once per symbol/timeframe and stop, so a
 * `1H` chart of one-minute bars was a snapshot that aged all afternoon: the streamed price kept
 * moving the last bar via `mergeLiveTick`, but no new bar ever opened and no completed bar ever
 * corrected to the venue's final print. The series is repolled here on the bar's own cadence,
 * which is what makes the chart live rather than merely real.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { currentIdToken } from "@/lib/firebase";
import { fetchChartSeries } from "@/lib/candles";
import { barSeconds } from "@/lib/chart-window";
import type { ChartPoint, Timeframe } from "@/lib/chart-data";
import type { AssetClass } from "@/lib/trading-api";

export type ChartSeriesState = {
  /** `undefined` only before the first load resolves. Never a stand-in for missing data. */
  series: ChartPoint[] | undefined;
  loading: boolean;
  error: string;
};

/**
 * Half a bar, bounded. Half so a new bar shows up while it is still the current one rather than
 * after it has closed; the floor stops a one-minute chart from hammering three upstreams (an
 * equity candle request is one Yahoo call), and the ceiling keeps a daily chart from sitting
 * frozen for hours. The default covers the first poll, before there are bars to measure.
 */
const MIN_POLL_MS = 15_000;
const MAX_POLL_MS = 300_000;
const DEFAULT_POLL_MS = 30_000;

function pollDelayMs(points: ChartPoint[] | undefined): number {
  const bar = points ? barSeconds(points) : 0;
  if (bar <= 0) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, (bar / 2) * 1000));
}

/**
 * Whether a freshly fetched series is indistinguishable from the one already drawn.
 *
 * A poll that returns identical bars must not produce a new array, because every consumer of
 * `series` keys off its identity: `AssetChart` tears down and rebuilds its lightweight-charts
 * series on each change, so a naive repoll would flicker the chart and reset the crosshair
 * every fifteen seconds on a market that had not traded. Comparing the ends is enough —
 * candles are append-and-amend, so anything that moved moved the last bar or the length.
 */
function unchanged(prev: ChartPoint[] | undefined, next: ChartPoint[]): boolean {
  if (prev === undefined || prev.length !== next.length || next.length === 0) return false;
  const a = prev[prev.length - 1]!;
  const b = next[next.length - 1]!;
  return (
    prev[0]!.time === next[0]!.time &&
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}

export function useChartSeries(
  assetClass: AssetClass,
  symbol: string,
  timeframe: Timeframe,
): ChartSeriesState {
  const { isLoggedIn, authReady } = useAuth();
  const [series, setSeries] = useState<ChartPoint[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Bumped by the poll timer; the fetch effect depends on it. */
  const [nonce, setNonce] = useState(0);
  /**
   * Polling pauses while the tab is hidden — the same courtesy `useTradingBoard` shows the
   * upstreams, and an equity candle request is one Yahoo call per poll. Initialised from the
   * live value rather than assuming visible, since a chart can mount in a background tab.
   */
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );

  const requestKey = `${assetClass}|${symbol}|${timeframe}`;
  /**
   * Which request the bars currently on screen belong to — set once a load has actually landed,
   * not when one starts. Written on success on purpose: under StrictMode the first effect runs
   * twice, and a flag set on *entry* would make the second run look like a background poll and
   * suppress both the loading chip and the error for the very first load.
   */
  const drawnKey = useRef("");

  useEffect(() => {
    if (!symbol) return;

    /*
      A repoll of what is already on screen, rather than a switch to something new. The
      difference is only about presentation: a background poll must not raise the "Loading
      candles" chip over a chart that is already drawn and correct.
    */
    const isRepoll = drawnKey.current === requestKey;

    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      if (!isRepoll) {
        setLoading(true);
        setError("");
      }
      try {
        /*
          A token is sent when there is one and omitted when there is not. The route ignores it
          either way; passing it keeps signed-in traffic attributable in the access log, and
          `currentIdToken()` must not be called while signed out because it throws.
        */
        const token = authReady && isLoggedIn ? await currentIdToken() : "";
        const points = await fetchChartSeries(
          assetClass,
          symbol,
          timeframe,
          token,
          controller.signal,
        );
        if (cancelled) return;
        drawnKey.current = requestKey;
        // Only a repoll may reuse the old array: `prev` belongs to whatever was on screen
        // before, which after a symbol or timeframe switch is a different instrument.
        setSeries((prev) => (isRepoll && unchanged(prev, points) ? prev : points));
        setError("");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        /*
          A failed repoll is left silent: the bars on screen are still the venue's real bars,
          and flashing an error chip over them every fifteen seconds because one request lost
          its connection is worse than waiting for the next poll to succeed.
          ponytail: a series whose polls keep failing goes stale without saying so — give the
          header a "last updated" stamp if a quietly frozen chart turns out to matter.
        */
        if (isRepoll) return;
        setError(
          err instanceof ApiError
            ? err.status === 502 || err.status === 504
              ? "This interval is not available for this symbol."
              : err.message
            : "Could not load candles.",
        );
        // Leave whatever was last drawn on screen. A failed interval switch should neither
        // blank a chart that was showing something real, nor swap it for invented candles.
      } finally {
        if (!cancelled && !isRepoll) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authReady, isLoggedIn, assetClass, symbol, timeframe, requestKey, nonce]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => {
      const now = document.visibilityState === "visible";
      setVisible(now);
      // Returning to a tab means looking at bars that stopped updating when it went away, so
      // refresh at once instead of after another poll interval.
      if (now) setNonce((n) => n + 1);
    };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  /*
    One timer at a time, rescheduled off the series it just produced. `series` in the deps is
    what chains the polls: each load reschedules, and a load that changed nothing keeps its
    array identity, so `nonce` is in the deps too and is what re-arms the clock in that case.
  */
  useEffect(() => {
    if (!symbol || !visible) return;
    const timer = setTimeout(() => setNonce((n) => n + 1), pollDelayMs(series));
    return () => clearTimeout(timer);
  }, [symbol, series, nonce, visible]);

  return { series, loading, error };
}
