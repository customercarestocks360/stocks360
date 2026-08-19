import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { TradingDesk } from "@/components/ui/trading-desk";

export const Route = createFileRoute("/forex")({
  head: () => ({
    meta: [
      { title: "Forex Trading — Stocks360" },
      {
        name: "description",
        content: "Trade major, minor and exotic currency pairs on live interbank rates.",
      },
    ],
  }),
  component: ForexPage,
});

/**
 * The FX desk. Same machinery as `/trade`, pinned to one asset class — the panel beside the
 * chart shows the provider's real bid/ask/spread rather than a book, because FX is traded
 * over the counter and no central depth exists to display.
 */
function ForexPage() {
  return (
    <AppLayout>
      <section className="relative overflow-hidden">
        <TradingDesk assetClasses={["forex"]} tableTitle="Currency pairs" />
      </section>
    </AppLayout>
  );
}
