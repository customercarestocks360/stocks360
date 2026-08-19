/**
 * Real candles for the selected symbol and timeframe, for `AssetChart`.
 *
 * The candle endpoints are authenticated, so a signed-out visitor gets `series: undefined` —
 * which `AssetChart` reads as "fall back to the demo series" rather than an empty chart. That
 * keeps the page usable while never presenting generated candles as real ones: the caller
 * shows a sign-in hint whenever `series` is undefined for that reason.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import { fetchChartSeries } from "@/lib/candles";
import type { ChartPoint, Timeframe } from "@/lib/dummy-chart-data";
import type { AssetClass } from "@/lib/trading-api";

export type ChartSeriesState = {
  /** `undefined` until the first real load resolves, or while signed out. */
  series: ChartPoint[] | undefined;
  loading: boolean;
  error: string;
};

export function useChartSeries(
  assetClass: AssetClass,
  symbol: string,
  timeframe: Timeframe,
): ChartSeriesState {
  const { isLoggedIn, authReady } = useAuth();
  const [series, setSeries] = useState<ChartPoint[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authReady) return;
    if (!isLoggedIn) {
      // Hand the chart back to its demo series rather than showing an empty frame.
      setSeries(undefined);
      setLoading(false);
      setError("");
      return;
    }
    if (!symbol) return;

    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        const token = await currentIdToken();
        const points = await fetchChartSeries(
          assetClass,
          symbol,
          timeframe,
          token,
          controller.signal,
        );
        if (cancelled) return;
        setSeries(points);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // Leave the previous series on screen — a failed interval switch should not blank a
        // chart that was already showing something real.
        setError(
          err instanceof ApiError
            ? err.status === 502 || err.status === 504
              ? "This interval is not available for this symbol."
              : err.message
            : "Could not load candles.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authReady, isLoggedIn, assetClass, symbol, timeframe]);

  return { series, loading, error };
}
