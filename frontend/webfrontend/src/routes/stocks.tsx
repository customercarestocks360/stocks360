import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MiniSparkline, SearchInput } from "@/components/ui/marketing";
import { BuySellButtons, TradeModal } from "@/components/ui/trade-modal";

export const Route = createFileRoute("/stocks")({
  head: () => ({
    meta: [
      { title: "Stocks & Equities — Stocks360" },
      { name: "description", content: "Trade global equities from one unified ledger." },
    ],
  }),
  component: StocksPage,
});

const stockAssets = [
  { t: "AAPL", n: "Apple Inc.", p: "$229.87", c: "+0.88%", up: true, mcap: "$3.5T", color: "#3b82f6" },
  { t: "TSLA", n: "Tesla, Inc.", p: "$248.53", c: "-1.94%", up: false, mcap: "$780B", color: "#ef4444" },
  { t: "MSFT", n: "Microsoft Corp.", p: "$415.32", c: "+1.21%", up: true, mcap: "$3.1T", color: "#10b981" },
  { t: "NVDA", n: "NVIDIA Corp.", p: "$118.42", c: "+3.45%", up: true, mcap: "$2.9T", color: "#8b5cf6" },
  { t: "RELI", n: "Reliance Ind.", p: "₹3,102.40", c: "+0.54%", up: true, mcap: "₹21T", color: "#eab308" },
  { t: "HDFC", n: "HDFC Bank", p: "₹1,642.10", c: "-0.22%", up: false, mcap: "₹12.5T", color: "#f7931a" },
];

function StocksPage() {
  const [query, setQuery] = useState("");
  const filteredStocks = stockAssets.filter(
    (a) => a.n.toLowerCase().includes(query.toLowerCase()) || a.t.toLowerCase().includes(query.toLowerCase()),
  );
  const [trade, setTrade] = useState<{ action: "buy" | "sell"; symbol: string; price: string } | null>(null);

  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border min-h-[calc(100vh-250px)]">
        <div className="grid-bg absolute inset-0 opacity-40" />

        <div className="relative mx-auto max-w-7xl px-6 py-16">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="label-mono inline-flex items-center gap-2 mb-4">
                <span className="h-1.5 w-1.5 rounded-full bg-[#3b82f6] shadow-[0_0_8px_#3b82f6]" />
                Equities & ETFs
              </div>
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Global Stocks</h1>
              <p className="mt-4 max-w-xl text-muted-foreground">
                Trade US and Indian equities on a unified margin account. Extended hours and fractional shares available.
              </p>
            </div>

            <div className="rounded-xl border border-overlay-border bg-surface-elevated px-6 py-3 backdrop-blur-md">
              <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Market Status</div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="h-2 w-2 rounded-full bg-up shadow-[0_0_5px_var(--up)] animate-pulse" />
                US Markets Open
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-1">
              <h2 className="font-mono text-sm uppercase tracking-wider text-muted-foreground mb-4">
                Top Volume
              </h2>
              <SearchInput value={query} onChange={setQuery} placeholder="Search ticker or company..." />
              {filteredStocks.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No stocks found.</p>
              )}
              {filteredStocks.map((a) => (
                <div
                  key={a.n}
                  className="overflow-hidden rounded-xl border border-overlay-border bg-surface p-4 shadow-sm backdrop-blur-md hover:border-primary/20"
                >
                  <div className="flex items-center gap-4">
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary border border-border">
                      <span className="font-mono text-[10px] font-bold text-foreground truncate max-w-[32px]">{a.t}</span>
                    </div>
                    <div className="relative">
                      <div className="font-bold text-sm truncate max-w-[100px]">{a.n}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">MCap {a.mcap}</div>
                    </div>
                    <div className="relative ml-auto text-right">
                      <div className="font-mono text-sm font-bold">{a.p}</div>
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

            <div className="relative lg:col-span-2 overflow-hidden rounded-[2rem] border border-overlay-border bg-surface-elevated shadow-sm backdrop-blur-xl p-6 min-h-[560px] flex flex-col">
              <div className="relative flex items-center justify-between border-b border-border pb-4 mb-4">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-3">
                    AAPL <span className="text-sm text-muted-foreground font-normal">Apple Inc.</span>
                  </h2>
                  <div className="mt-1 flex items-end gap-3">
                    <span className="font-mono text-2xl font-bold">$229.87</span>
                    <span className="font-mono text-up text-sm pb-1">+0.88% Today</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTrade({ action: "buy", symbol: "AAPL", price: "$229.87" })}
                    className="rounded-md bg-up/10 px-4 py-2 text-sm font-bold text-up hover:bg-up/20 transition-colors"
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => setTrade({ action: "sell", symbol: "AAPL", price: "$229.87" })}
                    className="rounded-md bg-down/10 px-4 py-2 text-sm font-bold text-down hover:bg-down/20 transition-colors"
                  >
                    Sell
                  </button>
                </div>
              </div>
              <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
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
              <div className="relative flex-1 flex flex-col rounded-xl border border-subtle-border bg-surface p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      AAPL · 6 Month Trend
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-2xl font-bold font-mono text-foreground">$229.87</span>
                      <span className="text-xs font-mono font-bold text-up">+0.88% (+$2.01)</span>
                    </div>
                  </div>
                  <span className="mt-1 h-2 w-2 rounded-full bg-up animate-pulse" />
                </div>
                <div className="mt-6 flex-1 flex items-center min-h-[220px]">
                  <MiniSparkline
                    color="var(--up)"
                    points={[180, 188, 176, 195, 204, 198, 212, 206, 220, 214, 228, 221, 235, 226, 230]}
                    className="h-full w-full"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex gap-2 font-mono text-[10px] text-muted-foreground">
                    {["1D", "1W", "1M", "6M", "1Y", "All"].map((r, i) => (
                      <span key={r} className={`px-2 py-0.5 rounded-full ${i === 3 ? "bg-primary text-primary-foreground font-bold" : ""}`}>
                        {r}
                      </span>
                    ))}
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground/50">Detailed financials in Pro view</span>
                </div>
              </div>
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
