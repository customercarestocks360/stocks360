import { createFileRoute, Link } from "@tanstack/react-router";
import SpecularButton from "@/components/ui/specular-button";
import { AppLayout } from "@/components/layout/AppLayout";
import { useTheme } from "@/components/ThemeProvider";
import { useState, useEffect, useRef } from "react";
import Dither from "@/components/ui/Dither";
import { useScrollReveal } from "@/hooks/useScrollReveal";

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

/* ────── Animated Counter Component ────── */
function AnimatedNumber({ value, suffix = "" }: { value: string; suffix?: string }) {
  const [display, setDisplay] = useState("0");
  const ref = useRef<HTMLSpanElement>(null);
  const triggered = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !triggered.current) {
          triggered.current = true;
          const numericStr = value.replace(/[^0-9.]/g, "");
          const target = parseFloat(numericStr);
          const isDecimal = numericStr.includes(".");
          const prefix = value.replace(/[0-9.,]+.*/, "");
          const duration = 1800;
          const start = performance.now();
          const animate = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 4);
            const current = target * eased;
            const formatted = isDecimal ? current.toFixed(1) : Math.floor(current).toLocaleString();
            setDisplay(prefix + formatted);
            if (progress < 1) requestAnimationFrame(animate);
          };
          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <span ref={ref}>
      {display}
      {suffix}
    </span>
  );
}

