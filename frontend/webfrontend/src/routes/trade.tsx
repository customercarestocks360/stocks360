import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { SearchInput } from "@/components/ui/marketing";
import { OrderTicket } from "@/components/ui/order-ticket";
import { OrderBook, RecentTrades } from "@/components/ui/order-book";
import { OrdersPanel } from "@/components/ui/orders-panel";
import { useFavorites } from "@/components/FavoritesProvider";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { AssetChart, type WatchlistItem } from "@/components/ui/asset-chart";
import { Sparkline } from "@/components/ui/sparkline";
import { RangeBar52W, VolDiffBadge } from "@/components/ui/market-cells";
import { deriveMarketStats } from "@/lib/market-stats";

const TOP_VOLUME_COUNT = 10;

export const Route = createFileRoute("/trade")({
  head: () => ({
    meta: [
      { title: "Trade — Stocks360" },
      { name: "description", content: "Trade global equities from one unified margin account." },
    ],
  }),
  component: TradePage,
});

const tradeAssets = [
  // ── US large caps ──
  { t: "AAPL", n: "Apple Inc.", p: "$229.87", c: "+0.88%", up: true, mcap: "$3.5T", color: "#3b82f6", exch: "NASDAQ", grp: "US Equities" },
  { t: "MSFT", n: "Microsoft Corp.", p: "$415.32", c: "+1.21%", up: true, mcap: "$3.1T", color: "#10b981", exch: "NASDAQ", grp: "US Equities" },
  { t: "NVDA", n: "NVIDIA Corp.", p: "$118.42", c: "+3.45%", up: true, mcap: "$2.9T", color: "#8b5cf6", exch: "NASDAQ", grp: "US Equities" },
  { t: "GOOGL", n: "Alphabet Inc.", p: "$175.64", c: "+0.62%", up: true, mcap: "$2.2T", color: "#eab308", exch: "NASDAQ", grp: "US Equities" },
  { t: "AMZN", n: "Amazon.com Inc.", p: "$186.31", c: "+1.07%", up: true, mcap: "$1.9T", color: "#f97316", exch: "NASDAQ", grp: "US Equities" },
  { t: "META", n: "Meta Platforms", p: "$512.08", c: "-0.44%", up: false, mcap: "$1.3T", color: "#2563eb", exch: "NASDAQ", grp: "US Equities" },
  { t: "TSLA", n: "Tesla, Inc.", p: "$248.53", c: "-1.94%", up: false, mcap: "$780B", color: "#ef4444", exch: "NASDAQ", grp: "US Equities" },
  { t: "AMD", n: "Advanced Micro Devices", p: "$164.75", c: "+2.18%", up: true, mcap: "$266B", color: "#22c55e", exch: "NASDAQ", grp: "US Equities" },
  { t: "JPM", n: "JPMorgan Chase", p: "$218.44", c: "+0.35%", up: true, mcap: "$627B", color: "#0891b2", exch: "NYSE", grp: "US Equities" },
  { t: "NFLX", n: "Netflix, Inc.", p: "$674.90", c: "-0.71%", up: false, mcap: "$290B", color: "#dc2626", exch: "NASDAQ", grp: "US Equities" },
  // ── India ──
  { t: "RELI", n: "Reliance Industries", p: "₹3,102.40", c: "+0.54%", up: true, mcap: "₹21T", color: "#f59e0b", exch: "NSE", grp: "India Equities" },
  { t: "HDFC", n: "HDFC Bank", p: "₹1,642.10", c: "-0.22%", up: false, mcap: "₹12.5T", color: "#f7931a", exch: "NSE", grp: "India Equities" },
  { t: "TCS", n: "Tata Consultancy Svcs", p: "₹4,218.75", c: "+1.12%", up: true, mcap: "₹15.3T", color: "#6366f1", exch: "NSE", grp: "India Equities" },
  { t: "INFY", n: "Infosys Ltd.", p: "₹1,876.30", c: "-0.38%", up: false, mcap: "₹7.8T", color: "#14b8a6", exch: "NSE", grp: "India Equities" },
  { t: "ITC", n: "ITC Ltd.", p: "₹482.55", c: "+0.29%", up: true, mcap: "₹6.0T", color: "#84cc16", exch: "NSE", grp: "India Equities" },
  // ── ETFs ──
  { t: "SPY", n: "SPDR S&P 500 ETF", p: "$558.21", c: "+0.31%", up: true, mcap: "$540B", color: "#0ea5e9", exch: "ARCA", grp: "ETFs" },
  { t: "QQQ", n: "Invesco QQQ Trust", p: "$478.66", c: "+0.58%", up: true, mcap: "$300B", color: "#a855f7", exch: "NASDAQ", grp: "ETFs" },
  { t: "GLD", n: "SPDR Gold Shares", p: "$232.14", c: "-0.17%", up: false, mcap: "$68B", color: "#facc15", exch: "ARCA", grp: "ETFs" },
];

