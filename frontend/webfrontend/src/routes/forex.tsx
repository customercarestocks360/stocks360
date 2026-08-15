import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MiniSparkline, IconTileRow, SearchInput } from "@/components/ui/marketing";
import { BuySellButtons, TradeModal } from "@/components/ui/trade-modal";
import { useFavorites } from "@/components/FavoritesProvider";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { AssetChart } from "@/components/ui/asset-chart";

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
];

function ForexPage() {
  const [query, setQuery] = useState("");
  const filteredPairs = forexPairs.filter(
    (a) => a.n.toLowerCase().includes(query.toLowerCase()) || a.t.toLowerCase().includes(query.toLowerCase()),
  );
  const [trade, setTrade] = useState<{ action: "buy" | "sell"; symbol: string; price: string } | null>(null);
  const { isFavorite } = useFavorites();
  const favoritePairs = useMemo(
    () => forexPairs.filter((a) => isFavorite(`forex:${a.n}`)),
    [isFavorite],
  );

  return (
    <AppLayout>
      <div>
        {/* ─── Chart + Trending pairs ─── */}
        <section className="relative overflow-hidden">
          <div className="relative mx-auto max-w-7xl px-6 py-16">
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Chart panel */}
              <div className="relative lg:col-span-2 overflow-hidden rounded-[2rem] border border-overlay-border bg-surface-elevated shadow-[var(--glow)] backdrop-blur-xl p-6 h-[640px] flex flex-col hover:border-primary/20">
                <div className="mb-2 flex shrink-0 items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live · EUR/USD
                </div>

                <div className="relative min-h-0 flex-1">
                  <AssetChart seed="EURUSD" color="#3b82f6" basePrice={1.0892} />
                </div>

                <div className="mt-6 grid shrink-0 grid-cols-2 gap-3 border-t border-border pt-6">
                  <button
                    onClick={() => setTrade({ action: "buy", symbol: "EUR/USD", price: "1.0892" })}
                    className="rounded-lg bg-up/10 py-2.5 text-sm font-bold uppercase tracking-wide text-up hover:bg-up/20 transition-colors"
                  >
                    Buy EUR/USD
                  </button>
                  <button
                    onClick={() => setTrade({ action: "sell", symbol: "EUR/USD", price: "1.0892" })}
                    className="rounded-lg bg-down/10 py-2.5 text-sm font-bold uppercase tracking-wide text-down hover:bg-down/20 transition-colors"
                  >
                    Sell EUR/USD
                  </button>
                </div>
              </div>

              {/* Trending pairs */}
              <div className="space-y-4">
                

                {/* Favorites — pairs starred on this page */}
                <div className="rounded-xl border border-overlay-border bg-surface p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <i className="fa-solid fa-star text-xs text-amber-400" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      My Favorites
                    </span>
                  </div>
                  {favoritePairs.length === 0 ? (
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      Star a pair below to add it here.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {favoritePairs.map((a) => (
                        <div key={a.n} className="flex items-center gap-2.5">
                          <FavoriteStar id={`forex:${a.n}`} />
                          <span className="text-sm font-semibold text-foreground">{a.n}</span>
                          <span className="ml-auto font-mono text-sm text-foreground">{a.p}</span>
                          <span className={`font-mono text-xs ${a.up ? "text-up" : "text-down"}`}>{a.c}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                </div>
                <h2 className="font-mono text-sm uppercase tracking-wider text-muted-foreground mb-4">
                  Currency Pairs
                </h2>


                <SearchInput value={query} onChange={setQuery} placeholder="Search a pair..." />
                {filteredPairs.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No pairs found.</p>
                )}
                {filteredPairs.map((a) => (
                  <div
                    key={a.n}
                    className="relative overflow-hidden rounded-xl border border-overlay-border bg-surface p-4 shadow-sm backdrop-blur-md hover:border-primary/20"
                  >
                    <div className="flex items-center gap-4">
                      <FavoriteStar id={`forex:${a.n}`} />
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold"
                        style={{ backgroundColor: `${a.color}18`, color: a.color }}
                      >
                        <i className={`fa-solid ${a.icon} text-sm`} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-foreground">{a.n}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">Vol {a.v}</div>
                      </div>
                      <div className="ml-auto hidden w-20 sm:block">
                        <MiniSparkline
                          color={a.up ? "var(--up)" : "var(--down)"}
                          points={a.points}
                          className="h-12 w-20"
                        />
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-bold text-foreground">{a.p}</div>
                        <div className={`font-mono text-xs ${a.up ? "text-up" : "text-down"}`}>{a.c}</div>
                      </div>
                    </div>
                    <BuySellButtons
                      onBuy={() => setTrade({ action: "buy", symbol: a.n, price: a.p })}
                      onSell={() => setTrade({ action: "sell", symbol: a.n, price: a.p })}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Why trade forex here ─── */}
        <section className="relative overflow-hidden border-t border-border">
          <div className="relative mx-auto max-w-7xl px-6 py-20 md:py-28">
            <div className="text-center mb-14">
              <div className="label-mono inline-block mb-3 text-[#3b82f6]">Why Stocks360 Forex</div>
              <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
                Built for serious currency traders
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  t: "Tight Interbank Spreads",
                  d: "Institutional liquidity on majors, minors and exotics — spreads from 0.1 pips on EUR/USD.",
                  icon: "fa-arrows-left-right",
                },
                {
                  t: "24/5 Market Access",
                  d: "Trade currency pairs from Sydney's open to New York's close, on the same unified balance.",
                  icon: "fa-clock",
                },
                {
                  t: "No Overnight Swap Fees",
                  d: "Hold positions across sessions without the usual rollover cost on major pairs.",
                  icon: "fa-hand-holding-dollar",
                },
              ].map((f) => (
                <div
                  key={f.t}
                  className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 shadow-sm hover:border-primary/20"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-primary mb-5">
                    <i className={`fa-solid ${f.icon} text-lg`} />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">{f.t}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.d}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 flex justify-center">
              <IconTileRow
                items={[
                  { icon: "fa-dollar-sign", color: "#10b981" },
                  { icon: "fa-euro-sign", color: "#3b82f6" },
                  { icon: "fa-sterling-sign", color: "#8b5cf6" },
                  { icon: "fa-yen-sign", color: "#ef4444" },
                  { icon: "fa-indian-rupee-sign", color: "#eab308" },
                ]}
              />
            </div>
          </div>
        </section>
      </div>
      {trade && (
        <TradeModal
          open
          onClose={() => setTrade(null)}
          action={trade.action}
          symbol={trade.symbol}
          price={trade.price}
        />
      )}
    </AppLayout>
  );
}
