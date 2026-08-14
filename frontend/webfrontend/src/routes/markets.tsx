import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MiniSparkline, SearchInput } from "@/components/ui/marketing";
import { BuySellButtons, TradeModal } from "@/components/ui/trade-modal";

export const Route = createFileRoute("/markets")({
  head: () => ({
    meta: [
      { title: "Markets Overview — Stocks360" },
      { name: "description", content: "Global markets overview, indices, and top movers." },
    ],
  }),
  component: MarketsPage,
});

const indices = [
  {
    n: "S&P 500",
    p: "5,631.20",
    c: "+0.33%",
    up: true,
    color: "#3b82f6",
    icon: "fa-chart-line",
    points: [20, 22, 21, 24, 23, 26, 25, 28, 27, 30, 29, 33],
  },
  {
    n: "NASDAQ",
    p: "18,211.50",
    c: "+0.54%",
    up: true,
    color: "#8b5cf6",
    icon: "fa-microchip",
    points: [18, 19, 22, 21, 25, 24, 27, 26, 30, 29, 32, 36],
  },
  {
    n: "DOW JONES",
    p: "39,812.10",
    c: "-0.12%",
    up: false,
    color: "#eab308",
    icon: "fa-industry",
    points: [30, 28, 29, 26, 27, 24, 25, 22, 23, 20, 21, 18],
  },
  {
    n: "NIFTY 50",
    p: "24,890.05",
    c: "+0.42%",
    up: true,
    color: "#10b981",
    icon: "fa-earth-asia",
    points: [16, 18, 17, 20, 19, 23, 21, 25, 24, 27, 26, 30],
  },
  {
    n: "FTSE 100",
    p: "8,214.30",
    c: "+0.21%",
    up: true,
    color: "#3b82f6",
    icon: "fa-earth-europe",
    points: [22, 23, 21, 24, 22, 25, 24, 26, 25, 28, 27, 29],
  },
  {
    n: "NIKKEI",
    p: "41,200.40",
    c: "-1.05%",
    up: false,
    color: "#ef4444",
    icon: "fa-earth-oceania",
    points: [32, 29, 30, 26, 27, 22, 24, 19, 21, 16, 18, 12],
  },
];

const stockMovers = [
  { sym: "NVDA", name: "NVIDIA Corp.", p: "$118.42", c: "+3.45%", up: true },
  { sym: "AAPL", name: "Apple Inc.", p: "$229.87", c: "+0.88%", up: true },
  { sym: "TSLA", name: "Tesla, Inc.", p: "$248.53", c: "-1.94%", up: false },
  { sym: "INTC", name: "Intel Corp.", p: "$30.12", c: "-4.21%", up: false },
  { sym: "MSTR", name: "MicroStrategy", p: "$1,452.10", c: "+4.12%", up: true },
];

const cryptoMovers = [
  { sym: "DOGE", name: "Dogecoin", p: "$0.1428", c: "+5.83%", up: true },
  { sym: "BTC", name: "Bitcoin", p: "$67,418.20", c: "+2.34%", up: true },
  { sym: "ETH", name: "Ethereum", p: "$3,548.90", c: "+1.12%", up: true },
  { sym: "XRP", name: "XRP", p: "$0.6231", c: "-2.41%", up: false },
  { sym: "CRV", name: "Curve DAO", p: "$0.28", c: "-3.84%", up: false },
];

const forexMovers = [
  { sym: "USD/JPY", name: "US Dollar / Yen", p: "157.42", c: "+0.41%", up: true },
  { sym: "GBP/USD", name: "Pound / US Dollar", p: "1.2731", c: "+0.24%", up: true },
  { sym: "AUD/USD", name: "Aussie / US Dollar", p: "0.6512", c: "+0.15%", up: true },
  { sym: "EUR/USD", name: "Euro / US Dollar", p: "1.0892", c: "-0.18%", up: false },
  { sym: "USD/INR", name: "US Dollar / Rupee", p: "83.41", c: "-0.09%", up: false },
];