/* ────── Orbit Ring SVG ────── */
function OrbitRing({ size = 400, duration = 20, dotCount = 6, color = "var(--primary)" }: { size?: number; duration?: number; dotCount?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="absolute opacity-20"
      style={{ animation: `spin ${duration}s linear infinite` }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={size / 2 - 2}
        fill="none"
        stroke={color}
        strokeWidth={0.5}
        strokeDasharray="4 8"
        opacity={0.4}
      />
      {Array.from({ length: dotCount }).map((_, i) => {
        const angle = (360 / dotCount) * i;
        const rad = (angle * Math.PI) / 180;
        const cx = size / 2 + (size / 2 - 2) * Math.cos(rad);
        const cy = size / 2 + (size / 2 - 2) * Math.sin(rad);
        return <circle key={i} cx={cx} cy={cy} r={2} fill={color} opacity={0.6} />;
      })}
    </svg>
  );
}

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

        {/* ─── #2 — Category Showcase Cards (Groww-style) ─── */}
        <section className="mx-auto max-w-7xl px-6 py-24 md:py-32">
          <div className="text-center mb-16" data-reveal="fade-up">
            <div className="label-mono inline-block mb-3 text-primary">Explore Markets</div>
            <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
              Your universe, unified
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {/* Crypto Card */}
            <Link
              to="/crypto"
              data-reveal="fade-up"
              data-delay="1"
              className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-8 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl hover:border-primary/30 cursor-pointer min-h-[340px]"
            >
              <div className="absolute top-0 right-0 w-40 h-40 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-700">
                <div className="w-full h-full rounded-full bg-[#f7931a] blur-3xl" />
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f7931a]/10 text-[#f7931a] mb-6 group-hover:scale-110 transition-transform duration-500">
                <i className="fa-solid fa-bitcoin-sign text-2xl" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">Crypto</h3>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                Bitcoin, Ethereum, Solana and 200+ tokens. Up to 100x leverage with institutional liquidity pools.
              </p>
              <div className="mt-6 flex items-center gap-2 font-mono text-xs font-bold text-[#f7931a] group-hover:gap-3 transition-all">
                <span>Explore Crypto</span>
                <i className="fa-solid fa-arrow-right text-[10px] group-hover:translate-x-1 transition-transform" />
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#f7931a] to-[#f7931a]/0 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
            </Link>

            {/* Stocks Card */}
            <Link
              to="/stocks"
              data-reveal="fade-up"
              data-delay="2"
              className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-8 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl hover:border-primary/30 cursor-pointer min-h-[340px]"
            >
              <div className="absolute top-0 right-0 w-40 h-40 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-700">
                <div className="w-full h-full rounded-full bg-[#3b82f6] blur-3xl" />
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3b82f6]/10 text-[#3b82f6] mb-6 group-hover:scale-110 transition-transform duration-500">
                <i className="fa-solid fa-chart-line text-2xl" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">Stocks</h3>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                US & Indian equities on a unified margin. NASDAQ, NYSE, NSE, BSE — fractional shares and extended hours.
              </p>
              <div className="mt-6 flex items-center gap-2 font-mono text-xs font-bold text-[#3b82f6] group-hover:gap-3 transition-all">
                <span>Explore Stocks</span>
                <i className="fa-solid fa-arrow-right text-[10px] group-hover:translate-x-1 transition-transform" />
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#3b82f6] to-[#3b82f6]/0 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
            </Link>

            {/* ETFs & Indices Card */}
            <Link
              to="/markets"
              data-reveal="fade-up"
              data-delay="3"
              className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-8 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl hover:border-primary/30 cursor-pointer min-h-[340px]"
            >
              <div className="absolute top-0 right-0 w-40 h-40 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-700">
                <div className="w-full h-full rounded-full bg-[#8b5cf6] blur-3xl" />
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#8b5cf6]/10 text-[#8b5cf6] mb-6 group-hover:scale-110 transition-transform duration-500">
                <i className="fa-solid fa-layer-group text-2xl" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">ETFs & Indices</h3>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                Broad exposure to sectors, global indices, and automated portfolio rebalancing. S&P 500, Nifty 50, and beyond.
              </p>
              <div className="mt-6 flex items-center gap-2 font-mono text-xs font-bold text-[#8b5cf6] group-hover:gap-3 transition-all">
                <span>Explore ETFs</span>
                <i className="fa-solid fa-arrow-right text-[10px] group-hover:translate-x-1 transition-transform" />
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#8b5cf6] to-[#8b5cf6]/0 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
            </Link>

            {/* Commodities & Forex Card */}
            <Link
              to="/markets"
              data-reveal="fade-up"
              data-delay="4"
              className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-8 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl hover:border-primary/30 cursor-pointer min-h-[340px]"
            >
              <div className="absolute top-0 right-0 w-40 h-40 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-700">
                <div className="w-full h-full rounded-full bg-[#eab308] blur-3xl" />
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eab308]/10 text-[#eab308] mb-6 group-hover:scale-110 transition-transform duration-500">
                <i className="fa-solid fa-coins text-2xl" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">Commodities</h3>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                Gold, Silver, Crude Oil, Natural Gas, and G10 FX pairs. Zero-slippage execution around the clock.
              </p>
              <div className="mt-6 flex items-center gap-2 font-mono text-xs font-bold text-[#eab308] group-hover:gap-3 transition-all">
                <span>Explore Commodities</span>
                <i className="fa-solid fa-arrow-right text-[10px] group-hover:translate-x-1 transition-transform" />
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#eab308] to-[#eab308]/0 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
            </Link>
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

        {/* ─── #5 — Live Execution Tape ─── */}
        <section className="border-y border-border overflow-hidden bg-card/20">
          <div className="py-4" data-reveal="fade-up">
            <div className="flex items-center gap-3 px-6 mb-3">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="label-mono text-xs text-emerald-500">Live Order Flow</span>
            </div>
            <div className="overflow-hidden">
              <div className="flex gap-4 px-6 marquee-track" style={{ width: "max-content" }}>
                {[
                  { pair: "BTC/USD", side: "BUY", price: "$67,418", time: "0.3s" },
                  { pair: "NVDA", side: "BUY", price: "$128.40", time: "0.8s" },
                  { pair: "ETH/USD", side: "SELL", price: "$3,548", time: "1.1s" },
                  { pair: "GOLD", side: "BUY", price: "$2,418", time: "1.4s" },
                  { pair: "AAPL", side: "BUY", price: "$224.15", time: "1.9s" },
                  { pair: "SOL/USD", side: "SELL", price: "$168.42", time: "2.2s" },
                  { pair: "EUR/USD", side: "SELL", price: "$1.089", time: "2.5s" },
                  { pair: "SPY", side: "BUY", price: "$554.20", time: "2.8s" },
                  { pair: "BTC/USD", side: "BUY", price: "$67,418", time: "0.3s" },
                  { pair: "NVDA", side: "BUY", price: "$128.40", time: "0.8s" },
                  { pair: "ETH/USD", side: "SELL", price: "$3,548", time: "1.1s" },
                  { pair: "GOLD", side: "BUY", price: "$2,418", time: "1.4s" },
                  { pair: "AAPL", side: "BUY", price: "$224.15", time: "1.9s" },
                  { pair: "SOL/USD", side: "SELL", price: "$168.42", time: "2.2s" },
                  { pair: "EUR/USD", side: "SELL", price: "$1.089", time: "2.5s" },
                  { pair: "SPY", side: "BUY", price: "$554.20", time: "2.8s" },
                ].map((trade, i) => (
                  <div
                    key={`${trade.pair}-${i}`}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 min-w-[200px]"
                  >
                    <span className={`h-2 w-2 rounded-full ${trade.side === "BUY" ? "bg-up" : "bg-down"}`} />
                    <span className="font-mono text-xs font-bold text-foreground">{trade.pair}</span>
                    <span className={`font-mono text-[10px] font-bold ${trade.side === "BUY" ? "text-up" : "text-down"}`}>
                      {trade.side}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{trade.price}</span>
                    <span className="font-mono text-[9px] text-muted-foreground/50 ml-auto">{trade.time}</span>
                  </div>
                ))}
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

        {/* ─── #7 — Trusted By / Social Proof ─── */}
        <section className="border-y border-border bg-card/20">
          <div className="mx-auto max-w-7xl px-6 py-20 text-center" data-reveal="fade-up">
            <div className="label-mono inline-block mb-3">Trusted Worldwide</div>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl mb-12">
              Trusted by <span className="text-primary">2M+</span> traders globally
            </h2>
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
                  className="group rounded-2xl border border-border bg-card p-6 transition-all duration-500 hover:shadow-xl hover:-translate-y-1"
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
