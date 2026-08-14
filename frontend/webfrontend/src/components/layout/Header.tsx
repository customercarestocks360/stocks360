import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTheme } from "@/components/ThemeProvider";

const NAV_LINKS = [
  { n: "Markets", t: "/markets" },
  { n: "Crypto", t: "/crypto" },
  { n: "Stocks", t: "/stocks" },
  { n: "Forex", t: "/forex" },
  { n: "About Us", t: "/about" },
];

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
        <Link to="/" className="flex items-center gap-2" onClick={() => setMenuOpen(false)}>
          <img src="/mianimg.png" alt="Stocks360" className="h-7 w-7 rounded-md object-cover" />
          <span className="text-[15px] font-bold tracking-tight">Stocks360</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {NAV_LINKS.map((l) => (
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
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground hover:border-foreground/20 md:hidden"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
          >
            <i className={`fa-solid ${menuOpen ? "fa-xmark" : "fa-bars"} text-sm`} />
          </button>
        </div>
      </div>

      {/* Mobile nav panel — nav links + Log in, hidden on md+ where the inline nav takes over */}
      <div
        id="mobile-nav"
        className={`overflow-hidden border-border bg-background/95 backdrop-blur transition-[max-height] duration-300 ease-in-out md:hidden ${
          menuOpen ? "max-h-80 border-t" : "max-h-0 border-t-0"
        }`}
      >
        <nav className="flex flex-col gap-1 px-6 py-4">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.n}
              to={l.t}
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground [&.active]:bg-secondary [&.active]:text-foreground [&.active]:font-medium"
            >
              {l.n}
            </Link>
          ))}
          <Link
            to="/login"
            onClick={() => setMenuOpen(false)}
            className="mt-2 rounded-md border-t border-border px-3 pt-4 pb-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Log in
          </Link>
        </nav>
      </div>
    </header>
  );
}
