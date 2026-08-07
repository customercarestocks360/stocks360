import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";

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
  { t: "BT", n: "Bitcoin", p: "$67,418.20", c: "+2.34%", up: true, v: "$1.2B" },
  { t: "ET", n: "Ethereum", p: "$3,548.90", c: "+1.12%", up: true, v: "$840M" },
  { t: "SO", n: "Solana", p: "$168.42", c: "+4.51%", up: true, v: "$420M" },
  { t: "BN", n: "BNB", p: "$598.10", c: "+1.05%", up: true, v: "$210M" },
  { t: "XR", n: "XRP", p: "$0.6231", c: "-2.41%", up: false, v: "$150M" },
  { t: "DO", n: "Dogecoin", p: "$0.1428", c: "+5.83%", up: true, v: "$80M" },
];

function CryptoPage() {
  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border min-h-[calc(100vh-250px)]">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div className="halo absolute inset-0 opacity-60" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-16">
          <div className="mb-10">
            <div className="label-mono inline-flex items-center gap-2 mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-[#f7931a] shadow-[0_0_8px_#f7931a]" />
              Crypto Markets
            </div>
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Digital Assets</h1>
            <p className="mt-4 max-w-xl text-muted-foreground">
              Deep liquidity, zero spread markups, and instant settlements for the world's most traded cryptocurrencies.
            </p>
          </div>
          
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-[2rem] border border-overlay-border bg-surface-elevated shadow-[var(--glow)] backdrop-blur-xl p-6 h-[500px] flex flex-col">
              <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-xl font-bold">BTC/USD</h2>
                  <span className="font-mono text-up">+2.34%</span>
                </div>
                <div className="flex gap-2">
                  {["1H", "1D", "1W", "1M", "ALL"].map(t => (
                    <span key={t} className="cursor-pointer rounded border border-border bg-secondary px-2 py-1 text-xs font-mono text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center">
                <i className="fa-solid fa-chart-line text-5xl text-muted-foreground/20 mb-4" />
                <p className="font-mono text-sm text-muted-foreground/50">Pro charts available upon sign in</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <h2 className="font-mono text-sm uppercase tracking-wider text-muted-foreground mb-4">Trending Pairs</h2>
              {cryptoAssets.map((a) => (
                <div key={a.n} className="flex items-center gap-4 rounded-xl border border-overlay-border bg-surface p-4 transition-all hover:bg-surface-hover cursor-pointer backdrop-blur-md">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[11px] font-bold text-foreground">
                    {a.t}
                  </span>
                  <div>
                    <div className="font-bold text-sm">{a.n}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">Vol {a.v}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="font-mono text-sm font-bold">{a.p}</div>
                    <div className={`font-mono text-xs ${a.up ? "text-up" : "text-down"}`}>{a.c}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
