import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { OrdersPanel } from "@/components/ui/orders-panel";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { AssetChart, type WatchlistItem } from "@/components/ui/asset-chart";
import { MarketWatchlist, type MarketWatchlistItem } from "@/components/ui/market-watchlist";
import { OrderTicket } from "@/components/ui/order-ticket";
import { OrderBook, RecentTrades } from "@/components/ui/order-book";
import { Sparkline } from "@/components/ui/sparkline";
import { RangeBar52W, VolDiffBadge } from "@/components/ui/market-cells";
import { deriveMarketStats } from "@/lib/market-stats";

export const Route = createFileRoute("/forex")({
  head: () => ({
    meta: [
      { title: "Forex Trading — Stocks360" },
      { name: "description", content: "Trade major, minor and exotic currency pairs with tight spreads." },
    ],
  }),
  component: ForexPage,
});

const forexPairs = [
  {
    t: "EU",
    n: "EUR/USD",
    p: "1.0892",
    c: "-0.18%",
    up: false,
    v: "$128B",
    color: "#3b82f6",
    icon: "fa-euro-sign",
    points: [28, 26, 27, 24, 25, 22, 23, 20, 21, 18, 19, 16],
  },
  {
    t: "GB",
    n: "GBP/USD",
    p: "1.2731",
    c: "+0.24%",
    up: true,
    v: "$64B",
    color: "#8b5cf6",
    icon: "fa-sterling-sign",
    points: [18, 20, 19, 22, 21, 24, 23, 26, 25, 28, 27, 30],
  },
  {
    t: "JP",
    n: "USD/JPY",
    p: "157.42",
    c: "+0.41%",
    up: true,
    v: "$96B",
    color: "#ef4444",
    icon: "fa-yen-sign",
    points: [20, 21, 20, 23, 22, 25, 24, 27, 26, 29, 28, 32],
  },
  {
    t: "AU",
    n: "AUD/USD",
    p: "0.6512",
    c: "+0.15%",
    up: true,
    v: "$22B",
    color: "#10b981",
    icon: "fa-dollar-sign",
    points: [22, 23, 22, 24, 23, 25, 24, 26, 25, 27, 26, 28],
  },
  {
    t: "IN",
    n: "USD/INR",
    p: "83.41",
    c: "-0.09%",
    up: false,
    v: "$18B",
    color: "#eab308",
    icon: "fa-indian-rupee-sign",
    points: [24, 23, 24, 22, 23, 21, 22, 20, 21, 19, 20, 18],
  },
  {
    t: "CA",
    n: "USD/CAD",
    p: "1.3654",
    c: "+0.08%",
    up: true,
    v: "$14B",
    color: "#14f195",
    icon: "fa-dollar-sign",
    points: [21, 22, 21, 23, 22, 24, 23, 25, 24, 26, 25, 27],
  },
  {
    t: "CH",
    n: "USD/CHF",
    p: "0.8812",
    c: "-0.12%",
    up: false,
    v: "$32B",
    color: "#f43f5e",
    icon: "fa-dollar-sign",
    points: [26, 25, 26, 24, 25, 23, 24, 22, 23, 21, 22, 20],
  },
  {
    t: "NZ",
    n: "NZD/USD",
    p: "0.5891",
    c: "+0.21%",
    up: true,
    v: "$9B",
    color: "#22d3ee",
    icon: "fa-dollar-sign",
    points: [19, 20, 19, 21, 20, 22, 21, 23, 22, 24, 23, 25],
  },
  {
    t: "CN",
    n: "USD/CNH",
    p: "7.2418",
    c: "-0.05%",
    up: false,
    v: "$26B",
    color: "#fb923c",
    icon: "fa-yen-sign",
    points: [23, 22, 23, 21, 22, 20, 21, 19, 20, 18, 19, 17],
  },
  {
    t: "SG",
    n: "USD/SGD",
    p: "1.3402",
    c: "+0.06%",
    up: true,
    v: "$11B",
    color: "#a3e635",
    icon: "fa-dollar-sign",
    points: [20, 21, 20, 22, 21, 23, 22, 24, 23, 25, 24, 26],
  },
];

function toNumber(price: string) {
  return parseFloat(price.replace(/[^0-9.]/g, "")) || 0;
}

