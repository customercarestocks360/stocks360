import { useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";

// No Forex entry: FX is a class on the one desk at /trade, not a separate destination.
const NAV_LINKS = [
  { n: "Markets", t: "/markets" },
  { n: "Trade", t: "/trade" },
  { n: "Wallet", t: "/wallet" },
  { n: "About Us", t: "/about" },
];

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { isLoggedIn, email, kycCompleted, balances, logout } = useAuth();
  const navigate = useNavigate();
  const initial = email ? email.trim()[0]?.toUpperCase() : "U";
  const profilePercent = kycCompleted ? 100 : 30;
  const closeProfileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openProfileMenu = () => {
    if (closeProfileTimer.current) {
      clearTimeout(closeProfileTimer.current);
      closeProfileTimer.current = null;
    }
    setProfileOpen(true);
  };
  const scheduleCloseProfileMenu = () => {
    closeProfileTimer.current = setTimeout(() => setProfileOpen(false), 300);
  };

  // Async now that signing out revokes refresh tokens server-side. Navigating only once
  // that has resolved keeps a stale token from riding along into the next page's requests.
  const handleLogout = async () => {
    setProfileOpen(false);
    await logout();
    await navigate({ to: "/" });
  };

  const handleGetStarted = () => {
    if (!isLoggedIn) {
      navigate({ to: "/signup" });
      return;
    }
    if (!kycCompleted) {
      navigate({ to: "/kyc" });
      return;
    }
    navigate({ to: "/markets" });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 pt-safe backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 sm:gap-8 px-3 sm:px-6 md:h-20">
        <Link to="/" className="flex shrink-0 items-center gap-2 pointer-events-none md:pointer-events-auto" onClick={() => setMenuOpen(false)}>
          <img src="/mianimg.png" alt="Stocks360" className="h-9 w-9 shrink-0 rounded-md object-cover" />
          <span className="whitespace-nowrap text-[18px] font-bold tracking-tight">Stocks360</span>
        </Link>
        <nav className="hidden items-center gap-6 text-base text-muted-foreground md:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.n} to={l.t} className="transition-colors hover:text-foreground [&.active]:text-foreground [&.active]:font-medium">
              {l.n}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={toggleTheme}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground hover:border-foreground/20 sm:h-10 sm:w-10"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <i className="fa-solid fa-sun text-sm" />
            ) : (
              <i className="fa-solid fa-moon text-sm" />
            )}
          </button>
          {isLoggedIn ? (
            <div
              className="relative hidden md:block"
              onMouseEnter={openProfileMenu}
              onMouseLeave={scheduleCloseProfileMenu}
            >
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex h-11 w-11 items-center justify-center rounded-full sm:h-10 sm:w-10"
                style={{
                  background: kycCompleted
                    ? "var(--primary)"
                    : `conic-gradient(var(--primary) ${profilePercent * 3.6}deg, var(--border) 0deg)`,
                }}
                aria-label="Go to account dashboard"
                aria-expanded={profileOpen}
              >
                <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-background text-sm font-bold text-foreground">
                  {initial}
                </span>
              </button>
              {profileOpen && (
                <>
                  {/* Backdrop — mobile only, closes the sheet on tap outside. */}
                  <div
                    className="fixed inset-0 z-40 bg-black/40 md:hidden"
                    onClick={() => setProfileOpen(false)}
                  />
                  <div className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border border-border bg-card p-1.5 pb-safe shadow-lg md:absolute md:inset-x-auto md:right-0 md:top-11 md:bottom-auto md:z-10 md:w-56 md:max-h-none md:rounded-md">
                    <div className="border-b border-border px-2.5 py-2">
                      <div className="mb-1 h-1 w-10 rounded-full bg-border mx-auto md:hidden" />
                      <div className="truncate text-xs text-muted-foreground">{email}</div>
                      <div className="mt-1.5 flex items-center font-mono text-xs text-foreground">
                        <span>{balances.USDT.toLocaleString()} USDT</span>
                      </div>
                      {!kycCompleted && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${profilePercent}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {profilePercent}%
                          </span>
                        </div>
                      )}
                    </div>

                  <div className="mt-1">
                    <Link
                      to="/account"
                      search={{ tab: "dashboard" }}
                      onClick={() => setProfileOpen(false)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <i className="fa-solid fa-house w-4" />
                      Dashboard
                    </Link>
                    <Link
                      to="/wallet"
                      onClick={() => setProfileOpen(false)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <i className="fa-solid fa-wallet w-4" />
                      Wallet
                    </Link>
                    <Link
                      to="/account"
                      search={{ tab: "assets" }}
                      onClick={() => setProfileOpen(false)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <i className="fa-solid fa-layer-group w-4" />
                      Assets
                    </Link>
                    <Link
                      to="/account"
                      search={{ tab: "orders" }}
                      onClick={() => setProfileOpen(false)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <i className="fa-solid fa-receipt w-4" />
                      Orders
                    </Link>
                    <Link
                      to="/account"
                      search={{ tab: "account" }}
                      onClick={() => setProfileOpen(false)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <i className="fa-solid fa-user w-4" />
                      Account
                    </Link>
                    {!kycCompleted && (
                      <Link
                        to="/account"
                        search={{ tab: "account" }}
                        onClick={() => setProfileOpen(false)}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <i className="fa-solid fa-id-card w-4 text-primary" />
                        Complete your account details
                      </Link>
                    )}
                  </div>
                  <button
                    onClick={() => void handleLogout()}
                    className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2.5 py-2 pt-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <i className="fa-solid fa-arrow-right-from-bracket w-4" />
                    Log out
                  </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden cursor-pointer text-base text-muted-foreground transition-colors hover:text-foreground sm:block"
              >
                Log in
              </Link>
              <button
                type="button"
                onClick={handleGetStarted}
                className="cursor-pointer whitespace-nowrap rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 sm:px-5 sm:py-2.5 sm:text-base"
              >
                Get started
              </button>
            </>
          )}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="hidden h-10 w-10 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground hover:border-foreground/20"
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
          {!isLoggedIn && (
            <Link
              to="/login"
              onClick={() => setMenuOpen(false)}
              className="mt-2 rounded-md border-t border-border px-3 pt-4 pb-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
