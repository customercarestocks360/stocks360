import { createFileRoute } from "@tanstack/react-router";
import SpecularButton from "@/components/ui/specular-button";
import { AppLayout } from "@/components/layout/AppLayout";
import { Spark } from "@/components/ui/spark";
import { useTheme } from "@/components/ThemeProvider";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stocks360 — The unified trading desk" },
      {
        name: "description",
        content:
          "Trade crypto, equities and ETFs from one obsidian terminal. 8ms fills, pro charts, instant withdrawals.",
      },
      { property: "og:title", content: "Stocks360 — The unified trading desk" },
      {
        property: "og:description",
        content: "Crypto, equities and ETFs in one command center. 8ms fills, instant withdrawals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const stats = [
  { label: "Assets tracked", value: "12,400+" },
  { label: "Avg. fill speed", value: "8 ms" },
  { label: "Volume / 24h", value: "$4.2B" },
  { label: "Assets in custody", value: "$118B" },
];

const assets = [
  { t: "BT", n: "Bitcoin", p: "$67,418.20", c: "+2.34%", up: true },
  { t: "ET", n: "Ethereum", p: "$3,548.90", c: "+1.12%", up: true },
  { t: "SO", n: "Solana", p: "$168.42", c: "+4.51%", up: true },
  { t: "BN", n: "BNB", p: "$598.10", c: "+1.05%", up: true },
  { t: "XR", n: "XRP", p: "$0.6231", c: "-2.41%", up: false },
  { t: "DO", n: "Dogecoin", p: "$0.1428", c: "+5.83%", up: true },
  { t: "AD", n: "Cardano", p: "$0.4521", c: "-1.18%", up: false },
  { t: "AV", n: "Avalanche", p: "$28.74", c: "+3.22%", up: true },
  { t: "LI", n: "Chainlink", p: "$14.06", c: "+2.07%", up: true },
];

const features = [
  {
    t: "Every asset, one ledger",
    d: "Crypto, Indian & US equities, ETFs, commodities — unified in a single portfolio with cross-margining.",
  },
  {
    t: "8ms matching engine",
    d: "Co-located matching fills orders in single-digit milliseconds, even during volatility spikes.",
  },
  {
    t: "Cold-storage custody",
    d: "98% of assets in cold storage with a $300M insurance fund. SOC 2 Type II audited.",
  },
  {
    t: "Pro charts, zero clutter",
    d: "Institution-grade tooling tuned for the obsidian palette — deep analysis without the noise.",
  },
  {
    t: "Global, instantly",
    d: "Deposit local, trade USD markets. One balance, one settlement, friction-free rails.",
  },
  {
    t: "Withdraw in minutes",
    d: "Instant bank withdrawals and on-chain crypto payouts, 24/7, with no deposit fees.",
  },
];

function Index() {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isDark = !mounted || theme === "dark";

  return (
    <AppLayout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="grid-bg absolute inset-0" />
        <div className="halo absolute inset-0" />
        <div className="relative mx-auto max-w-7xl px-6 py-28 text-center">
          <div className="label-mono inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--up)]" />
            Stocks360 Terminal
          </div>
          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            The unified desk for every market you trade
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
            Crypto, equities, ETFs and commodities in one obsidian command center. Markets are
            open — your terminal is ready.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <SpecularButton
              size="lg"
              radius={20}
              tint={isDark ? "#000000" : "#1a1a1a"}
              tintOpacity={1}
              blur={0}
              textColor={isDark ? "#ffffff" : "#ffffff"}
              lineColor={isDark ? "#ffffff" : "#ffffff"}
              baseColor={isDark ? "#000000" : "#1a1a1a"}
              intensity={1}
              shineSize={10}
              shineFade={40}
              thickness={1}
              speed={0.35}
              followMouse
              proximity={250}
              autoAnimate={false}
              className="uppercase tracking-[0.25em] font-bold"
              onClick={() => console.log('Get Started clicked')}
            >
              Get Started
            </SpecularButton>
            <span className="cursor-pointer rounded-md border border-border bg-card px-6 py-3 font-mono text-sm uppercase tracking-wider text-foreground transition-colors hover:bg-secondary">
              Explore markets
            </span>
          </div>
          <div className="label-mono mt-8">Protected by 2FA · SOC 2 Type II</div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-7xl grid-cols-2 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="border-r border-border px-6 py-7 last:border-r-0">
              <div className="label-mono">{s.label}</div>
              <div className="mt-2 font-mono text-2xl font-bold">{s.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Unified stream */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">The Unified Stream</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Scan every asset class from a single, calm grid.
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
            {["Crypto", "Stocks", "ETFs"].map((t, i) => (
              <span
                key={t}
                className={`cursor-pointer rounded-md px-4 py-1.5 text-sm transition-colors ${
                  i === 0
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <div
              key={a.n}
              className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[11px] font-bold text-muted-foreground">
                {a.t}
              </span>
              <Spark up={a.up} />
              <div className="ml-auto text-right">
                <div className="font-mono text-sm font-bold">{a.p}</div>
                <div className={`font-mono text-xs ${a.up ? "text-up" : "text-down"}`}>{a.c}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="grid overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.t} className="border-b border-r border-border p-8">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg">
                {f.t === "8ms matching engine" ? (
                  <i className="fa-solid fa-bolt text-xl text-foreground" aria-hidden="true" />
                ) : f.t === "Every asset, one ledger" ? (
                  <i className="fa-solid fa-layer-group text-xl text-foreground" aria-hidden="true" />
                ) : f.t === "Cold-storage custody" ? (
                  <i className="fa-solid fa-shield-halved text-xl text-foreground" aria-hidden="true" />
                ) : f.t === "Pro charts, zero clutter" ? (
                  <i className="fa-solid fa-chart-line text-xl text-foreground" aria-hidden="true" />
                ) : f.t === "Global, instantly" ? (
                  <i className="fa-solid fa-globe text-xl text-foreground" aria-hidden="true" />
                ) : f.t === "Withdraw in minutes" ? (
                  <i className="fa-solid fa-wallet text-xl text-foreground" aria-hidden="true" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-primary" />
                )}
              </div>
              <h3 className="mt-5 text-base font-bold">{f.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden border-y border-border">
        <div className="grid-bg absolute inset-0" />
        <div className="halo absolute inset-0" />
        <div className="relative mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="text-4xl font-bold tracking-tight md:text-5xl">
            Begin building your position
          </h2>
          <p className="mt-4 text-muted-foreground">
            Open a desk in under two minutes. No deposit fees, no lock-ins.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <span className="cursor-pointer rounded-md bg-primary px-6 py-3 font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-[var(--glow)]">
              Open free account
            </span>
            <span className="cursor-pointer rounded-md border border-border bg-card px-6 py-3 font-mono text-sm uppercase tracking-wider">
              Explore markets
            </span>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {["No deposit fees", "0.1% spot trading", "Instant withdrawals", "SOC 2 Type II"].map(
              (c) => (
                <span key={c} className="flex items-center gap-1.5">
                  <span className="text-primary">✓</span>
                  {c}
                </span>
              ),
            )}
          </div>
        </div>
      </section>

    </AppLayout>
  );
}