function ForexPage() {
  // Trending Currency Pairs is a fixed leaderboard — searching shouldn't reshuffle it.
  const [selected, setSelected] = useState(forexPairs[0]!);
  const [action, setAction] = useState<"buy" | "sell">("buy");
  const quoteCurrency = selected.n.split("/")[1] ?? "USD";

  const watchlist: WatchlistItem[] = useMemo(
    () =>
      forexPairs.map((a) => ({
        sym: a.n,
        name: a.n,
        seed: a.n.replace("/", ""),
        basePrice: toNumber(a.p),
        color: a.color,
        price: a.p,
        changePct: parseFloat(a.c) * (a.up ? 1 : -1),
        group: "Currency Pairs",
      })),
    [],
  );

  const handleSelectSymbol = (item: WatchlistItem) => {
    const pair = forexPairs.find((a) => a.n === item.sym);
    if (pair) setSelected(pair);
  };

  const marketWatchItems: MarketWatchlistItem[] = useMemo(
    () =>
      forexPairs.map((a) => ({
        symbol: a.n,
        quote: a.n.split("/")[1] ?? "USD",
        price: a.p,
        changePct: parseFloat(a.c) * (a.up ? 1 : -1),
      })),
    [],
  );

  const selectFromWatchlist = (item: MarketWatchlistItem) => {
    const pair = forexPairs.find((a) => a.n === item.symbol);
    if (pair) setSelected(pair);
  };

  return (
    <AppLayout>
      <div>
        {/* ─── Chart + Trending pairs ─── */}
        <section className="relative overflow-hidden">
          <div className="relative mx-auto max-w-7xl px-1 py-4 sm:px-6 sm:py-16">
            <div className="grid gap-3 sm:gap-6 lg:grid-cols-5">
              {/* Watchlist + order ticket */}
              <div className="order-2 space-y-4 lg:order-1 lg:col-span-1 min-w-0 lg:h-[720px] flex flex-col">
                {/* Market watchlist — quote-asset tabs, search, filters, Favorites/All/Recent, sortable list */}
                <MarketWatchlist items={marketWatchItems} favoriteScope="forex" onSelect={selectFromWatchlist} className="flex-1 min-h-0" />

                <div className="lg:hidden">
                  <OrderTicket
                    asset={selected}
                    action={action}
                    onActionChange={setAction}
                  />
                </div>
              </div>

              {/* Chart panel */}
              <div className="order-1 relative lg:order-2 lg:col-span-3 overflow-hidden rounded border border-overlay-border sm:rounded-[2rem] sm:border-overlay-border bg-surface-elevated shadow-[var(--glow)] backdrop-blur-xl p-1 h-[460px] flex flex-col hover:border-primary/20 sm:p-6 sm:h-[560px] md:h-[640px] lg:h-[720px] min-w-0">
                <div className="mb-2 flex shrink-0 items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live · {selected.n}
                </div>

                <div className="relative min-h-0 flex-1">
                  <AssetChart
                    seed={selected.n.replace("/", "")}
                    color={selected.color}
                    basePrice={toNumber(selected.p)}
                    symbol={selected.n}
                    exchange="FX"
                    marketStatusLabel="Forex Market Open"
                    watchlist={watchlist}
                    onSelectSymbol={handleSelectSymbol}
                  />
                </div>
              </div>

              {/* Order book + recent trades */}
              <div className="order-3 space-y-4 lg:col-span-1 min-w-0 lg:h-[720px] flex flex-col">
                <OrderBook price={toNumber(selected.p)} currency={quoteCurrency} className="flex-1 min-h-0" />
                <RecentTrades price={toNumber(selected.p)} currency={quoteCurrency} className="flex-1 min-h-0" />
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

            {/* ── Trending Currency Pairs ── */}
            <div className="mt-8">
              <h2 className="mb-4 font-mono text-sm uppercase tracking-wider text-muted-foreground">
                Trending Currency Pairs
              </h2>
              <div className="overflow-x-auto rounded sm:rounded-2xl border border-overlay-border bg-surface">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Pair</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Chart</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Market price</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">1D price change</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Volume</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">1W avg vol diff</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">52W</th>
                      <th className="px-2 py-2 sm:px-5 sm:py-3 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forexPairs.map((a) => {
                      const priceNum = toNumber(a.p);
                      const stats = deriveMarketStats(a.n, priceNum);
                      return (
                        <tr
                          key={a.n}
                          onClick={() => setSelected(a)}
                          className={`cursor-pointer border-b border-border last:border-b-0 transition-colors ${
                            selected.n === a.n ? "bg-primary/5" : "hover:bg-secondary/30"
                          }`}
                        >
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <div className="flex items-center gap-3">
                              <span
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
                                style={{ backgroundColor: `${a.color}18`, color: a.color }}
                              >
                                <i className={`fa-solid ${a.icon} text-xs`} />
                              </span>
                              <div className="font-semibold text-foreground">{a.n}</div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <Sparkline seed={a.n} up={a.up} />
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4 font-mono text-foreground">{a.p}</td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <span className={`font-mono text-sm font-semibold ${a.up ? "text-up" : "text-down"}`}>{a.c}</span>
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4 font-mono text-muted-foreground">{a.v}</td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <VolDiffBadge pct={stats.avgVolDiffPct} />
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <RangeBar52W low={stats.low52w} high={stats.high52w} price={priceNum} />
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4">
                            <div className="flex items-center justify-end gap-2">
                              <FavoriteStar
                                id={`forex:${a.n}`}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border"
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelected(a);
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
            </div>

            {/* ── Orders ── */}
            <div className="mt-8">
              <h2 className="mb-4 font-mono text-sm uppercase tracking-wider text-muted-foreground">Orders</h2>
              <OrdersPanel />
            </div>

          </div>
        </section>
      </div>
    </AppLayout>
  );
}
