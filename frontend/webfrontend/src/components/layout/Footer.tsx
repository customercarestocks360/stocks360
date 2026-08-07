export function Footer() {
  return (
    <footer className="mx-auto max-w-7xl px-6 py-16">
      <div className="grid gap-10 md:grid-cols-5">
        <div className="md:col-span-1">
          <div className="flex items-center gap-2">
            <img src="/mianimg.png" alt="Stocks360" className="h-7 w-7 rounded-md object-cover" />
            <span className="text-[15px] font-bold tracking-tight">Stocks360</span>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            The obsidian observatory for crypto, equities and everything tradable.
          </p>
        </div>
        {[
          { h: "Markets", l: ["Crypto", "Stocks", "ETFs", "Commodities", "Futures"] },
          { h: "Products", l: ["Spot", "Margin", "Options", "Earn", "Indices"] },
          { h: "Company", l: ["About", "Careers", "Press", "Blog", "Status"] },
          { h: "Legal", l: ["Terms", "Privacy", "Risk disclosure", "Fees", "Compliance"] },
        ].map((col) => (
          <div key={col.h}>
            <div className="label-mono">{col.h}</div>
            <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
              {col.l.map((i) => (
                <li key={i} className="cursor-pointer transition-colors hover:text-foreground">
                  {i}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-12 flex flex-wrap justify-between gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
        <span>© 2026 Axiom Exchange. All rights reserved.</span>
        <span className="max-w-xl">
          Investments are subject to market risks. Past performance is not indicative of future
          returns.
        </span>
      </div>
    </footer>
  );
}
