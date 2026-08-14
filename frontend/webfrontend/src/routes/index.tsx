import { createFileRoute, Link } from "@tanstack/react-router";
import SpecularButton from "@/components/ui/specular-button";
import { AppLayout } from "@/components/layout/AppLayout";
import { useTheme } from "@/components/ThemeProvider";
import { useState, useEffect } from "react";
import Dither from "@/components/ui/Dither";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { AnimatedNumber, OrbitRing, MiniSparkline, IconTileRow, TestimonialCard } from "@/components/ui/marketing";

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

/* Sample quotes — placeholders until real trader testimonials are collected */
const TESTIMONIALS = [
  { name: "Ananya Rao", role: "Full-time Trader", quote: "The unified margin across crypto and equities changed how I manage risk. One dashboard, zero friction." },
  { name: "Vikram Shah", role: "Options Trader", quote: "8ms fills aren't marketing fluff — I've clocked it myself during volatile opens." },
  { name: "Meera Iyer", role: "Software Engineer", quote: "Finally a terminal that doesn't feel like it was built in 2012. Dark mode done right." },
  { name: "Rohan Kapoor", role: "Portfolio Analyst", quote: "Cross-margin across ETFs and commodities saved me from constantly shuffling capital." },
  { name: "Sneha Verma", role: "Early-stage Investor", quote: "Support responded in minutes during a margin call at 2am. Impressive coverage." },
  { name: "Arjun Malhotra", role: "Quant Developer", quote: "The API latency is genuinely sub-5ms. My algo strategies run smoother than anywhere else." },
  { name: "Divya Nair", role: "Retail Investor", quote: "Onboarding took four minutes and I was trading Nifty ETFs the same day." },
  { name: "Karan Bhatia", role: "Swing Trader", quote: "Zero requotes even during CPI releases. That alone is worth switching for." },
];

