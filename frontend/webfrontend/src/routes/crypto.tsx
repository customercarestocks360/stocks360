import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AnimatedNumber, MiniSparkline, IconTileRow, SearchInput } from "@/components/ui/marketing";
import { BuySellButtons, TradeModal } from "@/components/ui/trade-modal";

export const Route = createFileRoute("/crypto")({
  head: () => ({
    meta: [
      { title: "Crypto Trading — Stocks360" },
      { name: "description", content: "Trade crypto with 8ms fills and zero noise." },
    ],
  }),
  component: CryptoPage,
});

const cryptoAssets = [
  {
    t: "BT",
    n: "Bitcoin",
    p: "$67,418.20",
    c: "+2.34%",
    up: true,
    v: "$1.2B",
    color: "#f7931a",
    icon: "fa-bitcoin-sign",
    points: [22, 26, 24, 30, 28, 34, 31, 38, 35, 42, 39, 46],
  },
  {
    t: "ET",
    n: "Ethereum",
    p: "$3,548.90",
    c: "+1.12%",
    up: true,
    v: "$840M",
    color: "#627eea",
    icon: "fa-ethereum",
    points: [30, 28, 32, 29, 33, 31, 35, 33, 37, 34, 38, 36],
  },
  {
    t: "SO",
    n: "Solana",
    p: "$168.42",
    c: "+4.51%",
    up: true,
    v: "$420M",
    color: "#14f195",
    icon: "fa-coins",
    points: [18, 20, 19, 24, 22, 28, 25, 32, 29, 36, 33, 40],
  },
  {
    t: "BN",
    n: "BNB",
    p: "$598.10",
    c: "+1.05%",
    up: true,
    v: "$210M",
    color: "#f0b90b",
    icon: "fa-coins",
    points: [26, 27, 25, 28, 27, 30, 28, 31, 29, 32, 30, 33],
  },
  {
    t: "XR",
    n: "XRP",
    p: "$0.6231",
    c: "-2.41%",
    up: false,
    v: "$150M",
    color: "#25a2df",
    icon: "fa-coins",
    points: [34, 32, 33, 29, 30, 26, 27, 23, 24, 20, 21, 17],
  },
  {
    t: "DO",
    n: "Dogecoin",
    p: "$0.1428",
    c: "+5.83%",
    up: true,
    v: "$80M",
    color: "#c2a633",
    icon: "fa-coins",
    points: [12, 14, 13, 18, 16, 22, 19, 26, 23, 30, 27, 34],
  },
];

function CryptoPage() {
  const [query, setQuery] = useState("");
  const filteredAssets = cryptoAssets.filter(
    (a) => a.n.toLowerCase().includes(query.toLowerCase()) || a.t.toLowerCase().includes(query.toLowerCase()),
  );
  const [trade, setTrade] = useState<{ action: "buy" | "sell"; symbol: string; price: string } | null>(null);

  return (
    <AppLayout>
      <div>
        {/* ─── Chart + Trending pairs ─── */}
        <section className="relative overflow-hidden">
          <div className="relative mx-auto max-w-7xl px-6 py-16">
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Chart panel */}
              <div className="relative lg:col-span-2 overflow-hidden rounded-[2rem] border border-overlay-border bg-surface-elevated shadow-[var(--glow)] backdrop-blur-xl p-6 min-h-[560px] flex flex-col hover:border-primary/20">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4 mb-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live · BTC/USD
                    </div>
                    <div className="mt-1 flex items-baseline gap-3">
                      <h2 className="font-mono text-3xl font-bold text-foreground">
                        $<AnimatedNumber value="67418" />
                      </h2>
                      <span className="font-mono text-sm font-bold text-up">+2.34%</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {["1H", "1D", "1W", "1M", "ALL"].map((t, i) => (
                      <span
                        key={t}
                        className={`cursor-pointer rounded border px-2 py-1 text-xs font-mono transition-colors ${
                          i === 1
                            ? "border-primary bg-primary text-primary-foreground font-bold"
                            : "border-border bg-secondary/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="relative flex-1 flex flex-col items-center justify-center">
                  <div className="w-full px-2">
                    <MiniSparkline
                      color="#f7931a"
                      points={[22, 30, 26, 34, 28, 38, 32, 42, 36, 48, 40, 55, 44, 60]}
                      className="h-56 w-full md:h-64"
                    />
                  </div>
                  <p className="mt-6 font-mono text-xs text-muted-foreground/50">
                    Pro charts with 100+ indicators available upon sign in
                  </p>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-6">
                  <button
                    onClick={() => setTrade({ action: "buy", symbol: "BTC", price: "$67,418.20" })}
                    className="rounded-lg bg-up/10 py-2.5 text-sm font-bold uppercase tracking-wide text-up hover:bg-up/20 transition-colors"
                  >
                    Buy BTC
                  </button>
                  <button
                    onClick={() => setTrade({ action: "sell", symbol: "BTC", price: "$67,418.20" })}
                    className="rounded-lg bg-down/10 py-2.5 text-sm font-bold uppercase tracking-wide text-down hover:bg-down/20 transition-colors"
                  >
                    Sell BTC
                  </button>
                </div>
              </div>

              {/* Trending pairs */}
              <div className="space-y-4">
                <h2 className="font-mono text-sm uppercase tracking-wider text-muted-foreground mb-4">
                  Trending Pairs
                </h2>
                <SearchInput value={query} onChange={setQuery} placeholder="Search token or symbol..." />
                {filteredAssets.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No tokens found.</p>
                )}
                {filteredAssets.map((a) => (
                  <div
                    key={a.n}
                    className="relative overflow-hidden rounded-xl border border-overlay-border bg-surface p-4 shadow-sm backdrop-blur-md hover:border-primary/20"
                  >
                    <div className="flex items-center gap-4">
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
                      onBuy={() => setTrade({ action: "buy", symbol: a.t, price: a.p })}
                      onSell={() => setTrade({ action: "sell", symbol: a.t, price: a.p })}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Why trade crypto here ─── */}
        <section className="relative overflow-hidden border-t border-border">
          <div className="relative mx-auto max-w-7xl px-6 py-20 md:py-28">
            <div className="text-center mb-14">
              <div className="label-mono inline-block mb-3 text-[#f7931a]">Why Stocks360 Crypto</div>
              <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
                Built for serious digital-asset traders
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  t: "Deep Liquidity",
                  d: "Institutional-grade order books across 200+ tokens with tight spreads, even in volatile conditions.",
                  icon: "fa-water",
                },
                {
                  t: "Cold Storage Custody",
                  d: "98% of digital assets held offline in air-gapped cold storage, backed by a $300M insurance fund.",
                  icon: "fa-shield-halved",
                },
                {
                  t: "Up to 100x Leverage",
                  d: "Cross-margined perpetuals and spot in one account. One balance, every crypto market.",
                  icon: "fa-gauge-high",
                },
              ].map((f) => (
                <div
                  key={f.t}
                  className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 shadow-sm hover:border-primary/20"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-primary mb-5">
                    <i className={`fa-solid ${f.icon} text-lg`} />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">
                    {f.t}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.d}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 flex justify-center">
              <IconTileRow
                items={[
                  { icon: "fa-bitcoin-sign", color: "#f7931a" },
                  { icon: "fa-ethereum", color: "#627eea" },
                  { icon: "fa-coins", color: "#14f195" },
                  { icon: "fa-coins", color: "#f0b90b" },
                  { icon: "fa-coins", color: "#25a2df" },
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
