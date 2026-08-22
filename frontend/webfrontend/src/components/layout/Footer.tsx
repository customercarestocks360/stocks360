import { Link } from "@tanstack/react-router";

export function Footer({ supportEmail }: { supportEmail?: string | null }) {
  return (
    <footer className="mx-auto hidden max-w-7xl px-6 py-16 md:block">
      <div className="grid gap-10 md:grid-cols-5">
        <div className="md:col-span-1">
          <div className="flex items-center gap-2">
            <img src="/mianimg.png" alt="Stocks360" className="h-7 w-7 rounded-md object-cover" />
            <span className="text-[15px] font-bold tracking-tight">Stocks360</span>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            The obsidian observatory for stocks, forex and everything tradable.
          </p>
        </div>
        <div>
          <div className="label-mono">Markets</div>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            <li>
              <Link to="/markets" className="transition-colors hover:text-foreground">
                Market overview
              </Link>
            </li>
            <li>
              <Link to="/trade" className="transition-colors hover:text-foreground">
                Trading desk
              </Link>
            </li>
            <li>
              <Link
                to="/trade"
                search={{ class: "forex" }}
                className="transition-colors hover:text-foreground"
              >
                Forex
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="label-mono">Company</div>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            <li>
              <Link to="/about" className="transition-colors hover:text-foreground">
                About Stocks360
              </Link>
            </li>
            {supportEmail && (
              <li>
                <a
                  href={`mailto:${supportEmail}`}
                  className="transition-colors hover:text-foreground"
                >
                  Contact support
                </a>
              </li>
            )}
          </ul>
        </div>
        <div>
          <div className="label-mono">Policies</div>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            <li>
              <Link to="/about" hash="policies" className="transition-colors hover:text-foreground">
                Terms and privacy
              </Link>
            </li>
            <li>
              <Link to="/about" hash="risk" className="transition-colors hover:text-foreground">
                Risk disclosure
              </Link>
            </li>
            <li>
              <Link to="/about" hash="fees" className="transition-colors hover:text-foreground">
                Fees and funding
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="mt-12 flex flex-wrap justify-between gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
        <span>© 2026 Stocks 360. All rights reserved.</span>
        <span className="max-w-xl">
          Investments are subject to market risks. Past performance is not indicative of future
          returns.
        </span>
      </div>
    </footer>
  );
}
