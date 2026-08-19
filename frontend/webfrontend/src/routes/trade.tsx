import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { TradingDesk } from "@/components/ui/trading-desk";

export const Route = createFileRoute("/trade")({
  head: () => ({
    meta: [
      { title: "Trade — Stocks360" },
      {
        name: "description",
        content: "Trade global equities and crypto spot from one unified account.",
      },
    ],
  }),
  component: TradePage,
});

/**
 * Equities and crypto spot, on one desk.
 *
 * Both live here because the venue treats them the same way — long-only spot, settled in the
 * instrument's own quote currency — and because `/markets` links every equity *and* every
 * crypto row to this route. Forex has its own page only because its panel set differs: a real
 * quoted spread instead of an order book.
 */
function TradePage() {
  return (
    <AppLayout>
      <section className="relative min-h-[calc(100vh-250px)] overflow-hidden border-b border-border">
        <div className="grid-bg absolute inset-0 opacity-40" />
        <TradingDesk assetClasses={["stocks", "crypto"]} tableTitle="Instruments" />
      </section>
    </AppLayout>
  );
}
