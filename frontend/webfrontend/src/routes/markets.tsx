import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useFavorites } from "@/components/FavoritesProvider";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { SearchInput } from "@/components/ui/marketing";
import { useMarketTable, type MarketRow } from "@/hooks/useMarketTable";
import { currentIdToken } from "@/lib/firebase";
import { searchAllMarkets, type SearchHit } from "@/lib/instrument-search";
import { OVERVIEW_MARKETS, type OverviewMarket } from "@/lib/market-overview";

export const Route = createFileRoute("/markets")({
  head: () => ({
    meta: [
      { title: "Markets Overview — Stocks360" },
      {
        name: "description",
        content: "Live crypto, forex and equity prices streamed straight from the exchanges.",
      },
    ],
  }),
  component: MarketsPage,
});

/** Every market trades on the one desk now — the class rides along in the search params. */
const MARKET_ROUTES: Record<OverviewMarket, "/trade"> = {
  crypto: "/trade",
  forex: "/trade",
  stocks: "/trade",
};

const MARKET_LABELS: Record<OverviewMarket, string> = {
  crypto: "Crypto",
  forex: "Forex",
  stocks: "Equities",
};

const MARKET_STYLES: Record<OverviewMarket, { icon: string; color: string }> = {
  crypto: { icon: "fa-coins", color: "#f59e0b" },
  forex: { icon: "fa-money-bill-transfer", color: "#3b82f6" },
  stocks: { icon: "fa-chart-line", color: "#10b981" },
};

/**
 * Favorites are keyed "<namespace>:<id>". The backend's symbols (`RELIANCE.NS`, `EUR-USD`)
 * never collide with the other pages' demo tickers (`AAPL`, `EUR/USD`), so these rows get
 * their own namespace rather than trying to alias into one.
 */
function favKeyFor(row: MarketRow) {
  return `${row.market}:${row.symbol}`;
}

