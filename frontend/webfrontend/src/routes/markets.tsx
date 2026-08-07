import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { Spark } from "@/components/ui/spark";

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
  { n: "S&P 500", p: "5,631.20", c: "+0.33%", up: true },
  { n: "NASDAQ", p: "18,211.50", c: "+0.54%", up: true },
  { n: "DOW JONES", p: "39,812.10", c: "-0.12%", up: false },
  { n: "NIFTY 50", p: "24,890.05", c: "+0.42%", up: true },
  { n: "FTSE 100", p: "8,214.30", c: "+0.21%", up: true },
  { n: "NIKKEI", p: "41,200.40", c: "-1.05%", up: false },
];

function MarketsPage() {
  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border min-h-[calc(100vh-250px)]">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div className="halo absolute inset-0 opacity-60" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-16">
          <div className="mb-12 text-center">
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Global Markets Overview</h1>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              Track global macro trends, top performing sectors, and the most volatile assets across all integrated exchanges.
            </p>
          </div>
          
          <div className="space-y-12">
            <div>
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                <i className="fa-solid fa-globe text-primary" /> Major Indices
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {indices.map((ind) => (
                  <div key={ind.n} className="rounded-xl border border-overlay-border bg-surface-elevated p-5 backdrop-blur-sm transition-colors hover:border-border">
                    <div className="flex justify-between items-center mb-4">
                      <div className="font-medium">{ind.n}</div>
                      <div className={`font-mono text-sm px-2 py-0.5 rounded ${ind.up ? "bg-up/10 text-up" : "bg-down/10 text-down"}`}>
                        {ind.c}
                      </div>
                    </div>
                    <div className="font-mono text-2xl font-bold">{ind.p}</div>
                    <div className="mt-4 pt-4 border-t border-subtle-border">
                      <Spark up={ind.up} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div className="rounded-[2rem] border border-overlay-border bg-surface-elevated shadow-[var(--glow)] p-6 backdrop-blur-xl">
                <h3 className="text-lg font-semibold mb-4 text-up flex items-center gap-2">
                  <i className="fa-solid fa-arrow-trend-up" /> Top Gainers
                </h3>
                <div className="space-y-3">
                  {[
                    { sym: "NVDL", name: "NVIDIA Bull 2X", p: "$64.20", c: "+6.90%" },
                    { sym: "WIF", name: "dogwifhat", p: "$2.14", c: "+5.42%" },
                    { sym: "MSTR", name: "MicroStrategy", p: "$1,452.10", c: "+4.12%" },
                  ].map(g => (
                    <div key={g.sym} className="flex items-center justify-between p-3 rounded-lg bg-surface border border-subtle-border">
                      <div className="flex items-center gap-3">
                        <div className="font-mono text-sm font-bold w-12">{g.sym}</div>
                        <div className="text-sm text-muted-foreground">{g.name}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="font-mono text-sm">{g.p}</div>
                        <div className="font-mono text-sm text-up">{g.c}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border border-overlay-border bg-surface-elevated shadow-[var(--glow)] p-6 backdrop-blur-xl">
                <h3 className="text-lg font-semibold mb-4 text-down flex items-center gap-2">
                  <i className="fa-solid fa-arrow-trend-down" /> Top Losers
                </h3>
                <div className="space-y-3">
                  {[
                    { sym: "INTC", name: "Intel Corp.", p: "$30.12", c: "-4.21%" },
                    { sym: "CRV", name: "Curve DAO", p: "$0.28", c: "-3.84%" },
                    { sym: "PYPL", name: "PayPal Holdings", p: "$58.90", c: "-2.15%" },
                  ].map(g => (
                    <div key={g.sym} className="flex items-center justify-between p-3 rounded-lg bg-surface border border-subtle-border">
                      <div className="flex items-center gap-3">
                        <div className="font-mono text-sm font-bold w-12">{g.sym}</div>
                        <div className="text-sm text-muted-foreground">{g.name}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="font-mono text-sm">{g.p}</div>
                        <div className="font-mono text-sm text-down">{g.c}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
