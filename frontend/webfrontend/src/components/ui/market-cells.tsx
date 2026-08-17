/** Compact 52-week low/high track with a dot marking where the current price sits. */
export function RangeBar52W({ low, high, price }: { low: number; high: number; price: number }) {
  const span = high - low || 1;
  const pct = Math.max(0, Math.min(100, ((price - low) / span) * 100));
  return (
    <div className="flex w-24 items-center gap-1.5">
      <span className="shrink-0 text-[10px] text-muted-foreground">L</span>
      <div className="relative h-1 flex-1 rounded-full bg-muted">
        <span
          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-sm"
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground">H</span>
    </div>
  );
}

/** Signed percentage used for "1W avg vol diff" — large swings are common, so no decimals past 2. */
export function VolDiffBadge({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={`font-mono text-sm font-semibold ${up ? "text-up" : "text-down"}`}>
      {up ? "+" : ""}
      {pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%
    </span>
  );
}

/** "+107.10 (13.13%)" style change cell — amount and percent together, Groww-style. */
export function ChangeCell({ absStr, pct }: { absStr: string; pct: number }) {
  const up = pct >= 0;
  return (
    <span className={`font-mono text-sm font-semibold ${up ? "text-up" : "text-down"}`}>
      {absStr} ({up ? "+" : ""}
      {pct.toFixed(2)}%)
    </span>
  );
}