/** The row's instrument, pre-selected on whichever desk `MARKET_ROUTES` sends it to. */
function tradeSearchFor(row: MarketRow) {
  return { symbol: row.symbol, class: row.market };
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

function formatVolume(row: MarketRow): string | null {
  if (row.volume === null) return null;
  const compact = COMPACT.format(row.volume);
  return row.volumeKind === "value" && row.volumeUnit ? `${compact} ${row.volumeUnit}` : compact;
}

function formatLevel(value: number): string {
  const maximumFractionDigits = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", { maximumFractionDigits });
}

function MarketIcon({ market, size = "h-8 w-8" }: { market: OverviewMarket; size?: string }) {
  const { icon, color } = MARKET_STYLES[market];
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold`}
      style={{ backgroundColor: `${color}20`, color }}
    >
      <i className={`fa-solid ${icon} text-xs`} />
    </span>
  );
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-sm text-muted-foreground">—</span>;
  const up = value >= 0;
  return (
    <span className={`font-mono text-sm font-semibold ${up ? "text-up" : "text-down"}`}>
      {up ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

/** Absolute move and percentage together, when the feed reports both. */
function ChangeCell({ row }: { row: MarketRow }) {
  if (row.changePercent === null)
    return <span className="font-mono text-sm text-muted-foreground">—</span>;
  const up = row.changePercent >= 0;
  return (
    <span className={`font-mono text-sm font-semibold ${up ? "text-up" : "text-down"}`}>
      {row.change !== null && (
        <>
          {up ? "+" : "−"}
          {formatLevel(Math.abs(row.change))}{" "}
        </>
      )}
      ({up ? "+" : ""}
      {row.changePercent.toFixed(2)}%)
    </span>
  );
}

/**
 * Low/high track with a dot for where the price sits. Renders a dash rather than a bar when
 * the feed does not publish the range — an empty track reads as "at the low", which is a
 * claim about the price rather than an absence of data.
 */
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
    <div className="w-28">
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[10px] text-muted-foreground">L</span>
        <div className="relative h-1 flex-1 rounded-full bg-muted">
          <span
            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-sm"
            style={{ left: `calc(${pct}% - 4px)` }}
          />
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">H</span>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{formatLevel(low)}</span>
        <span>{formatLevel(high)}</span>
      </div>
    </div>
  );
}

function PriceCell({ row }: { row: MarketRow }) {
  if (row.price === null)
    return <span className="font-mono text-sm text-muted-foreground">Awaiting quote…</span>;
  return (
    <span className={`font-mono text-foreground ${row.stale ? "opacity-60" : ""}`}>
      {row.price}
      {row.stale && (
        <i
          className="fa-solid fa-clock ml-1.5 text-[10px] text-muted-foreground"
          title="Market closed or no recent trade — last known price"
        />
      )}
    </span>
  );
}

/** One compact row used by the category cards and the favourites grid. */
function MiniRow({ row }: { row: MarketRow }) {
  return (
    <div className="flex items-center gap-2.5">
      <FavoriteStar id={favKeyFor(row)} />
      <MarketIcon market={row.market} size="h-7 w-7" />
      <span className="truncate text-sm font-semibold text-foreground">{row.label}</span>
      <span className="ml-auto shrink-0 font-mono text-sm text-foreground">{row.price ?? "—"}</span>
      <span className="w-16 shrink-0 text-right">
        <ChangeBadge value={row.changePercent} />
      </span>
    </div>
  );
}

function MarketsPage() {
  const [query, setQuery] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const [marketFilter, setMarketFilter] = useState<OverviewMarket | "all">("all");
  const { isFavorite } = useFavorites();
  const { rows, connected, markets, fundamentalsStatus, fundamentalsError, addSymbol } =
    useMarketTable();

  // ── Universe search: reaches past the streamed headline set to any instrument the feeds
  // support, and pulls the chosen one into the table. Without this, typing a ticker the stream
  // does not carry silently found nothing even though the backend can resolve it. ────────────
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState("");
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const [showHits, setShowHits] = useState(false);

  const knownSymbols = useMemo(() => new Set(rows.map((r) => `${r.market}:${r.symbol}`)), [rows]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setSearchNote("");
      return;
    }
    if (fundamentalsStatus === "signed-out") {
      setHits([]);
      setSearchNote("Sign in to search every instrument the feeds carry.");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        setSearching(true);
        setSearchNote("");
        try {
          const found = await searchAllMarkets(term, await currentIdToken(), 5, controller.signal);
          if (controller.signal.aborted) return;
          // Drop anything already on screen — the local filter below covers those.
          setHits(found.filter((h) => !knownSymbols.has(`${h.assetClass}:${h.symbol}`)));
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
  }, [query, fundamentalsStatus, knownSymbols]);

  useEffect(() => {
    if (!showHits) return;
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node))
        setShowHits(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showHits]);

  const priced = useMemo(() => rows.filter((r) => r.changePercent !== null), [rows]);

  const topGainers = useMemo(
    () => [...priced].sort((a, b) => b.changePercent! - a.changePercent!).slice(0, 3),
    [priced],
  );
  const topLosers = useMemo(
    () => [...priced].sort((a, b) => a.changePercent! - b.changePercent!).slice(0, 3),
    [priced],
  );

  const cards = useMemo(
    () => [
      { title: "Top gainers", rows: topGainers },
      { title: "Top losers", rows: topLosers },
      { title: MARKET_LABELS.crypto, rows: rows.filter((r) => r.market === "crypto").slice(0, 3) },
      { title: MARKET_LABELS.forex, rows: rows.filter((r) => r.market === "forex").slice(0, 3) },
    ],
    [rows, topGainers, topLosers],
  );

  const favoriteRows = useMemo(
    () => rows.filter((r) => isFavorite(favKeyFor(r))),
    [rows, isFavorite],
  );

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (marketFilter === "all" || r.market === marketFilter) &&
        (needle === "" ||
          r.label.toLowerCase().includes(needle) ||
          r.symbol.toLowerCase().includes(needle) ||
          r.name.toLowerCase().includes(needle)),
    );
    if (!sortDir) return filtered;
    // Unpriced rows sink to the bottom either way — there is nothing to rank them by.
    return [...filtered].sort((a, b) => {
      if (a.changePercent === null) return 1;
      if (b.changePercent === null) return -1;
      const diff = a.changePercent - b.changePercent;
      return sortDir === "asc" ? diff : -diff;
    });
  }, [rows, query, marketFilter, sortDir]);

  const toggleSort = () => setSortDir((d) => (d === null ? "desc" : d === "desc" ? "asc" : null));

  const offlineMarkets = OVERVIEW_MARKETS.filter((m) => !markets[m]);

  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border">
        <div className="grid-bg absolute inset-0 opacity-40" />

        <div className="relative mx-auto max-w-7xl px-2 py-6 sm:px-6 md:py-16">
          {/* ── Feed status ── */}
          <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                className={`h-2 w-2 rounded-full ${
                  connected ? "animate-pulse bg-up" : "bg-muted-foreground/50"
                }`}
              />
              {connected ? "Live prices streaming" : "Connecting to live prices…"}
            </span>
            {connected && offlineMarkets.length > 0 && (
              <span className="text-muted-foreground">
                {offlineMarkets.map((m) => MARKET_LABELS[m]).join(" and ")} feed reconnecting —
                showing last known prices
              </span>
            )}
          </div>

          {/* ── Category strip, derived from the live feed ── */}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((card) => (
              <div
                key={card.title}
                className="rounded sm:rounded-2xl border border-border bg-card p-3 shadow-sm hover:border-primary/20 sm:p-5"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{card.title}</span>
                </div>
                <div className="space-y-3">
                  {card.rows.length === 0 ? (
                    <p className="py-2 text-xs text-muted-foreground">Waiting for prices…</p>
                  ) : (
                    card.rows.map((row) => <MiniRow key={favKeyFor(row)} row={row} />)
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── My Favorites ── */}
          <div className="mt-8 rounded sm:rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <i className="fa-solid fa-star text-sm text-amber-400" />
              <span className="text-sm font-semibold text-foreground">My Favorites</span>
            </div>
            {favoriteRows.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Click the star icon on any asset to add it here.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {favoriteRows.map((row) => (
                  <div
                    key={favKeyFor(row)}
                    className="flex items-center gap-2.5 rounded border border-border bg-background/40 px-3 py-2.5 sm:rounded-xl"
                  >
                    <MiniRow row={row} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Full market table ── */}
          <div className="mt-14">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-foreground">All markets</h2>
              <div
                ref={searchBoxRef}
                className="relative w-full max-w-xs"
                onFocusCapture={() => setShowHits(true)}
              >
                <SearchInput
                  value={query}
                  onChange={(v) => {
                    setQuery(v);
                    setShowHits(true);
                  }}
                  placeholder="Search any symbol or company..."
                />
                {showHits &&
                  query.trim().length >= 2 &&
                  (searching || hits.length > 0 || searchNote) && (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 max-h-80 overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
                      {searching ? (
                        <p className="px-3 py-3 text-center text-sm text-muted-foreground">
                          <i className="fa-solid fa-circle-notch fa-spin mr-2" />
                          Searching every feed…
                        </p>
                      ) : hits.length === 0 ? (
                        <p className="px-3 py-3 text-center text-sm text-muted-foreground">
                          {searchNote || "Nothing else matched."}
                        </p>
                      ) : (
                        hits.map((h) => (
                          <button
                            key={`${h.assetClass}:${h.symbol}`}
                            type="button"
                            onClick={() => {
                              addSymbol(h.assetClass as OverviewMarket, h.symbol);
                              setQuery("");
                              setShowHits(false);
                            }}
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-primary/10"
                          >
                            <MarketIcon market={h.assetClass as OverviewMarket} size="h-7 w-7" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold text-foreground">
                                {h.symbol}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">{h.name}</div>
                            </div>
                            <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                              {h.detail || MARKET_LABELS[h.assetClass as OverviewMarket]}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              {(["all", ...OVERVIEW_MARKETS] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMarketFilter(m)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    marketFilter === m
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "all" ? "All" : MARKET_LABELS[m]}
                </button>
              ))}
            </div>

            {/*
              Volume and the 52-week range come from the authenticated quote routes, so they
              are blank for a visitor who is not signed in. Saying so beats a column of
              dashes that looks like the data is missing upstream.
            */}
            {fundamentalsStatus === "signed-out" && (
              <p className="mb-4 text-xs text-muted-foreground">
                <Link to="/login" className="text-primary hover:underline">
                  Sign in
                </Link>{" "}
                to see volume, day range and 52-week range. Live prices are public.
              </p>
            )}
            {fundamentalsStatus === "partial" && (
              <p className="mb-4 text-xs text-muted-foreground">
                Some volume and range data could not be loaded. Live prices are unaffected.
              </p>
            )}
            {fundamentalsStatus === "error" && fundamentalsError && (
              <p className="mb-4 text-xs text-muted-foreground">{fundamentalsError}</p>
            )}

            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {connected ? "Loading markets…" : "Connecting to the market feed…"}
              </p>
            ) : visibleRows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No assets found.</p>
            ) : (
              <div className="overflow-x-auto rounded border border-border bg-card sm:rounded-2xl">
                <table className="w-full min-w-[1080px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">Instrument</th>
                      <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">Price</th>
                      <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">
                        <button
                          type="button"
                          onClick={toggleSort}
                          className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                        >
                          Change
                          <i
                            className={`fa-solid text-[10px] ${
                              sortDir === "asc"
                                ? "fa-arrow-up-short-wide text-primary"
                                : sortDir === "desc"
                                  ? "fa-arrow-down-wide-short text-primary"
                                  : "fa-sort"
                            }`}
                          />
                        </button>
                      </th>
                      <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">Day range</th>
                      <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">Volume</th>
                      <th className="px-2 py-2 font-medium sm:px-5 sm:py-3">52W range</th>
                      <th className="px-2 py-2 text-right font-medium sm:px-5 sm:py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const volume = formatVolume(row);
                      return (
                        <tr
                          key={favKeyFor(row)}
                          className="border-b border-border last:border-b-0 hover:bg-secondary/30"
                        >
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <div className="flex items-center gap-3">
                              <MarketIcon market={row.market} />
                              <div className="min-w-0">
                                {/* Carries the same search params as the row's Trade button —
                                    without them this landed on the desk's default instrument
                                    rather than the one whose name was clicked. */}
                                <Link
                                  to={MARKET_ROUTES[row.market]}
                                  search={tradeSearchFor(row)}
                                  className="font-semibold text-foreground hover:text-primary hover:underline"
                                >
                                  {row.name}
                                </Link>
                                <div className="text-xs text-muted-foreground">
                                  {row.label}
                                  {row.currency && row.market !== "crypto" && (
                                    <span className="ml-1.5 opacity-70">{row.currency}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <PriceCell row={row} />
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <ChangeCell row={row} />
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <RangeBar low={row.dayLow} high={row.dayHigh} price={row.priceValue} />
                          </td>
                          <td className="px-2 py-2.5 font-mono text-muted-foreground sm:px-5 sm:py-4">
                            {volume ?? "—"}
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <RangeBar low={row.low52w} high={row.high52w} price={row.priceValue} />
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <div className="flex items-center justify-end gap-2">
                              <FavoriteStar
                                id={favKeyFor(row)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border"
                              />
                              <Link
                                to={MARKET_ROUTES[row.market]}
                                search={tradeSearchFor(row)}
                                className="inline-block rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                              >
                                Trade
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
