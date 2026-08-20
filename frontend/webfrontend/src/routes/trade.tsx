import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { TradingDesk } from "@/components/ui/trading-desk";

type TradeSearch = { symbol?: string; class?: "stocks" | "crypto" | "forex" };

const CLASSES = ["stocks", "crypto", "forex"] as const;

export const Route = createFileRoute("/trade")({
  // `/markets`' "Trade" button deep-links here with `?symbol=&class=`, so the desk opens
  // already on the instrument the user clicked rather than whatever streams in first.
  validateSearch: (search: Record<string, unknown>): TradeSearch => {
    const symbol = typeof search["symbol"] === "string" ? search["symbol"] : undefined;
    const raw = search["class"];
    const cls = CLASSES.find((c) => c === raw);
    return { ...(symbol ? { symbol } : {}), ...(cls ? { class: cls } : {}) };
  },
  head: () => ({
    meta: [
      { title: "Trade — Stocks360" },
      {
        name: "description",
        content: "Trade global equities, crypto spot and forex from one unified account.",
      },
    ],
  }),
  component: TradePage,
});

/**
 * The one desk: equities, crypto spot and forex.
 *
 * FX used to have its own route. It did not need one — the desk is parameterised by asset
 * class, and the only thing FX does differently is show a quoted spread where crypto shows a
 * book, which is a panel-level difference the desk already handles per instrument. A separate
 * page meant two URLs, two nav entries and a second copy of every layout fix. `/forex` now
 * redirects here with `?class=forex`.
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
          assetClasses={CLASSES}
          tableTitle="Instruments"
          initialAssetClass={assetClass}
          initialSymbol={symbol}
        />
      </section>
    </AppLayout>
  );
}
