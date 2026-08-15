import { useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";
import { DepositPanel } from "@/components/ui/deposit-drawer";

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [verifyAlert, setVerifyAlert] = useState<"login" | "kyc" | null>(null);
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

  const handleLogout = () => {
    setProfileOpen(false);
    logout();
    navigate({ to: "/" });
  };

  const handleDepositClick = () => {
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) {
      navigate({ to: "/deposit" });
      return;
    }
    if (!isLoggedIn) {
      setVerifyAlert("login");
    } else if (!kycCompleted) {
      setVerifyAlert("kyc");
    } else {
      setDepositOpen(true);
    }
  };

  const closeDepositUi = () => {
    setDepositOpen(false);
    setVerifyAlert(null);
  };

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
          <div className="relative">
            <button
              onClick={handleDepositClick}
              className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
            >
              <i className="fa-solid fa-wallet text-xs" />
              <span className="hidden sm:inline">Deposit</span>
            </button>

            {(depositOpen || verifyAlert) && (
              <>
                <div className="fixed inset-0 z-40" onClick={closeDepositUi} />
                <div className="absolute right-0 top-11 z-50 w-[26rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card p-6 shadow-2xl">
                  {verifyAlert ? (
                    <VerificationAlert
                      reason={verifyAlert}
                      onClose={closeDepositUi}
                      onAction={() => {
                        setVerifyAlert(null);
                        if (verifyAlert === "login") {
                          navigate({ to: "/login" });
                        } else {
                          navigate({ to: "/account", search: { tab: "account" } });
                        }
                      }}
                    />
                  ) : (
                    <DepositPanel onClose={closeDepositUi} />
                  )}
                </div>
              </>
            )}
          </div>
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
          {isLoggedIn ? (
            <div
              className="relative"
              onMouseEnter={openProfileMenu}
              onMouseLeave={scheduleCloseProfileMenu}
            >
              <button
                onClick={() => {
                  setProfileOpen(false);
                  navigate({ to: "/account" });
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full"
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
                <div className="absolute right-0 top-11 w-56 rounded-md border border-border bg-card p-1.5 shadow-lg">
                  <div className="border-b border-border px-2.5 py-2">
                    <div className="truncate text-xs text-muted-foreground">{email}</div>
                    <div className="mt-1.5 flex items-center gap-3 font-mono text-xs text-foreground">
                      <span>₹{balances.INR.toLocaleString()}</span>
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
                      to="/account"
                      search={{ tab: "assets" }}
                      onClick={() => setProfileOpen(false)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <i className="fa-solid fa-wallet w-4" />
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
                    onClick={handleLogout}
                    className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2.5 py-2 pt-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <i className="fa-solid fa-arrow-right-from-bracket w-4" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
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
            </>
          )}
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

function VerificationAlert({
  reason,
  onClose,
  onAction,
}: {
  reason: "login" | "kyc";
  onClose: () => void;
  onAction: () => void;
}) {
  const copy =
    reason === "login"
      ? {
          icon: "fa-lock",
          title: "Sign in required",
          body: "You need to be signed in to deposit funds into your Stocks360 account.",
          action: "Go to sign in",
        }
      : {
          icon: "fa-id-card",
          title: "Complete your account details",
          body: "Your identity hasn't been verified yet. Complete your remaining account details to unlock deposits.",
          action: "Complete account details",
        };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute -right-1 -top-1 text-muted-foreground hover:text-foreground"
      >
        <i className="fa-solid fa-xmark" />
      </button>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <i className={`fa-solid ${copy.icon} text-lg`} />
      </div>
      <h3 className="mt-4 text-center text-lg font-bold text-foreground">{copy.title}</h3>
      <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">{copy.body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-6 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
      >
        {copy.action}
      </button>
    </div>
  );
}