const movementCategories = [
  { title: "Top Stocks Today", icon: "fa-chart-line", color: "#3b82f6", data: stockMovers },
  { title: "Top Crypto Today", icon: "fa-bitcoin-sign", color: "#f7931a", data: cryptoMovers },
  { title: "Top Forex Today", icon: "fa-money-bill-transfer", color: "#10b981", data: forexMovers },
];

function MarketsPage() {
  const [query, setQuery] = useState("");
  const filteredIndices = indices.filter((ind) => ind.n.toLowerCase().includes(query.toLowerCase()));
  const [trade, setTrade] = useState<{ action: "buy" | "sell"; symbol: string; price: string } | null>(null);

  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border">
        <div className="grid-bg absolute inset-0 opacity-40" />

        <div className="relative mx-auto max-w-7xl px-6 py-20 md:py-28">
          <div className="mb-16 text-center">
            <div className="label-mono inline-flex items-center gap-2 mb-4 text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--up)]" />
              Global Markets
            </div>
            <h1 className="text-4xl font-bold tracking-tight md:text-6xl leading-[1.05]">
              Markets Overview
            </h1>
            <p className="mt-5 text-muted-foreground max-w-2xl mx-auto text-base md:text-lg">
              Track global macro trends, top performing sectors, and the most volatile assets
              across all integrated exchanges.
            </p>
          </div>

          <div className="space-y-16">
            {/* ── Major Indices ── */}
            <div>
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                <i className="fa-solid fa-globe text-primary" /> Major Indices
              </h2>
              <div className="mb-5 max-w-sm">
                <SearchInput value={query} onChange={setQuery} placeholder="Search an index..." />
              </div>
              {filteredIndices.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No indices found.</p>
              )}
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {filteredIndices.map((ind) => (
                  <div
                    key={ind.n}
                    className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-sm hover:border-primary/20"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-xl"
                          style={{ backgroundColor: `${ind.color}15`, color: ind.color }}
                        >
                          <i className={`fa-solid ${ind.icon} text-sm`} />
                        </div>
                        <div className="font-medium">{ind.n}</div>
                      </div>
                      <div
                        className={`font-mono text-sm px-2 py-0.5 rounded-full ${ind.up ? "bg-up/10 text-up" : "bg-down/10 text-down"}`}
                      >
                        {ind.c}
                      </div>
                    </div>
                    <div className="font-mono text-2xl font-bold text-foreground">{ind.p}</div>
                    <div className="mt-5 pt-5 border-t border-border">
                      <MiniSparkline
                        color={ind.up ? "var(--up)" : "var(--down)"}
                        points={ind.points}
                        className="h-36 w-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Top Movers by Category — stocks, crypto and forex tracked separately ── */}
            <div className="grid gap-6 lg:grid-cols-3">
              {movementCategories.map((cat) => (
                <div
                  key={cat.title}
                  className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-sm hover:border-primary/20"
                >
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${cat.color}15`, color: cat.color }}
                    >
                      <i className={`fa-solid ${cat.icon} text-sm`} />
                    </span>
                    {cat.title}
                  </h3>
                  <div className="space-y-3">
                    {cat.data.map((g) => (
                      <div
                        key={g.sym}
                        className={`rounded-xl bg-background/40 border border-border p-3 ${
                          g.up ? "hover:border-up/30" : "hover:border-down/30"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="font-mono text-sm font-bold">{g.sym}</div>
                            <div className="truncate text-xs text-muted-foreground">{g.name}</div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="font-mono text-sm">{g.p}</div>
                            <div
                              className={`flex items-center gap-1 font-mono text-sm font-bold ${g.up ? "text-up" : "text-down"}`}
                            >
                              <i className={`fa-solid ${g.up ? "fa-caret-up" : "fa-caret-down"}`} />
                              {g.c}
                            </div>
                          </div>
                        </div>
                        <BuySellButtons
                          onBuy={() => setTrade({ action: "buy", symbol: g.sym, price: g.p })}
                          onSell={() => setTrade({ action: "sell", symbol: g.sym, price: g.p })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
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
