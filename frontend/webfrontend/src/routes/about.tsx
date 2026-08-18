import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { AnimatedNumber } from "@/components/ui/marketing";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Stocks360" },
      {
        name: "description",
        content: "Why we built Stocks360 — one unified terminal for equities, ETFs and forex.",
      },
      { property: "og:title", content: "About — Stocks360" },
      {
        property: "og:description",
        content: "The story, principles and team behind the Stocks360 trading desk.",
      },
    ],
  }),
  component: AboutPage,
});

const values = [
  {
    t: "Speed, without shortcuts",
    d: "8ms fills come from a co-located matching engine, not from cutting corners on risk controls.",
    icon: "fa-bolt",
  },
  {
    t: "Radical transparency",
    d: "No hidden spreads, no payment-for-order-flow games. What you see on the ticket is what you pay.",
    icon: "fa-eye",
  },
  {
    t: "Custody you can verify",
    d: "98% of digital assets in air-gapped cold storage, backed by a $300M insurance fund and SOC 2 Type II audits.",
    icon: "fa-shield-halved",
  },
];

const legalTabs = [
  {
    key: "about",
    label: "About Us",
    icon: "fa-circle-info",
  },
  {
    key: "terms",
    label: "Terms",
    icon: "fa-file-contract",
    d: "By using Stocks360 you agree to our Terms of Service — the rules governing accounts, order execution and acceptable use of the platform.",
  },
  {
    key: "privacy",
    label: "Privacy",
    icon: "fa-user-shield",
    d: "We collect only what's needed to run your account and never sell your data. Our Privacy Policy covers what we store, why, and how you can request it removed.",
  },
  {
    key: "risk",
    label: "Risk disclosure",
    icon: "fa-triangle-exclamation",
    d: "Trading equities, ETFs and forex carries risk of loss, including principal. Past performance doesn't guarantee future results — only trade what you can afford to lose.",
  },
  {
    key: "fees",
    label: "Fees",
    icon: "fa-receipt",
    d: "Flat, transparent fees on every trade — no hidden spreads and no payment-for-order-flow markups. The full fee schedule lives in your account settings.",
  },
  {
    key: "compliance",
    label: "Compliance",
    icon: "fa-clipboard-check",
    d: "Stocks360 operates under SOC 2 Type II controls and applicable regional financial regulations, with regular independent audits of custody and platform controls.",
  },
];

