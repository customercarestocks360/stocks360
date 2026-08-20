/**
 * The instrument ribbon — the strip directly under the desk toolbar.
 *
 * This is the *only* place the desk prints the selected instrument's price. The chart used to
 * print it again in its own header immediately below, so the same number appeared twice, two
 * font sizes apart. The chart now carries only its crosshair OHLC readout, which is a
 * different fact (the bar under the cursor), and this ribbon owns the quote.
 *
 * Every cell is a real published field. Where a feed publishes nothing — equities have no
 * book, FX has no volume — the cell is dropped rather than dashed, so the ribbon stays dense
 * and never implies a number is missing when it simply does not exist for that market.
 */
import { useEffect, useRef, useState } from "react";
import { decimalsFor, formatCompact, formatPrice, type TradeInstrument } from "@/lib/instrument";

/** How long the tick flash lingers. Long enough to catch, short enough not to strobe. */
const FLASH_MS = 420;

function Cell({
  label,
  value,
  tone = "default",
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "up" | "down" | "muted";
  mono?: boolean;
}) {
  const toneClass =
    tone === "up"
      ? "text-up"
      : tone === "down"
        ? "text-down"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="flex min-w-0 shrink-0 flex-col justify-center px-3 py-1.5 sm:px-4">
      <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
        {label}
      </span>
      <span className={`truncate text-xs font-semibold ${mono ? "font-mono" : ""} ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}

/** Where the last price sits between the session low and high, as a track with a marker. */
function DayRange({
  low,
  high,
  price,
  decimals,
}: {
  low: number | null;
  high: number | null;
  price: number | null;
  decimals: number;
}) {
  if (low === null || high === null || price === null || high <= low)
    return <span className="font-mono text-xs text-muted-foreground">Not published</span>;
  const pct = Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] text-muted-foreground">
        {formatPrice(low, decimals)}
      </span>
      <div className="relative h-1 w-16 rounded-full bg-muted">
        <span
          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border-2 border-surface bg-primary"
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">
        {formatPrice(high, decimals)}
      </span>
    </div>
  );
}

/**
 * The price cell: large, tabular, and flashed green/red on change.
 *
 * The flash direction comes from comparing against the previous rendered price rather than the
 * feed's own change field, because that field is measured against the session open — a price
 * ticking down inside an up day should still flash red.
 */
function PriceCell({ price, decimals }: { price: number | null; decimals: number }) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    if (price === null) return;
    const before = prev.current;
    prev.current = price;
    if (before === null || before === price) return;
    setFlash(price > before ? "up" : "down");
    const t = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(t);
  }, [price]);

  return (
    <div
      className={`flex shrink-0 flex-col justify-center px-3 py-1.5 transition-colors duration-200 sm:px-4 ${
        flash === "up" ? "bg-up/10" : flash === "down" ? "bg-down/10" : ""
      }`}
    >
      <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
        Last
      </span>
      <span
        className={`font-mono text-lg font-bold leading-tight tabular-nums transition-colors duration-200 sm:text-xl ${
          flash === "up" ? "text-up" : flash === "down" ? "text-down" : "text-foreground"
        }`}
      >
        {formatPrice(price, decimals)}
      </span>
    </div>
  );
}

export function InstrumentRibbon({
  instrument,
  onBuy,
  onSell,
}: {
  instrument: TradeInstrument;
  onBuy: () => void;
  onSell: () => void;
}) {
  const i = instrument;
  const decimals = decimalsFor(i.price);
  const up = (i.changePercent ?? 0) >= 0;

  return (
    <div className="flex shrink-0 items-stretch gap-px overflow-x-auto border-b border-overlay-border bg-surface no-scrollbar">
      {/* Identity — the anchor, so it never scrolls out of reach on a narrow viewport. */}
      <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2.5 border-r border-overlay-border bg-surface px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-bold tracking-tight text-foreground">
              {i.label}
            </span>
            {i.currency && (
              <span className="shrink-0 rounded border border-overlay-border px-1 py-px font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {i.currency}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {i.stale ? (
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {i.marketState === "closed" ? "Market closed" : "Stale quote"}
              </span>
            ) : (
              <>
                <span className="h-1 w-1 animate-pulse rounded-full bg-up" />
                <span className="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {i.name !== i.label ? i.name : "Live"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <PriceCell price={i.price} decimals={decimals} />

      <Cell
        label="Change"
        tone={i.changePercent === null ? "muted" : up ? "up" : "down"}
        value={
          i.changePercent === null ? (
            "—"
          ) : (
            <>
              {up ? "+" : ""}
              {formatPrice(i.change, decimals)}
              <span className="ml-1.5 opacity-80">
                ({up ? "+" : ""}
                {i.changePercent.toFixed(2)}%)
              </span>
            </>
          )
        }
      />

      {/* Top of book, where the feed publishes one. Equities never do. */}
      {i.bid !== null && <Cell label="Bid" tone="up" value={formatPrice(i.bid, decimals)} />}
      {i.ask !== null && <Cell label="Ask" tone="down" value={formatPrice(i.ask, decimals)} />}
      {i.spreadPips !== null && (
        <Cell label="Spread" tone="muted" value={`${i.spreadPips} pips`} />
      )}

      {i.dayHigh !== null && <Cell label="High" value={formatPrice(i.dayHigh, decimals)} />}
      {i.dayLow !== null && <Cell label="Low" value={formatPrice(i.dayLow, decimals)} />}
      {i.previousClose !== null && (
        <Cell label="Prev close" tone="muted" value={formatPrice(i.previousClose, decimals)} />
      )}
      {i.volume !== null && (
        <Cell
          label={i.volumeUnit ? `Vol ${i.volumeUnit}` : "Volume"}
          tone="muted"
          value={formatCompact(i.volume)}
        />
      )}

      {/* Where the session sits inside the day's range — the one cell every feed can fill. */}
      <div className="hidden min-w-0 shrink-0 flex-col justify-center px-3 py-1.5 sm:flex sm:px-4">
        <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
          Day range
        </span>
        <DayRange low={i.dayLow} high={i.dayHigh} price={i.price} decimals={decimals} />
      </div>

      <Cell
        label="Session"
        tone="muted"
        mono={false}
        value={
          <span className="capitalize">
            {i.marketState ? i.marketState.replace("_", " ") : "Unknown"}
          </span>
        }
      />

      {/*
        Buy/sell sit just past the last stat rather than pinned to the far edge: a signed-out
        visitor has most cells dropped for want of a token, and `ml-auto` then stranded the
        actions across a third of the screen of nothing.
      */}
      <div className="flex shrink-0 items-center gap-1.5 border-l border-overlay-border px-3 py-2">
        <button
          type="button"
          onClick={onBuy}
          className="rounded bg-up/15 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-up transition-colors hover:bg-up/25"
        >
          Buy
        </button>
        <button
          type="button"
          onClick={onSell}
          className="rounded bg-down/15 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-down transition-colors hover:bg-down/25"
        >
          Sell
        </button>
      </div>
    </div>
  );
}
