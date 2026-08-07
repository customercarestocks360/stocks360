import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Market Insights & Research — Stocks360" },
      { name: "description", content: "Expert analysis, market updates, and macro trends." },
    ],
  }),
  component: InsightsPage,
});

const newsItems = [
  {
    category: "Macro",
    title: "Federal Reserve signals potential rate cut as inflation cools",
    date: "2 hours ago",
    readTime: "4 min read",
  },
  {
    category: "Crypto",
    title: "Institutional inflows to Bitcoin ETFs hit record high this week",
    date: "5 hours ago",
    readTime: "3 min read",
  },
  {
    category: "Equities",
    title: "Tech sector rallies after strong Q3 earnings from mega-caps",
    date: "1 day ago",
    readTime: "6 min read",
  },
  {
    category: "Commodities",
    title: "Gold reaches new all-time high amidst geopolitical tensions",
    date: "1 day ago",
    readTime: "5 min read",
  },
];

const analystPicks = [
  { ticker: "NVDA", rating: "Strong Buy", target: "$140.00", current: "$118.42" },
  { ticker: "ETH", rating: "Buy", target: "$4,200", current: "$3,548.90" },
  { ticker: "TSLA", rating: "Hold", target: "$220.00", current: "$248.53" },
];

function InsightsPage() {
  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border min-h-[calc(100vh-250px)]">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div className="halo absolute inset-0 opacity-60" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-16">
          <div className="mb-12">
            <div className="label-mono inline-flex items-center gap-2 mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground shadow-[0_0_8px_var(--foreground)]" />
              Research Desk
            </div>
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Market Insights</h1>
            <p className="mt-4 max-w-2xl text-muted-foreground">
              Institution-grade research, real-time macro analysis, and expert technical breakdowns.
            </p>
          </div>
          
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Main News Feed */}
            <div className="lg:col-span-2 space-y-6">
              <h2 className="text-xl font-semibold border-b border-border pb-4">Latest Briefings</h2>
              <div className="grid gap-4">
                {newsItems.map((news, i) => (
                  <div key={i} className="group rounded-xl border border-overlay-border bg-surface-elevated p-6 backdrop-blur-md transition-all hover:bg-surface-hover hover:border-border cursor-pointer">
                    <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-mono uppercase tracking-wider text-foreground">{news.category}</span>
                      <div className="flex gap-3">
                        <span>{news.date}</span>
                        <span>·</span>
                        <span>{news.readTime}</span>
                      </div>
                    </div>
                    <h3 className="text-lg font-bold group-hover:text-primary transition-colors">{news.title}</h3>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Sidebar */}
            <div className="space-y-8">
              {/* Analyst Picks */}
              <div className="rounded-[2rem] border border-overlay-border bg-surface-elevated shadow-[var(--glow)] p-6 backdrop-blur-xl">
                <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                  <i className="fa-solid fa-crosshairs text-muted-foreground" /> Analyst Targets
                </h3>
                <div className="space-y-4">
                  {analystPicks.map((pick) => (
                    <div key={pick.ticker} className="flex flex-col gap-2 p-3 rounded-lg bg-surface border border-subtle-border">
                      <div className="flex justify-between items-center">
                        <span className="font-mono font-bold text-sm">{pick.ticker}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${pick.rating.includes('Buy') ? 'bg-up/10 text-up' : 'bg-secondary text-muted-foreground'}`}>
                          {pick.rating}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground">Target: <span className="text-foreground">{pick.target}</span></span>
                        <span className="text-muted-foreground">Current: <span className="text-foreground">{pick.current}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Newsletter CTA */}
              <div className="rounded-[2rem] border border-overlay-border bg-surface-elevated p-6 backdrop-blur-xl text-center shadow-[var(--glow)]">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary border border-border mb-4">
                  <i className="fa-solid fa-envelope-open-text text-lg text-foreground" />
                </div>
                <h3 className="text-base font-bold mb-2">The Obsidian Letter</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Get our premium weekly macro breakdown delivered straight to your inbox.
                </p>
                <div className="space-y-3">
                  <input type="email" placeholder="Email address" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary/50 text-foreground" />
                  <button className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/95 transition-colors">
                    Subscribe
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