function AboutPage() {
  const [activeLegal, setActiveLegal] = useState<string | null>(null);
  const activeTab = legalTabs.find((tab) => tab.key === activeLegal);

  return (
    <AppLayout>
      {/* ═══════════════════════════════════════════
          HERO
          ═══════════════════════════════════════════ */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div
          className="absolute -top-32 -left-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--up)" }}
        />
        <div
          className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--chart-2)" }}
        />

        <div className="relative mx-auto max-w-7xl px-6 py-16">
          <div className="mb-10 max-w-2xl">
            <div className="label-mono inline-flex items-center gap-2 mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--up)] animate-pulse" />
              Our Story
            </div>
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
              Built by traders, for traders
            </h1>
            <p className="mt-4 text-muted-foreground transition-colors">
              Stocks360 started as a frustration: managing equities, ETFs and forex meant juggling
              three logins, three balances and three sets of fees. We built the desk we actually
              wanted to trade on — one terminal, one ledger, no compromises.
            </p>
          </div>
        </div>
      </section>

      <div>
        {/* ─── Stats strip ─── */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-7xl px-6 py-10">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              {[
                { value: "2021", suffix: "", label: "Founded", icon: "fa-flag" },
                { value: "2.4", suffix: "M+", label: "Traders Served", icon: "fa-users" },
                { value: "40", suffix: "+", label: "Countries Reached", icon: "fa-earth-americas" },
                { value: "118", suffix: "B", label: "Assets in Custody", icon: "fa-vault" },
              ].map((stat) => (
                <div key={stat.label} className="text-center group">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded sm:rounded-2xl bg-secondary text-muted-foreground mb-4 transition-all duration-300 group-hover:scale-110 group-hover:shadow-md">

                    <i className={`fa-solid ${stat.icon} text-base`} />
                  </div>
                  <div className="font-mono text-2xl md:text-3xl font-bold text-foreground tracking-tight">
                    <AnimatedNumber value={stat.value} suffix={stat.suffix} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Mission ─── */}
        <section className="mx-auto max-w-7xl px-6 py-20 md:py-28">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <div className="label-mono text-primary mb-4 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Why We Exist
              </div>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                Every market you trade,
                <br />
                one balance to manage it.
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed max-w-md">
                Cross-margin across equities, ETFs, forex and commodities means your capital works
                everywhere at once — no transfers, no fragmented risk, no waiting for settlement
                between markets. That single idea is the reason Stocks360 exists.
              </p>
            </div>
            <div className="relative rounded sm:rounded-2xl border border-border bg-card p-8 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-primary/30 overflow-hidden">
              <div
                className="absolute top-0 left-0 h-1 w-full"
                style={{ background: "linear-gradient(90deg, var(--up), var(--chart-2))" }}
              />
              <p className="text-lg font-medium text-foreground leading-relaxed">
                &ldquo;We were tired of switching apps to check if a margin call on one exchange was
                about to wreck a position on another. So we stopped switching.&rdquo;
              </p>
              <p className="mt-4 text-sm text-muted-foreground">— The Stocks360 founding team</p>
            </div>
          </div>
        </section>

        {/* ─── What we believe ─── */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
            <div className="text-center mb-14">
              <div className="label-mono inline-block mb-3">What We Believe</div>
              <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
                Principles we don't compromise on
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {values.map((v) => (
                <div
                  key={v.t}
                  className="group rounded sm:rounded-2xl border border-border bg-card p-8 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-primary/30"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded sm:rounded-xl bg-secondary text-muted-foreground mb-5 transition-transform duration-300 group-hover:scale-110">

                    <i className={`fa-solid ${v.icon} text-lg`} />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">{v.t}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{v.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Team note ─── */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-3xl px-6 py-20 md:py-28 text-center">
            <div className="label-mono inline-block mb-3">The Team</div>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl mb-6">
              A small, distributed team of traders and engineers
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              We're a remote-first team spread across time zones, which is fitting — markets don't
              keep office hours, and neither do we. Everyone who ships product here trades on it
              too, so every rough edge gets fixed by someone who felt it first.
            </p>
          </div>
        </section>

        {/* ─── Legal ─── */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-3xl px-6 py-16 text-center">
            <div className="label-mono inline-block mb-3">Legal</div>
            <div className="flex flex-wrap justify-center gap-2">
              {legalTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveLegal(tab.key === "about" ? null : tab.key)}
                  className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-mono uppercase tracking-wider transition-all duration-300 ${
                    (tab.key === "about" && !activeLegal) || activeLegal === tab.key
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  <i className={`fa-solid ${tab.icon} mr-2`} />
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              className={`grid overflow-hidden transition-all duration-300 ease-out ${
                activeTab ? "mt-6 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                {activeTab && (
                  <div className="rounded sm:rounded-2xl border border-border bg-card p-6 text-left shadow-sm">
                    <h3 className="text-sm font-bold text-foreground mb-2">
                      <i className={`fa-solid ${activeTab.icon} mr-2 text-muted-foreground`} />
                      {activeTab.label}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{activeTab.d}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="relative overflow-hidden border-t border-border">
          <div
            className="absolute inset-0 opacity-10"
            style={{ background: "radial-gradient(circle at 50% 0%, var(--up), transparent 60%)" }}
          />
          <div className="relative mx-auto max-w-3xl px-6 py-24 md:py-32 text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-5xl leading-[1.05]">
              Come trade with us
            </h2>
            <p className="mt-5 text-muted-foreground">
              Open your desk in under two minutes. No deposit fees, no lock-ins.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                to="/signup"
                className="cursor-pointer rounded sm:rounded-2xl bg-primary px-10 py-4 font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-lg transition-all duration-300 hover:scale-[1.03] hover:shadow-xl hover:shadow-primary/20 active:scale-[0.98]"
              >
                Open free account
              </Link>
              <Link
                to="/markets"
                className="cursor-pointer rounded sm:rounded-2xl border border-border bg-card px-10 py-4 font-mono text-sm uppercase tracking-wider text-foreground transition-all duration-300 hover:bg-secondary hover:border-primary/30 hover:scale-[1.03]"
              >
                Explore markets
              </Link>
            </div>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
