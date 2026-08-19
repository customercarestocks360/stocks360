/**
 * The trading desk shared by `/trade` and `/forex`.
 *
 * The two pages were ~90 % identical — same watchlist, chart, ticket, depth panel, table and
 * orders block, differing only in which asset class they point at. They are one component
 * now, parameterised by asset class, so a fix to the order flow lands on both.
 *
 * Live prices come from the public overview stream, so the watchlist and table tick for any
 * visitor. Everything that needs a token — quote detail, candles, depth, orders, balances —
 * degrades to a stated reason rather than a fabricated number.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { currentIdToken } from "@/lib/firebase";
import { SearchInput } from "@/components/ui/marketing";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { AssetChart, type WatchlistItem } from "@/components/ui/asset-chart";
import { DepthPanel, MyFills } from "@/components/ui/order-book";
import { OrderTicket } from "@/components/ui/order-ticket";
import { OrdersPanelView } from "@/components/ui/orders-panel";
import { decimalsFor, formatCompact, formatPrice, type TradeInstrument } from "@/lib/instrument";
import { searchUniverse, type SearchHit } from "@/lib/instrument-search";
import { amount, type AssetClass, type Portfolio, type PositionValuation } from "@/lib/trading-api";
import { fetchForexSession, type SessionInfo } from "@/lib/watchlists-api";
import type { Timeframe } from "@/lib/dummy-chart-data";
import { WatchlistPanel } from "@/components/ui/watchlist-panel";
import { useTrading } from "@/hooks/useTrading";
import { useTradingBoard } from "@/hooks/useTradingBoard";
import { useChartSeries } from "@/hooks/useChartSeries";

const CLASS_LABELS: Record<AssetClass, string> = {
  crypto: "Crypto",
  forex: "Forex",
  stocks: "Equities",
};

const CLASS_STYLES: Record<AssetClass, { icon: string; color: string }> = {
  crypto: { icon: "fa-coins", color: "#f59e0b" },
  forex: { icon: "fa-money-bill-transfer", color: "#3b82f6" },
  stocks: { icon: "fa-chart-line", color: "#10b981" },
};

/** Favourite ids stay namespaced per class so the same ticker on two feeds never collides. */
function favKey(instrument: { assetClass: AssetClass; symbol: string }) {
  return `${instrument.assetClass}:${instrument.symbol}`;
}

