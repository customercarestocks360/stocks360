import { Link } from "@tanstack/react-router";
import { useTheme } from "@/components/ThemeProvider";

export function Header() {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
        <Link to="/" className="flex items-center gap-2">
          <img src="/mianimg.png" alt="Stocks360" className="h-7 w-7 rounded-md object-cover" />
          <span className="text-[15px] font-bold tracking-tight">Stocks360</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {[
            { n: "Markets", t: "/markets" },
            { n: "Crypto", t: "/crypto" },
            { n: "Stocks", t: "/stocks" },
            { n: "Insights", t: "/insights" },
            { n: "Pricing", t: "/pricing" },
          ].map((l) => (
            <Link key={l.n} to={l.t} className="transition-colors hover:text-foreground [&.active]:text-foreground [&.active]:font-medium">
              {l.n}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground hover:border-foreground/20"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <i className="fa-solid fa-sun text-sm" />
            ) : (
              <i className="fa-solid fa-moon text-sm" />
            )}
          </button>
          <Link
            to="/login"
            className="hidden cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Log in
          </Link>
          <Link
            to="/signup"
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
