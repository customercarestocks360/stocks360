import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import SpecularButton from "@/components/ui/specular-button";
import { useTheme } from "@/components/ThemeProvider";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing & Fees — Stocks360" },
      { name: "description", content: "Transparent pricing. Zero deposit fees. Institutional liquidity." },
    ],
  }),
  component: PricingPage,
});

const tiers = [
  {
    name: "Starter",
    price: "Free",
    desc: "For casual traders building their first portfolio.",
    features: [
      "0.15% spot trading fee",
      "Basic charts & indicators",
      "Standard email support",
      "No deposit fees",
    ],
    buttonText: "Open Free Account",
    isPopular: false,
  },
  {
    name: "Pro",
    price: "$29",
    period: "/mo",
    desc: "Advanced tools and lower fees for active market participants.",
    features: [
      "0.05% spot trading fee",
      "Pro charts with TradingView integration",
      "Priority 24/7 support",
      "Margin trading up to 5x",
      "Advanced portfolio analytics",
    ],
    buttonText: "Start Pro Trial",
    isPopular: true,
  },
  {
    name: "Institutional",
    price: "Custom",
    desc: "Bespoke liquidity and infrastructure for heavy volume.",
    features: [
      "0.01% maker / 0.02% taker fees",
      "Dedicated account manager",
      "Colocated API access (<5ms latency)",
      "Custom margin & OTC desk",
      "SOC 2 compliance reporting",
    ],
    buttonText: "Contact Sales",
    isPopular: false,
  },
];

function PricingPage() {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isDark = !mounted || theme === "dark";

  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border min-h-[calc(100vh-250px)]">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div className="halo absolute inset-0 opacity-60" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-20">
          <div className="mb-16 text-center">
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Transparent Pricing</h1>
            <p className="mt-4 max-w-2xl mx-auto text-muted-foreground">
              No hidden spreads. No deposit fees. Choose the tier that matches your trading volume and tooling requirements.
            </p>
          </div>
          
          <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
            {tiers.map((tier) => (
              <div 
                key={tier.name} 
                className={`relative flex flex-col rounded-[2rem] border ${tier.isPopular ? 'border-primary/30 bg-surface-elevated shadow-[var(--glow)]' : 'border-overlay-border bg-overlay'} p-8 backdrop-blur-xl transition-all hover:-translate-y-1 hover:shadow-lg`}
              >
                {tier.isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">
                    Most Popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-xl font-bold mb-2">{tier.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight">{tier.price}</span>
                    {tier.period && <span className="text-muted-foreground">{tier.period}</span>}
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground h-10">{tier.desc}</p>
                </div>
                
                <div className="mb-8 flex-1">
                  <ul className="space-y-4 text-sm">
                    {tier.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-3 text-muted-foreground">
                        <i className="fa-solid fa-check text-foreground mt-0.5 text-xs" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                
                {tier.isPopular ? (
                  <SpecularButton
                    size="lg"
                    radius={16}
                    tint={isDark ? "#000000" : "#ffffff"}
                    tintOpacity={1}
                    blur={0}
                    textColor={isDark ? "#ffffff" : "#000000"}
                    lineColor={isDark ? "#ffffff" : "#4e4e4e"}
                    baseColor={isDark ? "#000000" : "#ffffff"}
                    intensity={1}
                    shineSize={12}
                    shineFade={38}
                    thickness={1}
                    speed={0.35}
                    followMouse
                    proximity={240}
                    autoAnimate={false}
                    className="w-full font-bold"
                  >
                    {tier.buttonText}
                  </SpecularButton>
                ) : (
                  <button className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-bold text-foreground hover:bg-surface-hover transition-colors">
                    {tier.buttonText}
                  </button>
                )}
              </div>
            ))}
          </div>
          
          <div className="mt-20 text-center text-sm text-muted-foreground">
            <p>All plans include standard 2FA, cold storage custody, and access to the mobile app.</p>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