function toNumber(price: string) {
  return parseFloat(price.replace(/[^0-9.]/g, "")) || 0;
}

function TradePage() {
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const searchResults = query.trim()
    ? tradeAssets.filter(
        (a) => a.n.toLowerCase().includes(query.toLowerCase()) || a.t.toLowerCase().includes(query.toLowerCase()),
      )
    : [];
  // Top Volume is a fixed leaderboard — searching for a ticker shouldn't reshuffle it.
  const topVolume = tradeAssets.slice(0, TOP_VOLUME_COUNT);
  const [selected, setSelected] = useState(tradeAssets[0]!);
  const [action, setAction] = useState<"buy" | "sell">("buy");
  const orderTicketRef = useRef<HTMLDivElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const { isFavorite } = useFavorites();
  const favoriteAssets = useMemo(
    () => tradeAssets.filter((a) => isFavorite(`stock:${a.t}`)),
    [isFavorite],
  );

  const watchlist: WatchlistItem[] = useMemo(
    () =>
      tradeAssets.map((a) => ({
        sym: a.t,
        name: a.n,
        seed: a.t,
        basePrice: toNumber(a.p),
        color: a.color,
        price: a.p,
        changePct: Math.abs(parseFloat(a.c)) * (a.up ? 1 : -1),
        group: a.grp,
      })),
    [],
  );

  const handleSelectSymbol = (item: WatchlistItem) => {
    const asset = tradeAssets.find((a) => a.t === item.sym);
    if (asset) setSelected(asset);
  };

  useEffect(() => {
    if (!showResults) return;
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setShowResults(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showResults]);

  const selectFromSearch = (a: (typeof tradeAssets)[number]) => {
    setSelected(a);
    setQuery("");
    setShowResults(false);
    orderTicketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border min-h-[calc(100vh-250px)]">
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div className="relative mx-auto max-w-7xl px-1 py-4 sm:px-6 sm:py-16">
          <div className="grid gap-3 sm:gap-6 lg:grid-cols-5">
            {/* ── Order ticket ── */}
            <div ref={orderTicketRef} className="order-2 space-y-4 lg:order-1 lg:col-span-1 min-w-0 lg:h-[720px] flex flex-col">
              {/* Favorites — tickers starred on this page */}
              <div className="rounded sm:rounded-xl border border-overlay-border bg-surface p-2 sm:p-4 flex-1 flex flex-col min-h-0">
                <div className="mb-3 flex items-center gap-2 shrink-0">
                  <i className="fa-solid fa-star text-xs text-amber-400" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                    My Favorites
                  </span>
                </div>
                {favoriteAssets.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    Star a ticker below to add it here.
                  </p>
                ) : (
                  <div className="space-y-2 flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {favoriteAssets.map((a) => (
                      <div
                        key={a.n}
                        onClick={() => setSelected(a)}
                        className="flex cursor-pointer items-center gap-2.5"
                      >
                        <FavoriteStar id={`stock:${a.t}`} />
                        <span className="font-mono text-sm font-semibold text-foreground">{a.t}</span>
                        <span className="ml-auto font-mono text-sm text-foreground">{a.p}</span>
                        <span className={`font-mono text-xs ${a.up ? "text-up" : "text-down"}`}>{a.c}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="lg:hidden">
                <OrderTicket
                  asset={selected}
                  action={action}
                  onActionChange={setAction}
                />
              </div>
            </div>

            {/* ── Chart — first on mobile, center column on desktop ── */}
            <div className="order-1 space-y-4 lg:order-2 lg:col-span-3 min-w-0">
              <div ref={searchBoxRef} className="relative" onFocusCapture={() => setShowResults(true)}>
                <SearchInput
                  value={query}
                  onChange={(v) => {
                    setQuery(v);
                    setShowResults(true);
                  }}
                  placeholder="Search ticker or company..."
                />
                {showResults && query.trim() && (
                  <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-80 overflow-y-auto rounded sm:rounded-xl border border-overlay-border bg-surface-elevated shadow-xl backdrop-blur-xl">
                    {searchResults.length === 0 ? (
                      <p className="px-3 py-3 text-center text-sm text-muted-foreground">No results found.</p>
                    ) : (
                      searchResults.map((a) => (
                        <button
                          type="button"
                          key={a.n}
                          onClick={() => selectFromSearch(a)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-primary/10"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary border border-border">
                            <span className="font-mono text-[9px] font-bold text-foreground truncate max-w-[26px]">{a.t}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-foreground">{a.t}</div>
                            <div className="truncate text-xs text-muted-foreground">{a.n}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-sm font-bold text-foreground">{a.p}</div>
                            <div className={`font-mono text-xs ${a.up ? "text-up" : "text-down"}`}>{a.c}</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="relative overflow-hidden rounded border border-overlay-border sm:rounded-[2rem] sm:border-overlay-border bg-surface-elevated shadow-sm backdrop-blur-xl p-1 h-[460px] flex flex-col sm:p-6 sm:h-[640px] md:h-[720px] lg:h-[720px] min-w-0">
                {/* Mobile: lean header matching the Forex chart card — full ticker/stats block returns at sm+ */}
                <div className="mb-2 flex shrink-0 items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-500 sm:hidden">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live · {selected.t}
                </div>
                <div className="relative hidden shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-4 mb-4 sm:flex">
                  <div>
                    <h2 className="text-xl font-bold flex items-center gap-3">
                      {selected.t} <span className="text-sm text-muted-foreground font-normal">{selected.n}</span>
                    </h2>
                    <div className="mt-1 flex items-end gap-3">
                      <span className="font-mono text-2xl font-bold">{selected.p}</span>
                      <span className={`font-mono text-sm pb-1 ${selected.up ? "text-up" : "text-down"}`}>
                        {selected.c} Today
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAction("buy")}
                      className="rounded-md bg-up/10 px-4 py-2 text-sm font-bold text-up hover:bg-up/20 transition-colors"
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => setAction("sell")}
                      className="rounded-md bg-down/10 px-4 py-2 text-sm font-bold text-down hover:bg-down/20 transition-colors"
                    >
                      Sell
                    </button>
                  </div>
                </div>
                <div className="relative hidden shrink-0 grid-cols-2 gap-4 mb-6 sm:grid sm:grid-cols-4">
                  {[
                    { label: "P/E Ratio", val: "34.12" },
                    { label: "Div Yield", val: "0.45%" },
                    { label: "52W High", val: "$237.23" },
                    { label: "52W Low", val: "$164.08" },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="border border-subtle-border rounded-lg p-3 bg-surface shadow-sm hover:border-primary/20"
                    >
                      <div className="text-xs text-muted-foreground mb-1">{stat.label}</div>
                      <div className="font-mono text-sm">{stat.val}</div>
                    </div>
                  ))}
                </div>
                <div className="relative min-h-0 flex-1 flex flex-col rounded sm:rounded-xl border-0 bg-transparent p-0 sm:border sm:border-subtle-border sm:bg-surface sm:p-6">
                  <div className="mb-2 hidden shrink-0 text-[10px] font-mono uppercase tracking-wider text-muted-foreground sm:block">
                    {selected.t} · Price Chart
                  </div>
                  <div className="min-h-0 flex-1">
                    <AssetChart
                      seed={selected.t}
                      color={selected.color}
                      basePrice={toNumber(selected.p)}
                      symbol={selected.t}
                      name={selected.n}
                      exchange={selected.exch}
                      marketStatusLabel="Markets Open"
                      watchlist={watchlist}
                      onSelectSymbol={handleSelectSymbol}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Order book ── */}
            <div className="order-3 space-y-4 lg:col-span-1 min-w-0 lg:h-[720px] flex flex-col">
              <OrderBook
                price={toNumber(selected.p)}
                currency={selected.p.trim().startsWith("₹") ? "INR" : "USDT"}
                className="flex-1 min-h-0"
              />
              <RecentTrades
                price={toNumber(selected.p)}
                currency={selected.p.trim().startsWith("₹") ? "INR" : "USDT"}
                className="flex-1 min-h-0"
              />
            </div>
          </div>

          {/* ── Desktop Stretched Buy / Sell Station ── */}
          <div className="mt-6 hidden lg:block">
            <OrderTicket
              asset={selected}
              action={action}
              onActionChange={setAction}
              layout="horizontal"
            />
          </div>

          {/* ── Top Volume ── */}
          <div className="mt-8">
            <h2 className="mb-4 font-mono text-sm uppercase tracking-wider text-muted-foreground">Top Volume</h2>
            {topVolume.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No results found.</p>
            ) : (
              <div className="overflow-x-auto rounded sm:rounded-2xl border border-overlay-border bg-surface">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Company</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Chart</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Market price</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">1D price change</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Market cap</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">1W avg vol diff</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">52W</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topVolume.map((a) => {
                      const priceNum = toNumber(a.p);
                      const stats = deriveMarketStats(a.t, priceNum);
                      return (
                        <tr
                          key={a.n}
                          onClick={() => {
                            setSelected(a);
                            orderTicketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          className={`cursor-pointer border-b border-border last:border-b-0 transition-colors ${
                            selected.t === a.t ? "bg-primary/5" : "hover:bg-secondary/30"
                          }`}
                        >
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <div className="flex items-center gap-3">
                              <span
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold"
                                style={{ backgroundColor: `${a.color}20`, color: a.color }}
                              >
                                {a.t.slice(0, 3)}
                              </span>
                              <div>
                                <div className="font-semibold text-foreground">{a.n}</div>
                                <div className="text-xs text-muted-foreground">{a.t} · {a.exch}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <Sparkline seed={a.t} up={a.up} />
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4 font-mono text-foreground">{a.p}</td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <span className={`font-mono text-sm font-semibold ${a.up ? "text-up" : "text-down"}`}>{a.c}</span>
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4 font-mono text-muted-foreground">{a.mcap}</td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <VolDiffBadge pct={stats.avgVolDiffPct} />
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <RangeBar52W low={stats.low52w} high={stats.high52w} price={priceNum} />
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <div className="flex items-center justify-end gap-2">
                              <FavoriteStar
                                id={`stock:${a.t}`}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border"
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelected(a);
                                  orderTicketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                                }}
                                className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                              >
                                Trade
                              </button>
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

          {/* ── Orders ── */}
          <div className="mt-8">
            <h2 className="mb-4 font-mono text-sm uppercase tracking-wider text-muted-foreground">Orders</h2>
            <OrdersPanel />
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
