const ticker = [
  { s: "AAPL", p: "229.87", c: "+0.88%", up: true },
  { s: "TSLA", p: "248.53", c: "-1.94%", up: false },
  { s: "SPX", p: "5,631.20", c: "+0.33%", up: true },
  { s: "NVDA", p: "118.42", c: "+3.45%", up: true },
  { s: "MSFT", p: "415.32", c: "+1.21%", up: true },
  { s: "NIFTY 50", p: "24,890.05", c: "+0.42%", up: true },
  { s: "EUR/USD", p: "1.0892", c: "-0.18%", up: false },
  { s: "GOLD", p: "2,398.10", c: "+0.19%", up: true },
];

export function TickerBar({ bottom = false }: { bottom?: boolean }) {
  const row = [...ticker, ...ticker];
  return (
    <div
      className={`hidden overflow-hidden border-border bg-card/60 md:block ${bottom ? "border-t" : "border-b"}`}
    >
      <div className="marquee-track flex w-max">
        {row.map((t, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-r border-border px-6 py-2 font-mono text-xs"
          >
            <span className="text-muted-foreground">{t.s}</span>
            <span className="text-foreground">{t.p}</span>
            <span className={t.up ? "text-up" : "text-down"}>{t.c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
