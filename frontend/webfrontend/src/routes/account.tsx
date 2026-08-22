import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/components/AuthProvider";
import { useFavorites } from "@/components/FavoritesProvider";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { KycDetails } from "@/components/ui/kyc-recap";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import { useTrading } from "@/hooks/useTrading";
import { useFundingRequests } from "@/hooks/useFundingRequests";
import { useMarketTable, type MarketRow } from "@/hooks/useMarketTable";
import type { OverviewMarket } from "@/lib/market-overview";
import { formatMoney } from "@/lib/instrument";
import { amount as parseAmount, type LedgerKind, type Order } from "@/lib/trading-api";
import type { FundingRequest } from "@/lib/funding-api";
import { fetchOnboardingSession, type OnboardingSession } from "@/lib/onboarding-api";

const SIDEBAR_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "fa-house" },
  { key: "assets", label: "Assets", icon: "fa-wallet" },
  { key: "orders", label: "Orders", icon: "fa-receipt" },
  { key: "account", label: "Account", icon: "fa-user" },
] as const;

type SidebarKey = (typeof SIDEBAR_ITEMS)[number]["key"];

type AccountSearch = { tab?: SidebarKey };

export const Route = createFileRoute("/account")({
  validateSearch: (search: Record<string, unknown>): AccountSearch => {
    const tab = SIDEBAR_ITEMS.some((i) => i.key === search["tab"])
      ? (search["tab"] as SidebarKey)
      : undefined;
    return tab ? { tab } : {};
  },
  head: () => ({
    meta: [
      { title: "Account — Stocks360" },
      { name: "description", content: "Your Stocks360 account dashboard." },
    ],
  }),
  component: AccountPage,
});

/**
 * Only the tabs that have a real source.
 *
 * "Hot", "New Listing" and "24h Volume" are gone along with the hardcoded table they were cut
 * from. The first two were three tickers picked by hand — nothing here ranks listings by heat or
 * by age — and ranking by volume would sort a share count against a traded value in USDT, two
 * different units in one column. Gainers and losers survive because a percentage is comparable
 * across all three markets.
 */
const MARKET_TABS = ["Holding", "Favorite", "Top Gainers", "Top Losers"] as const;
type MarketTab = (typeof MARKET_TABS)[number];

const TIME_FILTERS = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;
type TimeFilterValue = (typeof TIME_FILTERS)[number]["value"];

