const ticker = [
  { s: "AAPL", p: "229.87", c: "+0.88%", up: true },
  { s: "TSLA", p: "248.53", c: "-1.94%", up: false },
  { s: "SPX", p: "5,631.20", c: "+0.33%", up: true },
  { s: "BTC/USD", p: "68,412.20", c: "+2.41%", up: true },
  { s: "ETH/USD", p: "3,584.66", c: "+1.08%", up: true },
  { s: "NIFTY 50", p: "24,890.05", c: "+0.42%", up: true },
  { s: "XRP", p: "0.6231", c: "-2.41%", up: false },
  { s: "GOLD", p: "2,398.10", c: "+0.19%", up: true },
];

export function TickerBar({ bottom = false }: { bottom?: boolean }) {
  const row = [...ticker, ...ticker];
  return (
    <div
      className={`overflow-hidden border-border bg-card/60 ${bottom ? "border-t" : "border-b"}`}
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