function ClassIcon({ assetClass, size = "h-8 w-8" }: { assetClass: AssetClass; size?: string }) {
  const { icon, color } = CLASS_STYLES[assetClass];
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full`}
      style={{ backgroundColor: `${color}20`, color }}
    >
      <i className={`fa-solid ${icon} text-xs`} />
    </span>
  );
}

function ChangeText({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="font-mono text-xs text-muted-foreground">—</span>;
  return (
    <span className={`font-mono text-xs font-semibold ${pct >= 0 ? "text-up" : "text-down"}`}>
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

/** Low/high track with the price marked. Renders a dash when the feed publishes no range. */
function RangeBar({
  low,
  high,
  price,
}: {
  low: number | null;
  high: number | null;
  price: number | null;
}) {
  if (low === null || high === null || price === null || high <= low)
    return <span className="font-mono text-xs text-muted-foreground">—</span>;
  const pct = Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
  return (
    <div className="flex w-24 items-center gap-1.5">
      <span className="shrink-0 text-[10px] text-muted-foreground">L</span>
      <div className="relative h-1 flex-1 rounded-full bg-muted">
        <span
          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-sm"
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground">H</span>
    </div>
  );
}

/**
 * Holdings, marked to market from `GET /trading/portfolio`.
 *
 * A `null` mark means the feed had no usable price for that symbol — rendered as a dash, since
 * showing 0 would claim the position is worthless rather than unpriced. The per-currency
 * footer is the only total offered: adding INR to USDT would need an FX rate this API has no
 * licensed source for, so the venue reports per currency and so does this.
 */
function PositionsPanel({
  positions,
  portfolio,
  assetClass,
  onSelect,
}: {
  positions: PositionValuation[];
  portfolio: Portfolio | null;
  assetClass: AssetClass;
  onSelect: (symbol: string) => void;
}) {
  const mine = positions.filter((p) => p.asset_class === assetClass);
  if (mine.length === 0) return null;

  const currencies = [...new Set(mine.map((p) => p.currency))];

  return (
    <div className="rounded-2xl border border-overlay-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
          Your positions
        </h3>
        {portfolio && portfolio.unpriced > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {portfolio.unpriced} of {portfolio.priced + portfolio.unpriced} could not be priced
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-2 pb-3 font-medium">Symbol</th>
              <th className="px-2 pb-3 text-right font-medium">Quantity</th>
              <th className="px-2 pb-3 text-right font-medium">Free</th>
              <th className="px-2 pb-3 text-right font-medium">Avg cost</th>
              <th className="px-2 pb-3 text-right font-medium">Last</th>
              <th className="px-2 pb-3 text-right font-medium">Market value</th>
              <th className="px-2 pb-3 text-right font-medium">Unrealised</th>
              <th className="px-2 pb-3 text-right font-medium">Realised</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((p) => {
              const unrealised = amount(p.unrealized_pnl);
              const unrealisedPct = amount(p.unrealized_pnl_percent);
              const realised = amount(p.realized_pnl);
              return (
                <tr
                  key={`${p.asset_class}:${p.symbol}`}
                  onClick={() => onSelect(p.symbol)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-secondary/30"
                >
                  <td className="px-2 py-3 font-medium text-foreground">
                    {p.symbol}
                    <span className="ml-1.5 text-xs text-muted-foreground">{p.currency}</span>
                    {p.stale && (
                      <i
                        className="fa-solid fa-clock ml-1.5 text-[10px] text-muted-foreground"
                        title="Mark is from a closed or stale market"
                      />
                    )}
                  </td>
                  <td className="px-2 py-3 text-right font-mono text-foreground">{p.quantity}</td>
                  <td className="px-2 py-3 text-right font-mono text-muted-foreground">
                    {p.available_quantity}
                  </td>
                  <td className="px-2 py-3 text-right font-mono text-muted-foreground">
                    {p.average_price ?? "—"}
                  </td>
                  <td className="px-2 py-3 text-right font-mono text-foreground">
                    {p.last_price ?? "—"}
                  </td>
                  <td className="px-2 py-3 text-right font-mono text-foreground">
                    {p.market_value ?? "—"}
                  </td>
                  <td className="px-2 py-3 text-right font-mono">
                    {unrealised === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={unrealised >= 0 ? "text-up" : "text-down"}>
                        {unrealised >= 0 ? "+" : ""}
                        {p.unrealized_pnl}
                        {unrealisedPct !== null && (
                          <span className="ml-1 text-[10px] opacity-80">
                            ({unrealisedPct >= 0 ? "+" : ""}
                            {unrealisedPct.toFixed(2)}%)
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right font-mono">
                    {realised === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={realised >= 0 ? "text-up" : "text-down"}>
                        {realised >= 0 ? "+" : ""}
                        {p.realized_pnl}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {portfolio && (
            <tfoot>
              {currencies.map((ccy) => (
                <tr key={ccy} className="border-t border-border">
                  <td colSpan={5} className="px-2 pt-3 text-xs text-muted-foreground">
                    Total in {ccy}
                  </td>
                  <td className="px-2 pt-3 text-right font-mono text-xs text-foreground">
                    {portfolio.market_value_by_currency[ccy] ?? "—"}
                  </td>
                  <td className="px-2 pt-3 text-right font-mono text-xs text-muted-foreground">
                    {portfolio.unrealized_pnl_by_currency[ccy] ?? "—"}
                  </td>
                  <td className="px-2 pt-3 text-right font-mono text-xs text-muted-foreground">
                    {portfolio.realized_pnl_by_currency[ccy] ?? "—"}
                  </td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export function TradingDesk({
  assetClasses,
  tableTitle,
}: {
  /** One or more classes this desk can trade. A picker appears when there is more than one. */
  assetClasses: readonly AssetClass[];
  tableTitle: string;
}) {
  const [assetClass, setAssetClass] = useState<AssetClass>(assetClasses[0]!);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [action, setAction] = useState<"buy" | "sell">("buy");
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState("");
  const [showResults, setShowResults] = useState(false);

  const searchBoxRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);

  // One poller for the whole desk: the ticket, the orders panel and the fills list all read
  // the same instance rather than each starting their own.
  const trading = useTrading();
  const board = useTradingBoard(assetClass);

  const instruments = board.instruments;

  // Default to the first streamed instrument, and re-anchor when the class changes.
  useEffect(() => {
    setSelectedSymbol(null);
  }, [assetClass]);

  const selected = useMemo(() => {
    if (selectedSymbol) {
      const found = instruments.find((i) => i.symbol === selectedSymbol);
      if (found) return found;
    }
    return instruments[0] ?? null;
  }, [instruments, selectedSymbol]);

  const chart = useChartSeries(assetClass, selected?.symbol ?? "", timeframe);

  /** Whichever socket is feeding this board is the one whose liveness matters. */
  const live = board.fromWatchlist ? board.streaming : board.connected;

  // ── FX session. One call for the whole feed, and only on the FX desk. ─────────────────
  const [session, setSession] = useState<SessionInfo | null>(null);
  useEffect(() => {
    if (assetClass !== "forex" || !trading.ready) {
      setSession(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const run = async () => {
      try {
        const info = await fetchForexSession(await currentIdToken(), controller.signal);
        if (!cancelled) setSession(info);
      } catch {
        // Cosmetic: every quote already carries its own `market_state`, so a failure here
        // costs a banner, not correctness.
      }
    };
    void run();
    // The interbank week turns over on a fixed schedule, so this needs re-reading rarely.
    const interval = setInterval(run, 300_000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [assetClass, trading.ready]);

  // ── Search: debounced, against the feed's own universe ────────────────────────────────
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setSearchNote("");
      return;
    }
    if (!trading.ready) {
      setHits([]);
      setSearchNote("Sign in to search the full instrument universe.");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        setSearching(true);
        setSearchNote("");
        try {
          const token = await currentIdToken();
          const found = await searchUniverse(assetClass, term, token, 12, controller.signal);
          if (controller.signal.aborted) return;
          setHits(found);
          if (found.length === 0) setSearchNote("No instruments matched.");
        } catch {
          if (!controller.signal.aborted) setSearchNote("Search is unavailable right now.");
        } finally {
          if (!controller.signal.aborted) setSearching(false);
        }
      })();
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, assetClass, trading.ready]);

  useEffect(() => {
    if (!showResults) return;
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node))
        setShowResults(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showResults]);

  const pick = async (symbol: string) => {
    setQuery("");
    setShowResults(false);
    // Pull a searched symbol into the board so it has a real quote before the ticket sizes it.
    const resolved = await board.resolve(symbol);
    setSelectedSymbol(resolved?.symbol ?? symbol);
    ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const watchlist: WatchlistItem[] = useMemo(
    () =>
      instruments.map((i) => ({
        sym: i.symbol,
        name: i.name,
        seed: i.symbol,
        basePrice: i.price ?? 0,
        color: CLASS_STYLES[i.assetClass].color,
        price: formatPrice(i.price),
        changePct: i.changePercent ?? 0,
        group: CLASS_LABELS[i.assetClass],
      })),
    [instruments],
  );

  const decimals = decimalsFor(selected?.price ?? null);

  return (
    <div className="relative mx-auto max-w-7xl px-1 py-4 sm:px-6 sm:py-10">
      {/* ── Feed + class header ── */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {assetClasses.length > 1 && (
          <div className="flex gap-1 rounded-lg bg-background/40 p-1">
            {assetClasses.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAssetClass(c)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                  assetClass === c
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {CLASS_LABELS[c]}
              </button>
            ))}
          </div>
        )}
        {/* Which socket is actually feeding this board — the user's own, or the public one. */}
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={`h-2 w-2 rounded-full ${
              live ? "animate-pulse bg-up" : "bg-muted-foreground/50"
            }`}
          />
          {board.fromWatchlist
            ? board.streaming
              ? `Streaming ${board.watchlists.selected?.name}`
              : "Reconnecting to your watchlist feed…"
            : board.connected
              ? "Live prices streaming"
              : "Connecting to live prices…"}
        </span>

        {/* FX has one interbank session for the whole feed, unlike equities' per-symbol calendar. */}
        {assetClass === "forex" && session && (
          <span
            title={session.detail}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <i
              className={`fa-solid ${
                session.market_state === "open" ? "fa-circle-check text-up" : "fa-moon"
              } text-[10px]`}
            />
            {session.market_state === "open" ? "Interbank market open" : "Interbank market closed"}
          </span>
        )}

        {!board.enriched && (
          <span className="text-xs text-muted-foreground">
            <Link to="/login" className="text-primary hover:underline">
              Sign in
            </Link>{" "}
            for real candles, depth, watchlists and trading.
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:gap-6 lg:grid-cols-5">
        {/* ── Left: watchlist + mobile ticket ── */}
        <div
          ref={ticketRef}
          className="order-2 flex min-w-0 flex-col space-y-4 lg:order-1 lg:col-span-1 lg:h-[720px]"
        >
          <WatchlistPanel
            assetClass={assetClass}
            watchlists={board.watchlists}
            instruments={instruments}
            selectedSymbol={selected?.symbol ?? null}
            onSelectSymbol={setSelectedSymbol}
            activeSymbol={selected?.symbol ?? null}
            streaming={board.streaming}
            connected={board.connected}
            className="min-h-0 flex-1"
          />

          {selected && (
            <div className="lg:hidden">
              <OrderTicket
                instrument={selected}
                action={action}
                onActionChange={setAction}
                trading={trading}
              />
            </div>
          )}
        </div>

        {/* ── Centre: search + chart ── */}
        <div className="order-1 min-w-0 space-y-4 lg:order-2 lg:col-span-3">
          <div ref={searchBoxRef} className="relative" onFocusCapture={() => setShowResults(true)}>
            <SearchInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                setShowResults(true);
              }}
              placeholder={
                assetClass === "stocks"
                  ? "Search any ticker or company…"
                  : assetClass === "forex"
                    ? "Search any currency pair…"
                    : "Search any spot pair…"
              }
            />
            {showResults && query.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-80 overflow-y-auto rounded border border-overlay-border bg-surface-elevated shadow-xl backdrop-blur-xl sm:rounded-xl">
                {searching ? (
                  <p className="px-3 py-3 text-center text-sm text-muted-foreground">
                    <i className="fa-solid fa-circle-notch fa-spin mr-2" />
                    Searching…
                  </p>
                ) : hits.length === 0 ? (
                  <p className="px-3 py-3 text-center text-sm text-muted-foreground">
                    {searchNote || "No results found."}
                  </p>
                ) : (
                  hits.map((h) => (
                    <button
                      type="button"
                      key={h.symbol}
                      onClick={() => void pick(h.symbol)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-primary/10"
                    >
                      <ClassIcon assetClass={assetClass} size="h-8 w-8" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {h.symbol}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{h.name}</div>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                        {h.detail}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="relative flex h-[460px] min-w-0 flex-col overflow-hidden rounded border border-overlay-border bg-surface-elevated p-1 shadow-sm backdrop-blur-xl sm:h-[600px] sm:rounded-[2rem] sm:p-6 lg:h-[720px]">
            {selected ? (
              <>
                <div className="mb-3 hidden shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-3 sm:flex">
                  <div>
                    <h2 className="flex items-center gap-3 text-xl font-bold">
                      {selected.label}
                      <span className="text-sm font-normal text-muted-foreground">
                        {selected.name !== selected.label ? selected.name : ""}
                      </span>
                    </h2>
                    <div className="mt-1 flex items-end gap-3">
                      <span className="font-mono text-2xl font-bold">
                        {formatPrice(selected.price, decimals)}
                      </span>
                      {selected.currency && (
                        <span className="pb-1 text-xs text-muted-foreground">
                          {selected.currency}
                        </span>
                      )}
                      <span className="pb-1">
                        <ChangeText pct={selected.changePercent} />
                      </span>
                      {selected.stale && (
                        <span className="pb-1 font-mono text-[10px] uppercase text-muted-foreground">
                          {selected.marketState === "closed" ? "market closed" : "stale"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAction("buy")}
                      className="rounded-md bg-up/10 px-4 py-2 text-sm font-bold text-up transition-colors hover:bg-up/20"
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => setAction("sell")}
                      className="rounded-md bg-down/10 px-4 py-2 text-sm font-bold text-down transition-colors hover:bg-down/20"
                    >
                      Sell
                    </button>
                  </div>
                </div>
                <div className="mb-2 flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-500 sm:hidden">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Live · {selected.label}
                </div>
                <div className="min-h-0 flex-1">
                  <AssetChart
                    seed={selected.symbol}
                    color={CLASS_STYLES[assetClass].color}
                    basePrice={selected.price ?? 0}
                    symbol={selected.label}
                    name={selected.name}
                    exchange={selected.currency ?? CLASS_LABELS[assetClass]}
                    marketStatusLabel={
                      selected.marketState === "closed" ? "Market closed" : "Market open"
                    }
                    watchlist={watchlist}
                    onSelectSymbol={(item) => setSelectedSymbol(item.sym)}
                    {...(chart.series ? { series: chart.series } : {})}
                    timeframe={timeframe}
                    onTimeframeChange={setTimeframe}
                    loadingSeries={chart.loading}
                    seriesError={chart.error}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {board.connected ? "Loading market…" : "Connecting to the market feed…"}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: real depth (crypto) or the real published quote, plus own fills ── */}
        <div className="order-3 flex min-w-0 flex-col space-y-4 lg:col-span-1 lg:h-[720px]">
          {selected && (
            <>
              <DepthPanel instrument={selected} className="min-h-0 flex-1" />
              <MyFills instrument={selected} trading={trading} className="min-h-0 flex-1" />
            </>
          )}
        </div>
      </div>

      {/* ── Desktop ticket ── */}
      {selected && (
        <div className="mt-6 hidden lg:block">
          <OrderTicket
            instrument={selected}
            action={action}
            onActionChange={setAction}
            trading={trading}
            layout="horizontal"
          />
        </div>
      )}

      {/* ── Instruments table ── */}
      <div className="mt-8">
        <h2 className="mb-4 font-mono text-sm uppercase tracking-wider text-muted-foreground">
          {tableTitle}
        </h2>
        {instruments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {board.connected ? "Loading instruments…" : "Connecting to the market feed…"}
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-overlay-border bg-surface sm:rounded-2xl">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">Instrument</th>
                  <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">Price</th>
                  <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">Change</th>
                  <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">
                    {assetClass === "forex" ? "Spread" : "Volume"}
                  </th>
                  <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">
                    {assetClass === "forex" ? "Session range" : "Day range"}
                  </th>
                  <th className="px-2 py-2 text-right font-medium sm:px-5 sm:py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {instruments.map((i) => (
                  <tr
                    key={i.symbol}
                    onClick={() => setSelectedSymbol(i.symbol)}
                    className={`cursor-pointer border-b border-border transition-colors last:border-b-0 ${
                      selected?.symbol === i.symbol ? "bg-primary/5" : "hover:bg-secondary/30"
                    }`}
                  >
                    <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                      <div className="flex items-center gap-3">
                        <ClassIcon assetClass={i.assetClass} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground">{i.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {i.label}
                            {i.currency && <span className="ml-1.5 opacity-70">{i.currency}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-foreground sm:px-5 sm:py-4">
                      {formatPrice(i.price)}
                    </td>
                    <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                      <ChangeText pct={i.changePercent} />
                    </td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground sm:px-5 sm:py-4">
                      {i.assetClass === "forex"
                        ? i.spreadPips === null
                          ? "—"
                          : `${i.spreadPips} pips`
                        : formatCompact(i.volume)}
                    </td>
                    <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                      <RangeBar low={i.dayLow} high={i.dayHigh} price={i.price} />
                    </td>
                    <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                      <div className="flex items-center justify-end gap-2">
                        <FavoriteStar
                          id={favKey(i)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSymbol(i.symbol);
                            ticketRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }}
                          className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          Trade
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {board.error && <p className="mt-3 text-xs text-muted-foreground">{board.error}</p>}
      </div>

      {/* ── Positions ── */}
      <div className="mt-8">
        <PositionsPanel
          positions={trading.positions}
          portfolio={trading.portfolio}
          assetClass={assetClass}
          onSelect={setSelectedSymbol}
        />
      </div>

      {/* ── Orders ── */}
      <div className="mt-8">
        <h2 className="mb-4 font-mono text-sm uppercase tracking-wider text-muted-foreground">
          Orders
        </h2>
        <OrdersPanelView trading={trading} />
      </div>
    </div>
  );
}