function Index() {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [heroHovered, setHeroHovered] = useState(false);
  const [activeWord, setActiveWord] = useState(0);
  const scrollRef = useScrollReveal();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setActiveWord((prev) => (prev + 1) % 4), 2800);
    return () => clearInterval(timer);
  }, []);

  const isDark = !mounted || theme === "dark";
  const waveColor = isDark ? [0.52, 0.52, 0.52] : [0.75, 0.75, 0.78];
  const bgColor = isDark ? [0.0, 0.0, 0.0] : [1.0, 1.0, 1.0];
  const waveAmplitude = isDark ? 0.15 : 0.05;

  const rotatingWords = ["Crypto", "Equities", "ETFs", "Forex"];

  return (
    <AppLayout>
      {/* ═══════════════════════════════════════════
          HERO — Preserved exactly as approved
          ═══════════════════════════════════════════ */}
      <section
        className="relative isolate overflow-hidden border-b border-border"
        onMouseEnter={() => setHeroHovered(true)}
        onMouseLeave={() => setHeroHovered(false)}
      >
        <div className="absolute inset-0 overflow-hidden">
          <Dither
            waveColor={waveColor}
            bgColor={bgColor}
            disableAnimation={false}
            enableMouseInteraction={heroHovered}
            mouseRadius={0.45}
            colorNum={4}
            waveAmplitude={waveAmplitude}
            waveFrequency={3}
            waveSpeed={0.12}
          />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl px-6 py-28 text-center">
          <div className="label-mono inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--up)]" />
            Stocks360 Terminal
          </div>
          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            The unified desk for every market you trade
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
            Crypto, equities, ETFs and commodities in one obsidian command center. Markets are open
            — your terminal is ready.
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
              onClick={() => console.log("Get Started clicked")}
            >
              Get Started
            </SpecularButton>
            <Link
              to="/markets"
              className="cursor-pointer rounded-md border border-border bg-card px-6 py-3 font-mono text-sm uppercase tracking-wider text-foreground transition-colors hover:bg-secondary"
            >
              Explore markets
            </Link>
          </div>
          <div className="label-mono mt-8">Protected by 2FA · SOC 2 Type II</div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          EVERYTHING BELOW — Brand storytelling
          ═══════════════════════════════════════════ */}
      <div ref={scrollRef}>
        {/* ─── #1 — Massive Statement with Rotating Word ─── */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="grid-bg absolute inset-0 opacity-40" />
          <div className="relative mx-auto max-w-7xl px-6 py-32 md:py-44">
            <div data-reveal="fade-up" className="text-center">
              <h2 className="text-4xl font-bold tracking-tight md:text-7xl lg:text-8xl leading-[1.05]">
                Every market.
                <br />
                <span className="relative inline-block">
                  One{" "}
                  <span className="relative">
                    <span
                      key={activeWord}
                      className="inline-block text-primary transition-all duration-500"
                      style={{
                        animation: "count-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
                      }}
                    >
                      {rotatingWords[activeWord]}
                    </span>
                  </span>{" "}
                  terminal.
                </span>
              </h2>
              <p className="mx-auto mt-8 max-w-2xl text-lg text-muted-foreground md:text-xl" data-reveal="fade-up" data-delay="2">
                We built the platform we wanted to trade on. No noise, no compromise.
                <br className="hidden md:block" />
                Just markets, raw speed, and absolute control.
              </p>
            </div>
          </div>
        </section>

        {/* ─── #2 — Category Showcase Bento (Groww-style asymmetric grid) ─── */}
        <section className="mx-auto max-w-7xl px-6 py-24 md:py-32">
          <div className="text-center mb-16" data-reveal="fade-up">
            <div className="label-mono inline-block mb-3 text-primary">Explore Markets</div>
            <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
              Your universe, unified
            </h2>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* ── Left column: Stocks (tall) + Commodities & Forex (wide banner) ── */}
            <div className="flex flex-col gap-6">
              {/* Stocks Card — mock ticker + sparkline */}
              <Link
                to="/stocks"
                data-reveal="approach"
                className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-8 transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl hover:border-primary/30 cursor-pointer min-h-[380px]"
              >
                <div className="absolute top-0 right-0 w-56 h-56 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-700 pointer-events-none">
                  <div className="w-full h-full rounded-full bg-[#3b82f6] blur-3xl" />
                </div>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#3b82f6]/10 text-[#3b82f6] mb-5 group-hover:scale-110 transition-transform duration-500">
                      <i className="fa-solid fa-chart-line text-xl" />
                    </div>
                    <h3 className="text-2xl font-bold text-foreground mb-1">Stocks</h3>
                    <p className="text-sm text-muted-foreground max-w-xs">
                      US & Indian equities — NASDAQ, NYSE, NSE, BSE. Fractional shares, extended hours.
                    </p>
                  </div>
                  <i className="fa-solid fa-arrow-up-right text-muted-foreground/40 group-hover:text-[#3b82f6] group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                </div>

                <div className="mt-6 rounded-2xl border border-border bg-background/40 p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        RESE · Renewable Energy Solutions
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-2xl font-bold font-mono text-foreground">₹792.52</span>
                        <span className="text-xs font-mono font-bold text-up">+15.95 (2.24%)</span>
                      </div>
                    </div>
                    <span className="mt-1 h-2 w-2 rounded-full bg-up animate-pulse" />
                  </div>
                  <div className="mt-3">
                    <MiniSparkline color="var(--up)" points={[10, 14, 11, 18, 15, 22, 19, 28, 24, 34, 30, 42]} />
                  </div>
                  <div className="mt-2 flex gap-2 font-mono text-[10px] text-muted-foreground">
                    {["1D", "1W", "1M", "1Y", "All"].map((r, i) => (
                      <span key={r} className={`px-2 py-0.5 rounded-full ${i === 0 ? "bg-primary text-primary-foreground font-bold" : ""}`}>
                        {r}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-2 font-mono text-xs font-bold text-[#3b82f6] group-hover:gap-3 transition-all">
                  <span>Explore Stocks</span>
                  <i className="fa-solid fa-arrow-right text-[10px] group-hover:translate-x-1 transition-transform" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#3b82f6] to-[#3b82f6]/0 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
              </Link>

              {/* Commodities & Forex Banner — icon tiles */}
              <Link
                to="/markets"
                data-reveal="approach"
                data-delay="2"
                className="group relative flex flex-col md:flex-row md:items-center md:justify-between gap-6 overflow-hidden rounded-3xl border border-border bg-card p-8 transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl hover:border-primary/30 cursor-pointer min-h-[180px]"
              >
                <div className="absolute top-0 right-0 w-40 h-40 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-700 pointer-events-none">
                  <div className="w-full h-full rounded-full bg-[#eab308] blur-3xl" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-foreground mb-1">Commodities & Forex</h3>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Gold, Silver, Crude Oil, Natural Gas & G10 FX pairs.
                  </p>
                  <div className="mt-4 flex items-center gap-2 font-mono text-xs font-bold text-[#eab308] group-hover:gap-3 transition-all">
                    <span>Explore Commodities</span>
                    <i className="fa-solid fa-arrow-right text-[10px] group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
                <IconTileRow
                  items={[
                    { icon: "fa-coins", color: "#eab308" },
                    { icon: "fa-water", color: "#3b82f6" },
                    { icon: "fa-money-bill-transfer", color: "#10b981" },
                    { icon: "fa-fire", color: "#ef4444" },
                  ]}
                />
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#eab308] to-[#eab308]/0 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
              </Link>
            </div>

            {/* ── Right column: ETFs & Indices (banner) + Crypto (tall) ── */}
            <div className="flex flex-col gap-6">
              {/* ETFs & Indices Banner — icon tiles */}
              <Link
                to="/markets"
                data-reveal="approach"
                data-delay="1"
                className="group relative flex flex-col gap-6 overflow-hidden rounded-3xl border border-border bg-card p-8 transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl hover:border-primary/30 cursor-pointer min-h-[180px]"
              >
                <div className="absolute top-0 right-0 w-40 h-40 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-700 pointer-events-none">
                  <div className="w-full h-full rounded-full bg-[#8b5cf6] blur-3xl" />
                </div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-2xl font-bold text-foreground mb-1">ETFs & Indices</h3>
                    <p className="text-sm text-muted-foreground">Gold, Silver, International & Index ETFs</p>
                  </div>
                  <i className="fa-solid fa-arrow-up-right text-muted-foreground/40 group-hover:text-[#8b5cf6] group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                </div>
                <IconTileRow
                  items={[
                    { icon: "fa-coins", color: "#eab308" },
                    { icon: "fa-layer-group", color: "#8b5cf6" },
                    { icon: "fa-earth-americas", color: "#3b82f6" },
                    { icon: "fa-building-columns", color: "#10b981" },
                  ]}
                />
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#8b5cf6] to-[#8b5cf6]/0 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
              </Link>

              {/* Crypto Card — mock live ticker + sparkline */}
              <Link
                to="/crypto"
                data-reveal="approach"
                data-delay="3"
                className="group relative flex flex-1 flex-col overflow-hidden rounded-3xl border border-border bg-card p-8 transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl hover:border-primary/30 cursor-pointer min-h-[380px]"
              >
                <div className="absolute top-0 right-0 w-56 h-56 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-700 pointer-events-none">
                  <div className="w-full h-full rounded-full bg-[#f7931a] blur-3xl" />
                </div>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f7931a]/10 text-[#f7931a] mb-5 group-hover:scale-110 transition-transform duration-500">
                      <i className="fa-solid fa-bitcoin-sign text-xl" />
                    </div>
                    <h3 className="text-2xl font-bold text-foreground mb-1">Crypto</h3>
                    <p className="text-sm text-muted-foreground max-w-xs">
                      Bitcoin, Ethereum, Solana & 200+ tokens. Up to 100x leverage.
                    </p>
                  </div>
                  <i className="fa-solid fa-arrow-up-right text-muted-foreground/40 group-hover:text-[#f7931a] group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                </div>

                <div className="mt-6 rounded-2xl border border-border bg-background/40 p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live · BTC/USD
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-2xl font-bold font-mono text-foreground">$67,418</span>
                        <span className="text-xs font-mono font-bold text-up">+2.9%</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <MiniSparkline color="#f7931a" points={[30, 24, 32, 22, 28, 18, 26, 16, 22, 12, 18, 8]} />
                  </div>
                  <div className="mt-2 flex gap-2 font-mono text-[10px] text-muted-foreground">
                    {["1H", "1D", "1W", "1M", "All"].map((r, i) => (
                      <span key={r} className={`px-2 py-0.5 rounded-full ${i === 1 ? "bg-primary text-primary-foreground font-bold" : ""}`}>
                        {r}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-2 font-mono text-xs font-bold text-[#f7931a] group-hover:gap-3 transition-all">
                  <span>Explore Crypto</span>
                  <i className="fa-solid fa-arrow-right text-[10px] group-hover:translate-x-1 transition-transform" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#f7931a] to-[#f7931a]/0 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
              </Link>
            </div>
          </div>
        </section>

        {/* ─── #3 — Full-Width Cinematic Numbers ─── */}
        <section className="relative overflow-hidden border-y border-border">
          <div className="halo absolute inset-0" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04]">
            <OrbitRing size={600} duration={60} dotCount={12} />
            <OrbitRing size={400} duration={45} dotCount={8} />
            <OrbitRing size={200} duration={30} dotCount={4} />
          </div>
          <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-36">
            <div className="text-center mb-16" data-reveal="blur">
              <div className="label-mono inline-block mb-3">By The Numbers</div>
              <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
                Built at scale. Proven under pressure.
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
              {[
                { value: "12400", suffix: "+", label: "Assets Tracked", icon: "fa-database" },
                { value: "8", suffix: " ms", label: "Average Fill Speed", icon: "fa-bolt" },
                { value: "4.2", suffix: "B", label: "24h Trading Volume", icon: "fa-chart-bar" },
                { value: "118", suffix: "B", label: "Assets in Custody", icon: "fa-vault" },
              ].map((stat, i) => (
                <div
                  key={stat.label}
                  data-reveal="scale"
                  data-delay={String(i + 1)}
                  className="group text-center"
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary mb-5 group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-500">
                    <i className={`fa-solid ${stat.icon} text-lg`} />
                  </div>
                  <div className="font-mono text-4xl md:text-5xl font-bold text-foreground tracking-tight">
                    <AnimatedNumber value={stat.value} suffix={stat.suffix} />
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── #4 — "Why Stocks360" — Alternating Cinematic Feature Blocks ─── */}
        <section className="mx-auto max-w-7xl px-6 py-24 md:py-32 space-y-32">
          {/* Block 1 — Speed */}
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div data-reveal="fade-left">
              <div className="label-mono text-primary mb-4 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Matching Engine
              </div>
              <h3 className="text-3xl font-bold tracking-tight md:text-4xl">
                8ms fills.<br />Not a typo.
              </h3>
              <p className="mt-4 text-muted-foreground leading-relaxed max-w-md">
                Our co-located matching engine processes orders in single-digit milliseconds — even during market-wide volatility spikes. No requotes, no slippage, no excuses.
              </p>
              <div className="mt-6 flex flex-wrap gap-4">
                {["Zero requotes", "< 0.001% slippage", "99.99% uptime"].map((f) => (
                  <span key={f} className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-xs font-mono text-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {f}
                  </span>
                ))}
              </div>
            </div>
            <div data-reveal="fade-right" data-delay="2" className="relative flex items-center justify-center min-h-[300px]">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-64 h-64 rounded-full border border-border/50 flex items-center justify-center animate-pulse-glow text-primary/20">
                  <div className="w-44 h-44 rounded-full border border-border/50 flex items-center justify-center">
                    <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="font-mono text-3xl font-bold text-primary">8ms</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Block 2 — Security */}
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div data-reveal="fade-left" className="relative flex items-center justify-center min-h-[300px] md:order-1">
              <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
                {[
                  { icon: "fa-shield-halved", label: "Cold Storage", sub: "98% of assets" },
                  { icon: "fa-lock", label: "2FA+", sub: "Multi-factor auth" },
                  { icon: "fa-certificate", label: "SOC 2", sub: "Type II certified" },
                  { icon: "fa-building-columns", label: "$300M", sub: "Insurance fund" },
                ].map((item, i) => (
                  <div
                    key={item.label}
                    className="group rounded-2xl border border-border bg-card p-5 text-center transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:-translate-y-1"
                    style={{ animationDelay: `${i * 150}ms` }}
                  >
                    <i className={`fa-solid ${item.icon} text-xl text-muted-foreground group-hover:text-primary transition-colors`} />
                    <div className="mt-3 font-bold text-sm text-foreground">{item.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{item.sub}</div>
                  </div>
                ))}
              </div>
            </div>
            <div data-reveal="fade-right" data-delay="2" className="md:order-2">
              <div className="label-mono text-primary mb-4 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Custody & Security
              </div>
              <h3 className="text-3xl font-bold tracking-tight md:text-4xl">
                Your assets.<br />Our obsession.
              </h3>
              <p className="mt-4 text-muted-foreground leading-relaxed max-w-md">
                98% of digital assets live in air-gapped cold storage. Backed by a $300M insurance fund and continuous SOC 2 Type II auditing. Your trust is our infrastructure.
              </p>
            </div>
          </div>

          {/* Block 3 — Cross-Margin */}
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div data-reveal="fade-left">
              <div className="label-mono text-primary mb-4 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Unified Ledger
              </div>
              <h3 className="text-3xl font-bold tracking-tight md:text-4xl">
                One balance.<br />Every market.
              </h3>
              <p className="mt-4 text-muted-foreground leading-relaxed max-w-md">
                Cross-margin across crypto, equities, ETFs, and commodities. No transferring between wallets. No fragmented capital. One deposit trades everything.
              </p>
            </div>
            <div data-reveal="fade-right" data-delay="2" className="relative flex items-center justify-center min-h-[280px]">
              <div className="flex flex-col gap-3 w-full max-w-sm">
                {[
                  { market: "Crypto", color: "#f7931a", icon: "fa-bitcoin-sign" },
                  { market: "Equities", color: "#3b82f6", icon: "fa-chart-line" },
                  { market: "ETFs", color: "#8b5cf6", icon: "fa-layer-group" },
                  { market: "Commodities", color: "#eab308", icon: "fa-coins" },
                ].map((item, i) => (
                  <div
                    key={item.market}
                    className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all duration-300 hover:border-primary/30"
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${item.color}15`, color: item.color }}
                    >
                      <i className={`fa-solid ${item.icon}`} />
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-sm text-foreground">{item.market}</div>
                      <div className="text-xs text-muted-foreground">Cross-margined</div>
                    </div>
                    <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-1000"
                        style={{
                          width: `${60 + i * 10}%`,
                          backgroundColor: item.color,
                          opacity: 0.6,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div className="text-center mt-2 text-xs font-mono text-muted-foreground">
                  ↑ Single ledger, unified margin
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── #6 — Platform Features Bento Grid ─── */}
        <section className="mx-auto max-w-7xl px-6 py-24 md:py-32">
          <div className="text-center mb-16" data-reveal="blur">
            <div className="label-mono inline-block mb-3">Platform</div>
            <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
              Engineered for precision
            </h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
              Institutional-grade architecture meets obsidian design
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3 md:grid-rows-2">
            {[
              {
                t: "Pro Charts",
                d: "TradingView-powered charts with 100+ indicators. Dark-optimized for extended sessions.",
                icon: "fa-chart-line",
                span: "md:col-span-2",
              },
              {
                t: "Instant Withdrawals",
                d: "Bank transfers and on-chain crypto payouts. 24/7, zero fees.",
                icon: "fa-wallet",
                span: "",
              },
              {
                t: "Global Access",
                d: "Deposit local, trade global. One balance, one settlement.",
                icon: "fa-globe",
                span: "",
              },
              {
                t: "API & Algo Trading",
                d: "WebSocket feeds, REST API, FIX protocol. < 5ms latency for co-located strategies.",
                icon: "fa-code",
                span: "md:col-span-2",
              },
            ].map((f, i) => (
              <div
                key={f.t}
                data-reveal="rotate"
                data-delay={String(i + 1)}
                className={`group relative overflow-hidden rounded-2xl border border-border bg-card p-8 transition-all duration-500 hover:border-primary/30 hover:shadow-lg ${f.span}`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary mb-5 group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-500">
                  <i className={`fa-solid ${f.icon} text-lg`} />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors">{f.t}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.d}</p>
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent scale-x-0 group-hover:scale-x-100 transition-transform duration-700" />
              </div>
            ))}
          </div>
        </section>

        {/* ─── #7 — Trusted By / Social Proof — interactive testimonial wall ─── */}
        <section className="relative overflow-hidden border-y border-border bg-card/20 py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-6 text-center" data-reveal="fade-up">
            
          </div>

          <div className="relative mt-4">
            {/* Row 1 — scrolls left, pauses on hover */}
            <div
              className="overflow-hidden py-2.5"
              style={{ maskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)" }}
            >
              <div className="flex gap-5 marquee-track w-max">
                {[...TESTIMONIALS, ...TESTIMONIALS].map((t, i) => (
                  <TestimonialCard key={`row1-${i}`} {...t} delay={(i % TESTIMONIALS.length) * 70} />
                ))}
              </div>
            </div>

            {/* Center heading — sits between the two rows with its own breathing room, not overlapping either */}
            <div className="relative z-10 my-8 flex justify-center md:my-10">
              <h2 className="text-2xl font-bold tracking-tight text-foreground/60 md:text-4xl">
                Trusted by <AnimatedNumber value="2400000" suffix="+" /> traders
              </h2>
            </div>

            {/* Row 2 — scrolls right, opposite direction, pauses on hover */}
            <div
              className="overflow-hidden py-2.5"
              style={{ maskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)" }}
            >
              <div className="flex gap-5 marquee-track-reverse w-max">
                {[...TESTIMONIALS.slice().reverse(), ...TESTIMONIALS.slice().reverse()].map((t, i) => (
                  <TestimonialCard key={`row2-${i}`} {...t} delay={(i % TESTIMONIALS.length) * 70} />
                ))}
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-7xl px-6 mt-16">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { stat: "$300M", label: "Insurance Fund", icon: "fa-shield-halved" },
                { stat: "99.99%", label: "Platform Uptime", icon: "fa-server" },
                { stat: "SOC 2", label: "Type II Certified", icon: "fa-certificate" },
                { stat: "24/7", label: "Support Coverage", icon: "fa-headset" },
              ].map((item, i) => (
                <div
                  key={item.label}
                  data-reveal="scale"
                  data-delay={String(i + 1)}
                  className="group rounded-2xl border border-border bg-card p-6 text-center transition-all duration-500 hover:shadow-xl hover:-translate-y-1"
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-secondary mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-500">
                    <i className={`fa-solid ${item.icon} text-lg`} />
                  </div>
                  <div className="font-mono text-2xl font-bold text-foreground">{item.stat}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── #8 — Final CTA — Massive, cinematic ─── */}
        <section className="relative overflow-hidden">
          <div className="grid-bg absolute inset-0 opacity-30" />
          <div className="halo absolute inset-0" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03]">
            <OrbitRing size={800} duration={90} dotCount={16} />
          </div>
          <div className="relative mx-auto max-w-3xl px-6 py-32 md:py-44 text-center" data-reveal="blur">
            <div className="label-mono mb-4 text-primary">Start Trading</div>
            <h2 className="text-4xl font-bold tracking-tight md:text-6xl leading-[1.05]">
              Begin building<br />your position
            </h2>
            <p className="mt-6 text-lg text-muted-foreground">
              Open your desk in under two minutes. No deposit fees, no lock-ins, no compromises.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                to="/signup"
                className="cursor-pointer rounded-2xl bg-primary px-10 py-4 font-mono text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-lg transition-all hover:scale-[1.03] hover:shadow-xl active:scale-[0.98]"
              >
                Open free account
              </Link>
              <Link
                to="/markets"
                className="cursor-pointer rounded-2xl border border-border bg-card px-10 py-4 font-mono text-sm uppercase tracking-wider text-foreground transition-colors hover:bg-secondary"
              >
                Explore markets
              </Link>
            </div>
            <div className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-3 text-xs font-mono text-muted-foreground">
              {["No deposit fees", "0.1% spot trading", "Instant withdrawals", "SOC 2 Type II"].map(
                (c) => (
                  <span key={c} className="flex items-center gap-2">
                    <span className="text-primary font-bold">✓</span>
                    {c}
                  </span>
                ),
              )}
            </div>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
