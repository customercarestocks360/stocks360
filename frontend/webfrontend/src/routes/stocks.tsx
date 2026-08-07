import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";

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
  { t: "AAPL", n: "Apple Inc.", p: "$229.87", c: "+0.88%", up: true, mcap: "$3.5T" },
  { t: "TSLA", n: "Tesla, Inc.", p: "$248.53", c: "-1.94%", up: false, mcap: "$780B" },
  { t: "MSFT", n: "Microsoft Corp.", p: "$415.32", c: "+1.21%", up: true, mcap: "$3.1T" },
  { t: "NVDA", n: "NVIDIA Corp.", p: "$118.42", c: "+3.45%", up: true, mcap: "$2.9T" },
  { t: "RELI", n: "Reliance Ind.", p: "₹3,102.40", c: "+0.54%", up: true, mcap: "₹21T" },
  { t: "HDFC", n: "HDFC Bank", p: "₹1,642.10", c: "-0.22%", up: false, mcap: "₹12.5T" },
];

function StocksPage() {
  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border min-h-[calc(100vh-250px)]">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div className="halo absolute inset-0 opacity-60" />
        
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
              <h2 className="font-mono text-sm uppercase tracking-wider text-muted-foreground mb-4">Top Volume</h2>
              {stockAssets.map((a) => (
                <div key={a.n} className="flex items-center gap-4 rounded-xl border border-overlay-border bg-surface p-4 transition-all hover:bg-surface-hover cursor-pointer backdrop-blur-md">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary border border-border">
                    <span className="font-mono text-[10px] font-bold text-foreground truncate max-w-[32px]">{a.t}</span>
                  </div>
                  <div>
                    <div className="font-bold text-sm truncate max-w-[100px]">{a.n}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">MCap {a.mcap}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="font-mono text-sm font-bold">{a.p}</div>
                    <div className={`font-mono text-xs ${a.up ? "text-up" : "text-down"}`}>{a.c}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="lg:col-span-2 rounded-[2rem] border border-overlay-border bg-surface-elevated shadow-[var(--glow)] backdrop-blur-xl p-6 h-[500px] flex flex-col">
              <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
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
                  <button className="rounded-md bg-secondary px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">Trade</button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                {[
                  { label: "P/E Ratio", val: "34.12" },
                  { label: "Div Yield", val: "0.45%" },
                  { label: "52W High", val: "$237.23" },
                  { label: "52W Low", val: "$164.08" },
                ].map(stat => (
                  <div key={stat.label} className="border border-subtle-border rounded-lg p-3 bg-surface">
                    <div className="text-xs text-muted-foreground mb-1">{stat.label}</div>
                    <div className="font-mono text-sm">{stat.val}</div>
                  </div>
                ))}
              </div>
              <div className="flex-1 flex flex-col items-center justify-center border border-subtle-border rounded-xl bg-surface">
                <i className="fa-solid fa-chart-column text-5xl text-muted-foreground/20 mb-4" />
                <p className="font-mono text-sm text-muted-foreground/50">Detailed financials available in Pro view</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