function filterFunding(list: FundingRequest[], query: string, time: TimeFilterValue) {
  const cutoffDays = time === "7d" ? 7 : time === "30d" ? 30 : time === "90d" ? 90 : null;
  const now = Date.now();
  return list.filter((t) => {
    if (cutoffDays !== null) {
      const ageDays = (now - new Date(t.created_at).getTime()) / (24 * 3600 * 1000);
      if (ageDays > cutoffDays) return false;
    }
    if (query) {
      const q = query.toLowerCase();
      const haystack =
        `${t.kind} ${t.currency} ${t.network} ${t.status} ${t.amount} ${t.reference ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function filterOrders(list: Order[], query: string, time: TimeFilterValue) {
  const cutoffDays = time === "7d" ? 7 : time === "30d" ? 30 : time === "90d" ? 90 : null;
  const now = Date.now();
  return list.filter((o) => {
    if (cutoffDays !== null) {
      const ageDays = (now - new Date(o.created_at).getTime()) / (24 * 3600 * 1000);
      if (ageDays > cutoffDays) return false;
    }
    if (query) {
      const q = query.toLowerCase();
      const haystack = `${o.symbol} ${o.asset_class} ${o.side} ${o.type} ${o.status}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function FilterBar({
  query,
  onQuery,
  time,
  onTime,
  onReset,
}: {
  query: string;
  onQuery: (v: string) => void;
  time: TimeFilterValue;
  onTime: (v: TimeFilterValue) => void;
  onReset: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select
        value={time}
        onChange={(e) => onTime(e.target.value as TimeFilterValue)}
        className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
      >
        {TIME_FILTERS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search by method or amount..."
        className="min-w-0 flex-1 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
      />
      <button
        type="button"
        onClick={onReset}
        className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Reset
      </button>
    </div>
  );
}

/** Same colour language as `/markets`, the wallet and the desks — one palette per asset class. */
const CLASS_STYLES: Record<OverviewMarket, { icon: string; color: string }> = {
  crypto: { icon: "fa-coins", color: "#f59e0b" },
  forex: { icon: "fa-money-bill-transfer", color: "#3b82f6" },
  stocks: { icon: "fa-chart-line", color: "#10b981" },
};

function MarketIcon({ market, size = "h-8 w-8" }: { market: OverviewMarket; size?: string }) {
  const style = CLASS_STYLES[market];
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold`}
      style={{ backgroundColor: `${style.color}20`, color: style.color }}
    >
      <i className={`fa-solid ${style.icon} text-xs`} />
    </span>
  );
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-sm text-muted-foreground">—</span>;
  const up = value >= 0;
  return (
    <span className={`text-sm font-mono font-semibold ${up ? "text-up" : "text-down"}`}>
      {up ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

const LEDGER_LABELS: Record<LedgerKind, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  reserve: "Order margin held",
  release: "Order margin released",
  trade_debit: "Trade settlement",
  trade_credit: "Trade settlement",
  fee: "Trading fee",
  adjustment: "Administrative adjustment",
};

function SignedMoney({ value, currency }: { value: string; currency: string }) {
  const amount = parseAmount(value) ?? 0;
  return (
    <span
      className={`font-mono font-semibold ${amount > 0 ? "text-up" : amount < 0 ? "text-down" : "text-muted-foreground"}`}
    >
      {amount > 0 ? "+" : ""}
      {formatMoney(amount, currency)}
    </span>
  );
}

/**
 * Favorites are keyed "<market>:<symbol>", the scheme `/markets` already uses, so a star set on
 * one page is the same star on the other. They used to be keyed off this page own hardcoded
 * tickers ("stock:AAPL"), which could never line up with a real feed symbol like RELIANCE.NS.
 */
function favKeyFor(row: MarketRow) {
  return `${row.market}:${row.symbol}`;
}

/** One live row: the feed price and change, not a number typed into a table. */
function AssetRow({ row }: { row: MarketRow }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-1 py-3 last:border-b-0">
      <FavoriteStar id={favKeyFor(row)} />
      <MarketIcon market={row.market} />
      <div className="min-w-0">
        <div className="font-semibold text-foreground">{row.label}</div>
        <div className="truncate text-xs text-muted-foreground">{row.name}</div>
      </div>
      <div className="ml-auto text-right">
        <div className={`font-mono text-sm text-foreground ${row.stale ? "opacity-60" : ""}`}>
          {row.price ?? "Awaiting quote…"}
          {row.stale && (
            <i
              className="fa-solid fa-clock ml-1.5 text-[10px] text-muted-foreground"
              title="Market closed or no recent trade — last known price"
            />
          )}
        </div>
        <ChangeBadge value={row.changePercent} />
      </div>
      <Link
        to="/trade"
        search={{ symbol: row.symbol, class: row.market }}
        className="ml-4 shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
      >
        Trade
      </Link>
    </div>
  );
}

function AccountPage() {
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const { isLoggedIn, email, name, kycCompleted, onboardingStatus, logout, setName } = useAuth();
  const { isFavorite } = useFavorites();
  /* The real portfolio and the real price feed — the same two sources /wallet and /markets use. */
  const trading = useTrading();
  const funding = useFundingRequests();
  const { rows: marketFeed, connected: feedConnected } = useMarketTable();
  const [sidebar, setSidebar] = useState<SidebarKey>(tab ?? "dashboard");
  const [marketTab, setMarketTab] = useState<MarketTab>("Holding");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  const [ordersSubTab, setOrdersSubTab] = useState<"payments" | "assetsHistory">("payments");
  const [ordersQuery, setOrdersQuery] = useState("");
  const [ordersTime, setOrdersTime] = useState<TimeFilterValue>("all");
  const resetOrdersFilters = () => {
    setOrdersQuery("");
    setOrdersTime("all");
  };

  const [assetsSubTab, setAssetsSubTab] = useState<"overview" | "deposit" | "withdraw">("overview");
  const [assetsQuery, setAssetsQuery] = useState("");
  const [assetsTime, setAssetsTime] = useState<TimeFilterValue>("all");
  const resetAssetsFilters = () => {
    setAssetsQuery("");
    setAssetsTime("all");
  };

  const username = name ?? email?.split("@")[0] ?? "Guest";
  const initial = username.trim()[0]?.toUpperCase() ?? "U";

  const startEditingName = () => {
    setNameDraft(username);
    setNameError("");
    setEditingName(true);
  };
  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setNameSaving(true);
    setNameError("");
    try {
      await setName(trimmed);
      setEditingName(false);
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : "Could not save your name.");
    } finally {
      setNameSaving(false);
    }
  };

  /**
   * Backs the "Account details" recap below — fetched once per sign-in rather than gated
   * to the account tab, so switching tabs doesn't re-fetch it. Staying `null` on failure is
   * enough: the render below already treats "no session yet" and "not submitted" the same
   * way, falling back to the plain "Complete account details" link either way.
   */
  const [onboardingSession, setOnboardingSession] = useState<OnboardingSession | null>(null);

  useEffect(() => {
    if (!isLoggedIn) {
      setOnboardingSession(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await currentIdToken();
        const session = await fetchOnboardingSession(token);
        if (!cancelled) setOnboardingSession(session);
      } catch (err) {
        if (!cancelled) console.error("Could not load the onboarding session", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  /*
    The portfolio trend chart is gone.
    It was fourteen points of `Math.sin` scaled by the current balance — a green line that
    always sloped up, drawn under the heading "Est. Total Value" as if it were account history.
    Nothing here records a balance over time (the ledger is per movement, not per day), so the
    honest options were a real series or none, and this is none.
  */

  const favoriteRows = useMemo(
    () => marketFeed.filter((r) => isFavorite(favKeyFor(r))),
    [marketFeed, isFavorite],
  );

  /** Ranked on the live change percentage. A row the feed has not priced yet cannot be ranked. */
  const rankedByChange = useMemo(
    () =>
      marketFeed
        .filter((r) => r.changePercent !== null)
        .sort((a, b) => b.changePercent! - a.changePercent!),
    [marketFeed],
  );

  const filteredPayments = useMemo(
    () => filterFunding(funding.requests, ordersQuery, ordersTime),
    [funding.requests, ordersQuery, ordersTime],
  );
  const filteredTradeOrders = useMemo(
    () => filterOrders(trading.orders, ordersQuery, ordersTime),
    [trading.orders, ordersQuery, ordersTime],
  );
  const filteredAssetsTx = useMemo(
    () =>
      filterFunding(funding.requests, assetsQuery, assetsTime).filter(
        (request) => assetsSubTab === "overview" || request.kind === assetsSubTab,
      ),
    [funding.requests, assetsQuery, assetsTime, assetsSubTab],
  );

  const report = useMemo(() => {
    const deposited = trading.ledger
      .filter((entry) => entry.kind === "deposit")
      .reduce((sum, entry) => sum + (parseAmount(entry.amount) ?? 0), 0);
    const withdrawn = trading.ledger
      .filter((entry) => entry.kind === "withdrawal")
      .reduce((sum, entry) => sum + Math.abs(parseAmount(entry.amount) ?? 0), 0);
    const turnover = trading.trades.reduce(
      (sum, trade) => sum + Math.abs(parseAmount(trade.notional) ?? 0),
      0,
    );
    const fees = trading.trades.reduce(
      (sum, trade) => sum + Math.abs(parseAmount(trade.fee) ?? 0),
      0,
    );
    const realizedTrades = trading.trades.filter((trade) => trade.realized_pnl !== null);
    const winningTrades = realizedTrades.filter(
      (trade) => (parseAmount(trade.realized_pnl) ?? 0) > 0,
    );
    return {
      deposited,
      withdrawn,
      turnover,
      fees,
      winRate: realizedTrades.length ? (winningTrades.length / realizedTrades.length) * 100 : null,
    };
  }, [trading.ledger, trading.trades]);

  const marketRows: MarketRow[] = useMemo(() => {
    switch (marketTab) {
      case "Favorite":
        return favoriteRows;
      case "Top Gainers":
        return rankedByChange.slice(0, 5);
      case "Top Losers":
        return rankedByChange.slice(-5).reverse();
      default:
        return [];
    }
  }, [marketTab, favoriteRows, rankedByChange]);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Async now that signing out revokes refresh tokens server-side.
  const handleLogout = async () => {
    await logout();
    await navigate({ to: "/" });
  };

  if (!isLoggedIn) {
    return (
      <AppLayout>
        <section className="relative mx-auto max-w-lg px-6 py-24 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
            <i className="fa-solid fa-lock text-lg" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-foreground">Sign in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to view your Stocks360 account dashboard.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded sm:rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Go to sign in
          </Link>
        </section>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <section className="relative border-b border-border">
        <div className="grid-bg absolute inset-0 opacity-40" />

        <div className="relative mx-auto max-w-7xl px-6 py-10">
          <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
            {/* ── Mobile Sidebar Toggle ── */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4 lg:hidden">
              <span className="font-semibold text-foreground">
                {SIDEBAR_ITEMS.find((i) => i.key === sidebar)?.label ?? "Menu"}
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-muted-foreground transition-colors hover:text-foreground"
              >
                <i className={`fa-solid ${mobileMenuOpen ? "fa-xmark" : "fa-bars"}`} />
              </button>
            </div>

            {/* ── Sidebar ── */}
            <nav
              className={`${
                mobileMenuOpen ? "flex" : "hidden"
              } flex-col gap-1 lg:flex lg:flex-col lg:overflow-visible`}
            >
              {SIDEBAR_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setSidebar(item.key);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex shrink-0 items-center gap-3 rounded sm:rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                    sidebar === item.key
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  }`}
                >
                  <i className={`fa-solid ${item.icon} w-4`} />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              ))}
            </nav>

            {/* ── Main content ── */}
            <div className="min-w-0">
              {/* Profile header row — shown on every tab */}
              <div className="flex flex-wrap items-center gap-6 rounded sm:rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                    {initial}
                  </div>
                  <div>
                    {editingName ? (
                      <div>
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={nameDraft}
                            disabled={nameSaving}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveName();
                              if (e.key === "Escape") setEditingName(false);
                            }}
                            className="rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-lg font-bold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 disabled:opacity-60"
                          />
                          <button
                            type="button"
                            onClick={() => void saveName()}
                            disabled={nameSaving}
                            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60"
                            aria-label="Save name"
                          >
                            <i
                              className={`fa-solid ${nameSaving ? "fa-circle-notch fa-spin" : "fa-check"} text-xs`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingName(false)}
                            disabled={nameSaving}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
                            aria-label="Cancel"
                          >
                            <i className="fa-solid fa-xmark text-xs" />
                          </button>
                        </div>
                        {nameError && <p className="mt-1 text-xs text-destructive">{nameError}</p>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-bold text-foreground">{username}</div>
                        {sidebar === "account" && (
                          <button
                            type="button"
                            onClick={startEditingName}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          >
                            <i className="fa-solid fa-pen text-[10px]" />
                            Change name
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {sidebar === "dashboard" && (
                <div className="mt-6 space-y-6">
                  {/* Est. Total Value */}
                  <div className="rounded sm:rounded-2xl border border-border bg-card p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground">Cash balance</div>
                        {trading.balances.length === 0 ? (
                          <div className="mt-2 font-mono text-3xl font-bold text-foreground">
                            {trading.loading ? "Loading…" : "No cash held yet"}
                          </div>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
                            {trading.balances.map((b) => (
                              <div key={b.currency}>
                                <div className="font-mono text-3xl font-bold text-foreground">
                                  {formatMoney(parseAmount(b.total), b.currency)}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {formatMoney(parseAmount(b.available), b.currency)} available
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Per currency, with no grand total: adding INR to USDT needs an FX rate
                            this app has no licensed source for — the same rule /wallet and the
                            backend own portfolio endpoint follow. This card used to read a
                            single simulated USDT figure out of localStorage. */}
                        {trading.error && (
                          <p className="mt-2 text-xs text-destructive">{trading.error}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          to="/deposit"
                          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          Deposit
                        </Link>
                        <Link
                          to="/withdraw"
                          className="rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/70"
                        >
                          Withdraw
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* A compact account statement, sourced entirely from the trading ledger. */}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {(
                      [
                        ["Account equity", trading.portfolio?.equity, "fa-scale-balanced"],
                        ["Free margin", trading.portfolio?.free_margin, "fa-bolt"],
                        ["Margin used", trading.portfolio?.margin_used, "fa-lock"],
                        ["Unrealized P&L", trading.portfolio?.unrealized_pnl, "fa-chart-line"],
                        ["Realized P&L", trading.portfolio?.realized_pnl, "fa-circle-check"],
                        ["Trading volume", String(report.turnover), "fa-arrow-right-arrow-left"],
                        ["Fees paid", String(report.fees), "fa-receipt"],
                        [
                          "Closed-trade win rate",
                          report.winRate === null ? null : `${report.winRate.toFixed(1)}%`,
                          "fa-trophy",
                        ],
                      ] satisfies Array<[string, string | null | undefined, string]>
                    ).map(([label, raw, icon]) => {
                      const isPercent = typeof raw === "string" && raw.endsWith("%");
                      const numeric = isPercent ? null : parseAmount(raw);
                      const pnl = label.includes("P&L");
                      return (
                        <div key={label} className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{label}</span>
                            <i className={`fa-solid ${icon}`} />
                          </div>
                          <div
                            className={`mt-2 font-mono text-xl font-bold ${
                              pnl && numeric !== null
                                ? numeric >= 0
                                  ? "text-up"
                                  : "text-down"
                                : "text-foreground"
                            }`}
                          >
                            {raw === null || raw === undefined
                              ? "—"
                              : isPercent
                                ? raw
                                : formatMoney(
                                    numeric,
                                    trading.portfolio?.account_currency ?? "USDT",
                                  )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid gap-6 xl:grid-cols-2">
                    <div className="rounded sm:rounded-2xl border border-border bg-card p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <h2 className="font-bold text-foreground">Recent trades</h2>
                          <p className="text-xs text-muted-foreground">
                            Executed fills, fees, and booked P&amp;L
                          </p>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                          {trading.trades.length} fills
                        </span>
                      </div>
                      {trading.trades.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          No fills recorded yet.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[720px] text-xs">
                            <thead className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                              <tr>
                                <th className="py-2 font-medium">Time</th>
                                <th className="py-2 font-medium">Instrument</th>
                                <th className="py-2 font-medium">Side</th>
                                <th className="py-2 text-right font-medium">Qty</th>
                                <th className="py-2 text-right font-medium">Fill</th>
                                <th className="py-2 text-right font-medium">Value</th>
                                <th className="py-2 text-right font-medium">Fee</th>
                                <th className="py-2 text-right font-medium">Realized</th>
                              </tr>
                            </thead>
                            <tbody>
                              {trading.trades.slice(0, 10).map((trade) => (
                                <tr
                                  key={trade.id}
                                  className="border-b border-border/70 last:border-0"
                                >
                                  <td className="whitespace-nowrap py-2.5 text-muted-foreground">
                                    {new Date(trade.at).toLocaleString()}
                                  </td>
                                  <td className="py-2.5 font-semibold text-foreground">
                                    {trade.symbol}
                                    {trade.position_side && (
                                      <span className="ml-1.5 text-[9px] uppercase text-muted-foreground">
                                        {trade.position_side}
                                      </span>
                                    )}
                                  </td>
                                  <td
                                    className={`py-2.5 font-bold uppercase ${trade.side === "buy" ? "text-up" : "text-down"}`}
                                  >
                                    {trade.side}
                                  </td>
                                  <td className="py-2.5 text-right font-mono">{trade.quantity}</td>
                                  <td className="py-2.5 text-right font-mono">
                                    {formatMoney(parseAmount(trade.price), trade.currency)}
                                  </td>
                                  <td className="py-2.5 text-right font-mono">
                                    {formatMoney(
                                      parseAmount(trade.notional),
                                      trade.account_currency,
                                    )}
                                  </td>
                                  <td className="py-2.5 text-right font-mono text-down">
                                    {formatMoney(parseAmount(trade.fee), trade.account_currency)}
                                  </td>
                                  <td className="py-2.5 text-right">
                                    {trade.realized_pnl === null ? (
                                      <span className="text-muted-foreground">Open</span>
                                    ) : (
                                      <SignedMoney
                                        value={trade.realized_pnl}
                                        currency={trade.account_currency}
                                      />
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="rounded sm:rounded-2xl border border-border bg-card p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <h2 className="font-bold text-foreground">USDT activity</h2>
                          <p className="text-xs text-muted-foreground">
                            Every incoming, outgoing, held, and released amount
                          </p>
                        </div>
                        <div className="text-right font-mono text-[10px] text-muted-foreground">
                          <div className="text-up">In {formatMoney(report.deposited, "USDT")}</div>
                          <div className="text-down">
                            Out {formatMoney(report.withdrawn, "USDT")}
                          </div>
                        </div>
                      </div>
                      {trading.ledger.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          No balance movements recorded yet.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[650px] text-xs">
                            <thead className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                              <tr>
                                <th className="py-2 font-medium">Time</th>
                                <th className="py-2 font-medium">Activity</th>
                                <th className="py-2 text-right font-medium">Movement</th>
                                <th className="py-2 text-right font-medium">Available</th>
                                <th className="py-2 text-right font-medium">Reserved</th>
                              </tr>
                            </thead>
                            <tbody>
                              {trading.ledger.slice(0, 12).map((entry) => (
                                <tr
                                  key={entry.id}
                                  className="border-b border-border/70 last:border-0"
                                >
                                  <td className="whitespace-nowrap py-2.5 text-muted-foreground">
                                    {new Date(entry.at).toLocaleString()}
                                  </td>
                                  <td className="py-2.5">
                                    <div className="font-medium text-foreground">
                                      {LEDGER_LABELS[entry.kind]}
                                    </div>
                                    {entry.reference && (
                                      <div className="max-w-44 truncate text-[10px] text-muted-foreground">
                                        {entry.reference}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2.5 text-right">
                                    <SignedMoney value={entry.amount} currency={entry.currency} />
                                  </td>
                                  <td className="py-2.5 text-right font-mono">
                                    {formatMoney(
                                      parseAmount(entry.available_after),
                                      entry.currency,
                                    )}
                                  </td>
                                  <td className="py-2.5 text-right font-mono">
                                    {formatMoney(parseAmount(entry.reserved_after), entry.currency)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded sm:rounded-2xl border border-border bg-card p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h2 className="font-bold text-foreground">Order report</h2>
                        <p className="text-xs text-muted-foreground">
                          Open, filled, cancelled, expired, and rejected instructions
                        </p>
                      </div>
                      <Link
                        to="/history"
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        Full history
                      </Link>
                    </div>
                    {trading.orders.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No orders placed yet.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[850px] text-xs">
                          <thead className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                            <tr>
                              <th className="py-2 font-medium">Created</th>
                              <th className="py-2 font-medium">Market</th>
                              <th className="py-2 font-medium">Instrument</th>
                              <th className="py-2 font-medium">Instruction</th>
                              <th className="py-2 text-right font-medium">Quantity</th>
                              <th className="py-2 text-right font-medium">Average fill</th>
                              <th className="py-2 text-right font-medium">Filled value</th>
                              <th className="py-2 text-right font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trading.orders.slice(0, 12).map((order) => (
                              <tr
                                key={order.id}
                                className="border-b border-border/70 last:border-0"
                              >
                                <td className="whitespace-nowrap py-2.5 text-muted-foreground">
                                  {new Date(order.created_at).toLocaleString()}
                                </td>
                                <td className="py-2.5 capitalize text-muted-foreground">
                                  {order.asset_class}
                                </td>
                                <td className="py-2.5 font-semibold text-foreground">
                                  {order.symbol}
                                </td>
                                <td
                                  className={`py-2.5 font-bold uppercase ${order.side === "buy" ? "text-up" : "text-down"}`}
                                >
                                  {order.side} · {order.position_side ?? "one-way"} ·{" "}
                                  {order.type.replace("_", " ")}
                                </td>
                                <td className="py-2.5 text-right font-mono">
                                  {order.filled_quantity}/{order.quantity}
                                </td>
                                <td className="py-2.5 text-right font-mono">
                                  {order.average_price === null
                                    ? "—"
                                    : formatMoney(parseAmount(order.average_price), order.currency)}
                                </td>
                                <td className="py-2.5 text-right font-mono">
                                  {order.filled_notional === null
                                    ? "—"
                                    : formatMoney(
                                        parseAmount(order.filled_notional),
                                        order.account_currency,
                                      )}
                                </td>
                                <td className="py-2.5 text-right">
                                  <span
                                    className={`rounded-full px-2 py-1 font-semibold capitalize ${order.status === "filled" ? "bg-up/10 text-up" : order.status === "open" ? "bg-primary/10 text-primary" : order.status === "rejected" ? "bg-down/10 text-down" : "bg-secondary text-muted-foreground"}`}
                                  >
                                    {order.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Markets */}
                  <div className="rounded sm:rounded-2xl border border-border bg-card p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-baseline gap-2">
                        <h2 className="text-lg font-bold text-foreground">Markets</h2>
                        {/* These rows are the live overview feed. Saying so matters because the
                            panel used to render a hardcoded table that could never be stale. */}
                        {!feedConnected && (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
                            reconnecting…
                          </span>
                        )}
                      </div>
                      <Link
                        to="/markets"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        More <i className="fa-solid fa-chevron-right text-[10px]" />
                      </Link>
                    </div>
                    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
                      {MARKET_TABS.map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setMarketTab(tab)}
                          className={`border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors ${
                            marketTab === tab
                              ? "border-primary text-foreground"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>

                    {marketTab === "Holding" ? (
                      trading.positions.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          {trading.loading
                            ? "Loading your holdings…"
                            : "You hold no positions yet."}
                        </p>
                      ) : (
                        <div>
                          {/* Marked to market by the backend: the value and P&L move with the
                              feed, so this is the live worth of the position, not its cost. */}
                          {trading.positions.map((pos) => (
                            <div
                              key={`${pos.asset_class}:${pos.symbol}:${pos.position_side ?? pos.direction}`}
                              className="flex items-center gap-3 border-b border-border px-1 py-3 last:border-b-0"
                            >
                              <MarketIcon market={pos.asset_class} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 font-semibold text-foreground">
                                  {pos.symbol}
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${pos.direction === "long" ? "bg-up/10 text-up" : "bg-down/10 text-down"}`}
                                  >
                                    {pos.direction}
                                  </span>
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {pos.quantity} @{" "}
                                  {formatMoney(parseAmount(pos.average_price), pos.currency)}
                                </div>
                              </div>
                              <div className="ml-auto text-right">
                                {/* Already converted into the account balance's own currency —
                                    `pos.currency` above is what it was bought at, not what
                                    this figure is in. Tagging it with the wrong one is a
                                    correct number wearing the wrong label. */}
                                <div className="font-mono text-sm text-foreground">
                                  {formatMoney(parseAmount(pos.market_value), pos.account_currency)}
                                </div>
                                <ChangeBadge value={parseAmount(pos.unrealized_pnl_percent)} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    ) : marketRows.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {marketTab === "Favorite"
                          ? "Click the star icon on any asset to add it here."
                          : "Nothing to show yet."}
                      </p>
                    ) : (
                      <div>
                        {marketRows.map((row) => (
                          <AssetRow key={favKeyFor(row)} row={row} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {sidebar === "orders" && (
                <div className="mt-6 rounded sm:rounded-2xl border border-border bg-card p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex gap-1 rounded-lg border border-border bg-background/40 p-1">
                      <button
                        type="button"
                        onClick={() => setOrdersSubTab("payments")}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                          ordersSubTab === "payments"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Payment History
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrdersSubTab("assetsHistory")}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                          ordersSubTab === "assetsHistory"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Assets History
                      </button>
                    </div>
                    <Link
                      to="/history"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      View full history <i className="fa-solid fa-chevron-right text-[10px]" />
                    </Link>
                  </div>

                  <FilterBar
                    query={ordersQuery}
                    onQuery={setOrdersQuery}
                    time={ordersTime}
                    onTime={setOrdersTime}
                    onReset={resetOrdersFilters}
                  />

                  {ordersSubTab === "payments" ? (
                    filteredPayments.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No payments found.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                              <th className="px-1 sm:px-2 py-1.5 sm:py-2 font-medium">Time</th>
                              <th className="px-1 sm:px-2 py-1.5 sm:py-2 font-medium">Currency</th>
                              <th className="px-1 sm:px-2 py-1.5 sm:py-2 text-right font-medium">
                                Amount
                              </th>
                              <th className="px-1 sm:px-2 py-1.5 sm:py-2 font-medium">Status</th>
                              <th className="px-1 sm:px-2 py-1.5 sm:py-2 text-right font-medium">
                                Action
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredPayments.map((t) => (
                              <tr key={t.id} className="border-b border-border last:border-b-0">
                                <td className="px-1 sm:px-2 py-2 sm:py-3 text-muted-foreground">
                                  {new Date(t.created_at).toLocaleString()}
                                </td>
                                <td className="px-1 sm:px-2 py-2 sm:py-3 text-foreground">
                                  {t.network}
                                </td>
                                <td
                                  className={`px-1 sm:px-2 py-2 sm:py-3 text-right font-mono font-semibold ${t.kind === "deposit" ? "text-up" : "text-down"}`}
                                >
                                  {t.kind === "deposit" ? "+" : "−"}
                                  {t.amount} {t.currency}
                                </td>
                                <td className="px-1 sm:px-2 py-2 sm:py-3">
                                  <span
                                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${t.status === "completed" ? "bg-up/10 text-up" : t.status === "pending" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                                  >
                                    {t.status}
                                  </span>
                                </td>
                                <td className="px-1 sm:px-2 py-2 sm:py-3 text-right">
                                  <Link
                                    to="/history"
                                    className="text-xs font-semibold text-primary hover:opacity-80"
                                  >
                                    Details
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : filteredTradeOrders.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Nothing bought or sold yet — trades you place will show up here.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 font-medium">Time</th>
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 font-medium">Type</th>
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 font-medium">Asset</th>
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 text-right font-medium">
                              Quantity
                            </th>
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 text-right font-medium">
                              Price
                            </th>
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 text-right font-medium">
                              Remark
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTradeOrders.map((o) => (
                            <tr key={o.id} className="border-b border-border last:border-b-0">
                              <td className="px-1 sm:px-2 py-2 sm:py-3 text-muted-foreground">
                                {new Date(o.created_at).toLocaleString()}
                              </td>
                              <td className="px-1 sm:px-2 py-2 sm:py-3 capitalize text-foreground">
                                {o.side}
                              </td>
                              <td className="px-1 sm:px-2 py-2 sm:py-3 font-semibold text-foreground">
                                {o.symbol}
                              </td>
                              <td className="px-1 sm:px-2 py-2 sm:py-3 text-right font-mono text-foreground">
                                {o.quantity}
                              </td>
                              <td className="px-1 sm:px-2 py-2 sm:py-3 text-right font-mono text-foreground">
                                {o.average_price ?? o.limit_price ?? o.stop_price ?? "Market"}
                              </td>
                              <td className="px-1 sm:px-2 py-2 sm:py-3 text-right text-muted-foreground">
                                {o.status}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {sidebar === "account" && (
                <div className="mt-6 space-y-4">
                  <div className="rounded sm:rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-lg font-bold text-foreground">Account details</h2>
                      {kycCompleted && (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            onboardingStatus === "rejected"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-up/10 text-up"
                          }`}
                        >
                          <i
                            className={`fa-solid ${onboardingStatus === "rejected" ? "fa-xmark" : "fa-check"} text-[10px]`}
                          />
                          {onboardingStatus === "approved"
                            ? "Approved"
                            : onboardingStatus === "rejected"
                              ? "Rejected"
                              : "Under review"}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {kycCompleted
                        ? "Submitted for verification. Use “Edit” on a section to correct it."
                        : onboardingSession && onboardingSession.completed_steps.length > 0
                          ? `${onboardingSession.progress_percent}% complete — pick up where you left off.`
                          : "Complete your account details to unlock deposits and trading."}
                    </p>
                    {kycCompleted && onboardingSession ? (
                      <KycDetails
                        session={onboardingSession}
                        onEditStep={(step) =>
                          void navigate({ to: "/kyc", search: { edit: true, step } })
                        }
                      />
                    ) : (
                      <Link
                        to="/kyc"
                        className="mt-4 inline-block rounded sm:rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
                      >
                        {onboardingSession && onboardingSession.completed_steps.length > 0
                          ? "Continue account details"
                          : "Complete account details"}
                      </Link>
                    )}
                  </div>

                  {/*
                    Deliberately just email + the two actions that are actually real:
                    Firebase's password reset and this session's sign-out. There is no SMS
                    provider and no TOTP/passkey enrolment anywhere in this app, so nothing
                    else belongs on this card — the onboarding funnel's own security step
                    (POST /onboarding/step) restricts its two-factor choice to the same two
                    options for the same reason.
                  */}
                  <div className="rounded sm:rounded-2xl border border-border bg-card p-6">
                    <h2 className="text-lg font-bold text-foreground">Security</h2>
                    <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <i className="fa-solid fa-envelope w-4" />
                      <span className="truncate text-foreground">{email}</span>
                    </div>
                    <div className="mt-3 flex flex-col gap-2">
                      <Link
                        to="/forgot-password"
                        className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <i className="fa-solid fa-key w-4" />
                        Reset password
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleLogout()}
                        className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <i className="fa-solid fa-arrow-right-from-bracket w-4" />
                        Log out
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {sidebar === "assets" && (
                <div className="mt-6 rounded sm:rounded-2xl border border-border bg-card p-6">
                  <div className="mb-4 flex items-center justify-between border-b border-border">
                    <div className="flex gap-5">
                      {(["overview", "deposit", "withdraw"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setAssetsSubTab(t)}
                          className={`border-b-2 pb-2.5 text-sm font-semibold capitalize transition-colors ${
                            assetsSubTab === t
                              ? "border-primary text-foreground"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {assetsSubTab === "overview" && (
                    <div className="mb-5 grid gap-4 sm:grid-cols-1">
                      <div className="rounded sm:rounded-xl border border-border bg-background/40 p-4">
                        <div className="text-xs text-muted-foreground">Cash balance</div>
                        {trading.balances.length === 0 ? (
                          <div className="mt-1 font-mono text-xl font-bold text-foreground">
                            {trading.loading ? "Loading…" : "No cash held yet"}
                          </div>
                        ) : (
                          trading.balances.map((b) => (
                            <div
                              key={b.currency}
                              className="mt-1 font-mono text-xl font-bold text-foreground"
                            >
                              {formatMoney(parseAmount(b.total), b.currency)}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  <FilterBar
                    query={assetsQuery}
                    onQuery={setAssetsQuery}
                    time={assetsTime}
                    onTime={setAssetsTime}
                    onReset={resetAssetsFilters}
                  />

                  {filteredAssetsTx.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No transactions found.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 font-medium">Time</th>
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 font-medium">Type</th>
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 font-medium">Asset</th>
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 text-right font-medium">
                              Amount
                            </th>
                            <th className="px-1 sm:px-2 py-1.5 sm:py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAssetsTx.map((t) => (
                            <tr key={t.id} className="border-b border-border last:border-b-0">
                              <td className="px-1 sm:px-2 py-2 sm:py-3 text-muted-foreground">
                                {new Date(t.created_at).toLocaleString()}
                              </td>
                              <td className="px-1 sm:px-2 py-2 sm:py-3 capitalize text-foreground">
                                {t.kind}
                              </td>
                              <td className="px-1 sm:px-2 py-2 sm:py-3 text-foreground">
                                {t.currency} · {t.network}
                              </td>
                              <td
                                className={`px-1 sm:px-2 py-2 sm:py-3 text-right font-mono font-semibold ${t.kind === "deposit" ? "text-up" : "text-down"}`}
                              >
                                {t.kind === "deposit" ? "+" : "−"}
                                {t.amount} {t.currency}
                              </td>
                              <td className="px-1 sm:px-2 py-2 sm:py-3">
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${t.status === "completed" ? "bg-up/10 text-up" : t.status === "pending" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                                >
                                  {t.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
