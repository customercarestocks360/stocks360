import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { TradingDesk } from "@/components/ui/trading-desk";

type TradeSearch = { symbol?: string; class?: "stocks" | "crypto" };

export const Route = createFileRoute("/trade")({
  // `/markets`' "Trade" button deep-links here with `?symbol=&class=`, so the desk opens
  // already on the instrument the user clicked rather than whatever streams in first.
  validateSearch: (search: Record<string, unknown>): TradeSearch => {
    const symbol = typeof search["symbol"] === "string" ? search["symbol"] : undefined;
    const cls = search["class"] === "stocks" || search["class"] === "crypto"
      ? search["class"]
      : undefined;
    return { ...(symbol ? { symbol } : {}), ...(cls ? { class: cls } : {}) };
  },
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
  const { symbol, class: assetClass } = Route.useSearch();
  return (
    <AppLayout>
      {/* No decorative grid and no min-height here: the desk is a fixed-height terminal shell
          that sizes itself to the viewport, and a background layer only showed through the
          gaps the old layout left. */}
      <section className="relative overflow-hidden border-b border-border">
        <TradingDesk
          assetClasses={["stocks", "crypto"]}
          tableTitle="Instruments"
          initialAssetClass={assetClass}
          initialSymbol={symbol}
        />
      </section>
    </AppLayout>
  );
}
