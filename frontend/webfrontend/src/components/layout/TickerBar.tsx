import { useMarketOverview } from "@/hooks/useMarketOverview";

export function TickerBar({ bottom = false }: { bottom?: boolean }) {
  const { ticks, connected } = useMarketOverview();
  // Duplicated so the CSS marquee can loop seamlessly without a visible seam.
  const row = ticks.length > 0 ? [...ticks, ...ticks] : [];

  return (
    <div
      className={`hidden overflow-hidden border-border bg-card/60 md:block ${bottom ? "border-t" : "border-b"}`}
    >
      <div className="marquee-track flex w-max">
        {row.length === 0 ? (
          <div className="px-6 py-2 font-mono text-xs text-muted-foreground">
            {connected ? "Loading live prices…" : "Connecting to live prices…"}
          </div>
        ) : (
          row.map((t, i) => (
            <div
              key={`${t.market}:${t.symbol}:${i}`}
              className={`flex items-center gap-3 border-r border-border px-6 py-2 font-mono text-xs ${
                t.stale ? "opacity-50" : ""
              }`}
            >
              <span className="text-muted-foreground">{t.label}</span>
              <span className="text-foreground">{t.price}</span>
              {t.changePercent !== null && (
                <span className={t.changePercent >= 0 ? "text-up" : "text-down"}>
                  {t.changePercent >= 0 ? "+" : ""}
                  {t.changePercent.toFixed(2)}%
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
