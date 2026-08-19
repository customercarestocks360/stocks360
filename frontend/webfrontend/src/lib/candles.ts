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
 * translation, chosen per feed so a timeframe means roughly the same span on all three.
 */
import type { ChartPoint, Timeframe } from "@/lib/dummy-chart-data";
import {
  fetchCryptoKlines,
  fetchForexCandles,
  fetchStockCandles,
  type CryptoInterval,
  type ForexSeriesKind,
  type StockInterval,
  type StockRange,
} from "@/lib/markets-api";
import type { AssetClass } from "@/lib/trading-api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Intraday bars get a clock label, daily-and-longer bars get a date. */
function labelFor(d: Date, intraday: boolean): string {
  if (intraday) {
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

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
function toChartPoints(raw: RawCandle[], intraday: boolean): ChartPoint[] {
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
    const dateObj = new Date(ms);
    const volume = c.volume === null || c.volume === undefined ? 0 : Number(c.volume);
    out.push({
      // lightweight-charts wants seconds, not milliseconds.
      time: Math.floor(ms / 1000),
      dateObj,
      index: out.length,
      label: labelFor(dateObj, intraday),
      price: close,
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
 * than discovered at runtime. FX `intraday` is the provider's recent snapshots, which is the
 * closest thing it has to an intraday bar.
 */
const REQUEST_FOR: Record<
  Timeframe,
  {
    intraday: boolean;
    crypto: { interval: CryptoInterval; limit: number };
    stocks: { interval: StockInterval; range: StockRange };
    forex: { series: ForexSeriesKind; limit: number };
  }
> = {
  "1H": {
    intraday: true,
    crypto: { interval: "1m", limit: 60 },
    stocks: { interval: "1m", range: "1d" },
    forex: { series: "intraday", limit: 60 },
  },
  "1D": {
    intraday: true,
    crypto: { interval: "5m", limit: 288 },
    stocks: { interval: "5m", range: "1d" },
    forex: { series: "intraday", limit: 180 },
  },
  "1W": {
    intraday: true,
    crypto: { interval: "1h", limit: 168 },
    stocks: { interval: "30m", range: "5d" },
    forex: { series: "intraday", limit: 360 },
  },
  "1M": {
    intraday: false,
    crypto: { interval: "4h", limit: 180 },
    stocks: { interval: "1d", range: "1mo" },
    forex: { series: "daily", limit: 30 },
  },
  ALL: {
    intraday: false,
    crypto: { interval: "1d", limit: 500 },
    stocks: { interval: "1d", range: "2y" },
    forex: { series: "daily", limit: 360 },
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

  if (assetClass === "crypto") {
    const series = await fetchCryptoKlines(symbol, token, plan.crypto, signal);
    return toChartPoints(
      series.klines.map((k) => ({
        at: k.open_time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        // Base-asset volume is the one that matches an OHLC bar's units.
        volume: k.volume,
      })),
      plan.intraday,
    );
  }

  if (assetClass === "stocks") {
    const series = await fetchStockCandles(symbol, token, plan.stocks, signal);
    return toChartPoints(series.candles, plan.intraday);
  }

  const series = await fetchForexCandles(symbol, token, plan.forex, signal);
  // FX has no volume; `toChartPoints` maps the absent field to 0 and the chart's volume
  // histogram simply renders flat, which is the truth for this market.
  return toChartPoints(series.candles, plan.intraday);
}
