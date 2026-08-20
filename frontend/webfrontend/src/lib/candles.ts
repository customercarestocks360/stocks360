/**
 * Real candles, normalised into the one shape `AssetChart` renders.
 *
 * Each feed publishes a different candle: Binance sends `open_time`/`close_time` with base
 * and quote volume, the equity provider sends `at` with a share count, and the FX provider
 * sends `at` with a per-candle change and **no volume at all** (there is no venue volume in
 * FX — it is an OTC market). Rather than leak that into the chart, all three are mapped to
 * `ChartPoint` here, with volume left at `0` where a feed genuinely has none.
 *
 * The chart's timeframe buttons are calendar-ish labels (`1H`/`1D`/`1W`/`1M`/`ALL`), while
 * the endpoints want an interval plus either a range or a limit. `REQUEST_FOR` is that
 * translation, chosen per feed so a timeframe means as nearly as possible the same span on
 * all three. As nearly as possible is not exactly: what a venue actually returns is measured
 * from the bars by `describeSeries`, and that — not the button — is what the chart is
 * captioned with.
 */
import type { ChartPoint, Timeframe } from "@/lib/chart-data";
import { WINDOW_HOURS, trimToWindow } from "@/lib/chart-window";
import {
  fetchCryptoKlines,
  fetchForexCandles,
  fetchStockCandles,
  type CryptoInterval,
  type StockInterval,
  type StockRange,
} from "@/lib/markets-api";
import type { AssetClass } from "@/lib/trading-api";

type RawCandle = {
  at: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string | number | null;
};

/**
 * Drops any candle the feed could not price rather than plotting a zero, which on a chart
 * reads as a crash to nothing. Oldest first — every endpoint already returns newest last.
 */
function toChartPoints(raw: RawCandle[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const c of raw) {
    const open = Number(c.open);
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);
    const ms = Date.parse(c.at);
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(ms) ||
      close <= 0
    ) {
      continue;
    }
    const volume = c.volume === null || c.volume === undefined ? 0 : Number(c.volume);
    out.push({
      // lightweight-charts wants seconds, not milliseconds.
      time: Math.floor(ms / 1000),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return out;
}

/**
 * Per-feed request parameters for each timeframe button.
 *
 * The equity provider refuses some interval/range pairs outright (a `502`), and only reaches
 * back about a week at `1m` — so the fine intervals are paired with short ranges here rather
 * than discovered at runtime.
 */
const REQUEST_FOR: Record<
  Timeframe,
  {
    crypto: { interval: CryptoInterval; limit: number };
    stocks: { interval: StockInterval; range: StockRange };
    forex: { interval: StockInterval; range: StockRange };
  }
> = {
  "1H": {
    crypto: { interval: "1m", limit: 60 },
    stocks: { interval: "1m", range: "1d" },
    forex: { interval: "2m", range: "1d" },
  },
  "1D": {
    crypto: { interval: "5m", limit: 288 },
    stocks: { interval: "5m", range: "1d" },
    forex: { interval: "15m", range: "5d" },
  },
  "1W": {
    crypto: { interval: "1h", limit: 168 },
    // `5d` is the longest range Yahoo serves at 30m, and it covers the 7-day window.
    stocks: { interval: "30m", range: "5d" },
    forex: { interval: "60m", range: "1mo" },
  },
  "1M": {
    crypto: { interval: "4h", limit: 180 },
    stocks: { interval: "1d", range: "3mo" },
    forex: { interval: "1d", range: "3mo" },
  },
  ALL: {
    // 730 daily bars, not the 500 this used to ask for: the other two feeds are asked for `2y`
    // and 500 bars is sixteen months, so `ALL` meant two different periods depending on which
    // desk you were on. Binance's own cap is 1000.
    crypto: { interval: "1d", limit: 730 },
    stocks: { interval: "1d", range: "2y" },
    forex: { interval: "1d", range: "2y" },
  },
};

/**
 * Fetches and normalises the candles for one symbol at one timeframe.
 *
 * `symbol` must already be in that feed's own convention — `BTCUSDT`, `EUR-USD`,
 * `RELIANCE.NS` — since that is what the endpoints validate against.
 */
export async function fetchChartSeries(
  assetClass: AssetClass,
  symbol: string,
  timeframe: Timeframe,
  token: string,
  signal?: AbortSignal,
): Promise<ChartPoint[]> {
  const plan = REQUEST_FOR[timeframe];
  const window = WINDOW_HOURS[timeframe];

  if (assetClass === "crypto") {
    const series = await fetchCryptoKlines(symbol, token, plan.crypto, signal);
    // Binance takes an exact bar count, so this window is already right; trimming is a no-op
    // that keeps every class going through one path.
    return trimToWindow(
      toChartPoints(
        series.klines.map((k) => ({
          at: k.open_time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          // Base-asset volume is the one that matches an OHLC bar's units.
          volume: k.volume,
        })),
      ),
      window,
    );
  }

  if (assetClass === "stocks") {
    const series = await fetchStockCandles(symbol, token, plan.stocks, signal);
    return trimToWindow(toChartPoints(series.candles), window);
  }

  const series = await fetchForexCandles(symbol, token, plan.forex, signal);
  // FX has no volume; `toChartPoints` maps the absent field to 0 and the chart's volume
  // histogram simply renders flat, which is the truth for this market.
  return trimToWindow(toChartPoints(series.candles), window);
}
