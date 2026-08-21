/**
 * Real candles, normalised into the one shape `AssetChart` renders.
 *
 * Each feed publishes a different candle: Binance sends `open_time`/`close_time` with base
 * and quote volume, the equity provider sends `at` with a share count, and the FX provider
 * sends `at` with a per-candle change and **no volume at all** (there is no venue volume in
 * FX — it is an OTC market). Rather than leak that into the chart, all three are mapped to
 * `ChartPoint` here, with volume left at `0` where a feed genuinely has none.
 *
 * The chart's timeframe buttons (`1H`/`1D`/`1W`/`1M`/`ALL`) are candle-size selectors, not
 * windows onto history: `1H` means "show 1-minute candles", not "show the last hour". Each
 * asks its feed for enough bars to draw at least 1000 candles at that size — a session or a
 * calendar window would run out of bars long before that — and `REQUEST_FOR` is what
 * translates a button into the interval/range or interval/limit pair each feed wants.
 *
 * Crypto and equities honour that request as given: for crypto `1H`→1m, `1D`→5m, `1W`→1h,
 * `1M`→4h, `ALL`→1d, each at Binance's own per-request cap of 1000 bars; equities are
 * 1m/5m/—/1d/1d, `1W` dropped from the button row entirely (`TIMEFRAMES_FOR.stocks` in
 * `chart-data.ts`) since NSE/BSE close weekends and a week of daily bars is really four or
 * five — but a mapping is kept here for it anyway so a stray `timeframe="1W"` (a race between
 * an asset-class switch and this feed's own poll) still requests something sane rather than
 * throwing.
 *
 * Forex candles come from Yahoo too (see `backend/app/forex/upstream.py`), quoted as
 * `EURUSD=X`, and that upstream measurably degrades at fine intervals: probed directly, its
 * 1-minute FX bars are **100% `open == high == low == close`** — every bar a flat dash — and
 * 5-minute is ~18% flat. 15-minute is the finest interval that comes back clean (~1% flat), so
 * that is `1H`'s floor here rather than 1m; there is no better free source for anything finer
 * (the backend's tick-built candles top out around 90 real bars — see `_tick_candles` there —
 * which is short enough to be the original complaint this mapping fixes). Yahoo also caps every
 * intraday FX interval at 60 days of history regardless of the range asked for (a 422 past
 * that), which is why `15m`/`30m` stop at `1mo` while `60m` can reach further. And `max` is
 * *not* forex's largest range — probed, it returns fewer daily bars than `5y` does for a
 * synthetic pair like `EURUSD=X` — so `5y` is used for both `1M` and `ALL`, which for this
 * feed are honestly the same span.
 */
import type { ChartPoint, Timeframe } from "@/lib/chart-data";
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

/** Binance's own per-request ceiling — the most any crypto button can load in one call. */
const CRYPTO_MAX_CANDLES = 1000;

/**
 * Per-feed request parameters for each timeframe button.
 *
 * Equity ranges are picked so the interval clears 1000 bars even on a short trading day:
 * `1m` over `5d` is ~1,900 bars on a 6.5h session and ~1,875 on NSE's 6h15m one; `5m` over
 * `1mo` is ~1,600-1,700; `1d` over `5y` is ~1,250. `1d`/`max` for `ALL` is simply every daily
 * bar Yahoo has. The equity provider also refuses some interval/range pairs outright (a
 * `502`) and only reaches back about a week at `1m`, which is why `5d` rather than something
 * longer.
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
    crypto: { interval: "1m", limit: CRYPTO_MAX_CANDLES },
    stocks: { interval: "1m", range: "5d" },
    // 2,210 bars, ~1% flat — 15m/1mo is the finest+longest combo Yahoo allows for FX.
    forex: { interval: "15m", range: "1mo" },
  },
  "1D": {
    crypto: { interval: "5m", limit: CRYPTO_MAX_CANDLES },
    stocks: { interval: "5m", range: "1mo" },
    // 1,106 bars. `1mo` is also 30m's ceiling here — anything longer is a 422.
    forex: { interval: "30m", range: "1mo" },
  },
  "1W": {
    crypto: { interval: "1h", limit: CRYPTO_MAX_CANDLES },
    // Not offered for equities (see `TIMEFRAMES_FOR.stocks`); kept as a safe fallback.
    stocks: { interval: "60m", range: "1y" },
    // 3,106 bars. 60m is the one intraday interval Yahoo will serve past 60 days for FX.
    forex: { interval: "60m", range: "6mo" },
  },
  "1M": {
    crypto: { interval: "4h", limit: CRYPTO_MAX_CANDLES },
    stocks: { interval: "1d", range: "5y" },
    // 1,306 bars — the deepest daily history this feed actually returns; see the note above.
    forex: { interval: "1d", range: "5y" },
  },
  ALL: {
    crypto: { interval: "1d", limit: CRYPTO_MAX_CANDLES },
    stocks: { interval: "1d", range: "max" },
    // Same span as `1M`: probed, `max` returns *fewer* daily FX bars than `5y` does.
    forex: { interval: "1d", range: "5y" },
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
    // The request already asks for the bar count the button means; no further trim.
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
    );
  }

  if (assetClass === "stocks") {
    const series = await fetchStockCandles(symbol, token, plan.stocks, signal);
    // Same: the range is chosen to already cover >=1000 bars at this interval.
    return toChartPoints(series.candles);
  }

  const series = await fetchForexCandles(symbol, token, plan.forex, signal);
  // Same as the other two: the range already covers >=1000 bars, so no further trim. FX has
  // no volume; `toChartPoints` maps the absent field to 0 and the chart's volume histogram
  // simply renders flat, which is the truth for this market.
  return toChartPoints(series.candles);
}
