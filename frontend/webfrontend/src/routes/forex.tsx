import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { TradingDesk } from "@/components/ui/trading-desk";

type ForexSearch = { symbol?: string };

export const Route = createFileRoute("/forex")({
  // `/markets`' "Trade" button deep-links here with `?symbol=`, so the desk opens already on
  // the pair the user clicked rather than whatever streams in first.
  validateSearch: (search: Record<string, unknown>): ForexSearch => {
    const symbol = typeof search["symbol"] === "string" ? search["symbol"] : undefined;
    return symbol ? { symbol } : {};
  },
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
  const { symbol } = Route.useSearch();
  return (
    <AppLayout>
      <section className="relative overflow-hidden">
        <TradingDesk assetClasses={["forex"]} tableTitle="Currency pairs" initialSymbol={symbol} />
      </section>
    </AppLayout>
  );
}
