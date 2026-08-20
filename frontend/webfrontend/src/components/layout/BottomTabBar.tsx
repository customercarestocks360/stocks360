import { Link, useLocation } from "@tanstack/react-router";

// Five tabs, not six: FX is a class on the /trade desk rather than its own destination, and
// five is also the most a phone fits before the labels start truncating.
const TABS = [
  { n: "Home", t: "/", icon: "fa-house" },
  { n: "Markets", t: "/markets", icon: "fa-chart-line" },
  { n: "Trade", t: "/trade", icon: "fa-arrow-right-arrow-left" },
  { n: "Wallet", t: "/wallet", icon: "fa-wallet" },
  { n: "Account", t: "/account", icon: "fa-user" },
] as const;

/**
 * Native-style bottom tab bar for primary navigation on mobile viewports.
 * Hidden on md+ where the top nav takes over — this is the "app nav" pattern
 * (vs. a hamburger dropdown, which reads as a website pattern).
 */
export function BottomTabBar() {
  const location = useLocation();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-safe backdrop-blur md:hidden"
      aria-label="Primary"
    >
      <div className="flex h-14 items-stretch justify-between px-1">
        {TABS.map((tab) => {
          const active =
            location.pathname === tab.t || location.pathname.startsWith(tab.t + "/");
          return (
            <Link
              key={tab.n}
              to={tab.t}
              className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-md text-[10px] sm:text-[11px] transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <i className={`fa-solid ${tab.icon} text-[15px] sm:text-[17px]`} />
              <span className="font-medium truncate max-w-full px-0.5">{tab.n}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
