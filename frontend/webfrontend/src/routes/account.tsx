import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth, type KycProfile, type Order, type Transaction } from "@/components/AuthProvider";
import { useFavorites } from "@/components/FavoritesProvider";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { MiniSparkline } from "@/components/ui/marketing";
import {
  ASSETS,
  CATEGORY_PICKS,
  TYPE_ROUTES,
  changeFor,
  findAsset,
  favKey,
  type Asset,
} from "@/lib/market-assets";

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
    const tab = SIDEBAR_ITEMS.some((i) => i.key === search["tab"]) ? (search["tab"] as SidebarKey) : undefined;
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

const USDT_TO_INR = 93;

const MARKET_TABS = ["Holding", "Hot", "New Listing", "Favorite", "Top Gainers", "24h Volume"] as const;
type MarketTab = (typeof MARKET_TABS)[number];

const TIME_FILTERS = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;
type TimeFilterValue = (typeof TIME_FILTERS)[number]["value"];

/** Keeps the first/last few characters and blanks out the rest, for values too sensitive to show in full. */
function mask(value: string, keepStart = 2, keepEnd = 2) {
  if (!value) return "—";
  if (value.length <= keepStart + keepEnd) return "•".repeat(value.length);
  return `${value.slice(0, keepStart)}${"•".repeat(Math.min(value.length - keepStart - keepEnd, 8))}${value.slice(-keepEnd)}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-1 divide-y divide-border/60">{children}</div>
    </div>
  );
}

/** Read-only view of the KYC profile the user submitted — fields can't be edited here, and anything sensitive is partially masked. */
function KycDetails({ profile }: { profile: KycProfile }) {
  return (
    <div className="mt-5 space-y-5">
      <DetailGroup title="Personal">
        <DetailRow label="Full name" value={`${profile.personal.first_name} ${profile.personal.last_name}`} />
        <DetailRow label="Date of birth" value={mask(profile.personal.date_of_birth, 0, 4)} />
        <DetailRow label="Gender" value={profile.personal.gender} />
        <DetailRow label="Place of birth" value={profile.personal.place_of_birth_country} />
      </DetailGroup>

      <DetailGroup title="Contact">
        <DetailRow
          label="Mobile number"
          value={`${profile.contact.mobile_country_code} ${mask(profile.contact.mobile_number, 2, 2)}`}
        />
        <DetailRow label="Nationality" value={profile.contact.nationality} />
        <DetailRow label="Country of residence" value={profile.contact.country_of_residence} />
      </DetailGroup>

      <DetailGroup title="Address">
        <DetailRow label="Residential address" value={mask(profile.address.residential.line1, 3, 0)} />
        <DetailRow label="City" value={profile.address.residential.city} />
        <DetailRow label="State" value={profile.address.residential.state} />
        <DetailRow label="Postal code" value={mask(profile.address.residential.postal_code, 0, 2)} />
        <DetailRow label="Country" value={profile.address.residential.country} />
      </DetailGroup>

      <DetailGroup title="Identity document">
        <DetailRow label="Document type" value={profile.identity.document_type} />
        <DetailRow label="Document number" value={mask(profile.identity.document_number, 0, 4)} />
        <DetailRow label="Issuing country" value={profile.identity.issuing_country} />
      </DetailGroup>

      <DetailGroup title="Tax">
        <DetailRow label="Tax residency" value={profile.tax.tax_residency_country} />
        <DetailRow label="Tax ID" value={mask(profile.tax.tax_identification_number, 0, 4)} />
        <DetailRow label="US person" value={profile.tax.is_us_person ? "Yes" : "No"} />
        <DetailRow label="Source of funds" value={profile.tax.source_of_funds} />
      </DetailGroup>

      <p className="text-xs text-muted-foreground/70">
        These details were verified at signup and can't be edited. Contact support if anything needs correcting.
      </p>
    </div>
  );
}

function filterTransactions(list: Transaction[], query: string, time: TimeFilterValue) {
  const cutoffDays = time === "7d" ? 7 : time === "30d" ? 30 : time === "90d" ? 90 : null;
  const now = Date.now();
  return list.filter((t) => {
    if (cutoffDays !== null) {
      const ageDays = (now - new Date(t.date).getTime()) / (24 * 3600 * 1000);
      if (ageDays > cutoffDays) return false;
    }
    if (query) {
      const q = query.toLowerCase();
      if (!t.method.toLowerCase().includes(q) && !String(t.amount).includes(q)) return false;
    }
    return true;
  });
}

function filterOrders(list: Order[], query: string, time: TimeFilterValue) {
  const cutoffDays = time === "7d" ? 7 : time === "30d" ? 30 : time === "90d" ? 90 : null;
  const now = Date.now();
  return list.filter((o) => {
    if (cutoffDays !== null) {
      const ageDays = (now - new Date(o.date).getTime()) / (24 * 3600 * 1000);
      if (ageDays > cutoffDays) return false;
    }
    if (query) {
      const q = query.toLowerCase();
      if (!o.symbol.toLowerCase().includes(q) && !o.action.includes(q)) return false;
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

function AssetIcon({ asset, size = "h-8 w-8" }: { asset: Asset; size?: string }) {
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold`}
      style={{ backgroundColor: `${asset.color}20`, color: asset.color }}
    >
      <i className={`fa-solid ${asset.icon} text-xs`} />
    </span>
  );
}

function ChangeBadge({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={`text-sm font-mono font-semibold ${up ? "text-up" : "text-down"}`}>
      {up ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function AssetRow({ asset }: { asset: Asset }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-1 py-3 last:border-b-0">
      <FavoriteStar id={favKey(asset)} />
      <AssetIcon asset={asset} />
      <div className="min-w-0">
        <div className="font-semibold text-foreground">{asset.sym}</div>
        <div className="truncate text-xs text-muted-foreground">{asset.name}</div>
      </div>
      <div className="ml-auto text-right">
        <div className="font-mono text-sm text-foreground">{asset.price}</div>
        <ChangeBadge value={changeFor(asset, "24h")} />
      </div>
      <Link
        to={TYPE_ROUTES[asset.type]}
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
  const { isLoggedIn, email, name, kycCompleted, kycProfile, balances, transactions, orders, logout, setName } =
    useAuth();
  const { isFavorite } = useFavorites();
  const [sidebar, setSidebar] = useState<SidebarKey>(tab ?? "dashboard");
  const [marketTab, setMarketTab] = useState<MarketTab>("Holding");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

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
    setEditingName(true);
  };
  const saveName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed) setName(trimmed);
    setEditingName(false);
  };

  const uid = useMemo(() => {
    if (!email) return "000000000";
    let hash = 0;
    for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return String(100000000 + (hash % 900000000));
  }, [email]);

  const totalValueInr = balances.INR + balances.USDT * USDT_TO_INR;

  const trendPoints = useMemo(() => {
    const base = Math.max(totalValueInr, 1);
    return Array.from({ length: 14 }, (_, i) => Math.round(base * (0.85 + 0.15 * Math.sin(i * 0.8 + 1.2) + i * 0.01)));
  }, [totalValueInr]);

  const favoriteAssets = useMemo(() => ASSETS.filter((a) => isFavorite(favKey(a))), [isFavorite]);

  const filteredPayments = useMemo(
    () => filterTransactions(transactions, ordersQuery, ordersTime),
    [transactions, ordersQuery, ordersTime],
  );
  const filteredTradeOrders = useMemo(
    () => filterOrders(orders, ordersQuery, ordersTime),
    [orders, ordersQuery, ordersTime],
  );
  const filteredAssetsTx = useMemo(
    () => filterTransactions(transactions, assetsQuery, assetsTime),
    [transactions, assetsQuery, assetsTime],
  );

  const marketRows: Asset[] = useMemo(() => {
    switch (marketTab) {
      case "Hot":
        return CATEGORY_PICKS.find((c) => c.title === "Hot")!.syms.map(findAsset);
      case "New Listing":
        return CATEGORY_PICKS.find((c) => c.title === "New")!.syms.map(findAsset);
      case "Top Gainers":
        return CATEGORY_PICKS.find((c) => c.title === "Top Gainer")!.syms.map(findAsset);
      case "24h Volume":
        return CATEGORY_PICKS.find((c) => c.title === "Top Volume")!.syms.map(findAsset);
      case "Favorite":
        return favoriteAssets;
      default:
        return [];
    }
  }, [marketTab, favoriteAssets]);

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
          <p className="mt-2 text-sm text-muted-foreground">Sign in to view your Stocks360 account dashboard.</p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
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
            {/* ── Sidebar ── */}
            <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {SIDEBAR_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSidebar(item.key)}
                  className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
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
              <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                    {initial}
                  </div>
                  <div>
                    {editingName ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveName();
                            if (e.key === "Escape") setEditingName(false);
                          }}
                          className="rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-lg font-bold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                        />
                        <button
                          type="button"
                          onClick={saveName}
                          className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90"
                          aria-label="Save name"
                        >
                          <i className="fa-solid fa-check text-xs" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingName(false)}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                          aria-label="Cancel"
                        >
                          <i className="fa-solid fa-xmark text-xs" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-bold text-foreground">{username}</div>
                        <button
                          type="button"
                          onClick={startEditingName}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <i className="fa-solid fa-pen text-[10px]" />
                          Change name
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                
              </div>

              {sidebar === "dashboard" && (
                <div className="mt-6 space-y-6">
                  {/* Est. Total Value */}
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground">Est. Total Value</div>
                        <div className="mt-2 font-mono text-3xl font-bold text-foreground">
                          ₹{totalValueInr.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          ₹{balances.INR.toLocaleString()} + {balances.USDT.toLocaleString()} USDT
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          to="/deposit"
                          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          Deposit
                        </Link>
                        <button
                          type="button"
                          disabled
                          title="Withdrawals aren't available in this demo yet"
                          className="rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-semibold text-muted-foreground opacity-50"
                        >
                          Withdraw
                        </button>
                        <button
                          type="button"
                          disabled
                          title="Not available in this demo yet"
                          className="rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-semibold text-muted-foreground opacity-50"
                        >
                          Cash In
                        </button>
                      </div>
                    </div>
                    <div className="mt-4">
                      <MiniSparkline color="var(--up)" points={trendPoints} className="h-24 w-full" />
                    </div>
                  </div>

                  {/* Markets */}
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="text-lg font-bold text-foreground">Markets</h2>
                      <Link to="/markets" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
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
                      <div>
                        <div className="flex items-center gap-3 border-b border-border px-1 py-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                            ₹
                          </span>
                          <div className="font-semibold text-foreground">INR</div>
                          <div className="ml-auto font-mono text-sm text-foreground">
                            ₹{balances.INR.toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 px-1 py-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#26a17b]/15 text-[10px] font-bold text-[#26a17b]">
                            <i className="fa-solid fa-dollar-sign" />
                          </span>
                          <div className="font-semibold text-foreground">USDT</div>
                          <div className="ml-auto font-mono text-sm text-foreground">
                            {balances.USDT.toLocaleString()} USDT
                          </div>
                        </div>
                      </div>
                    ) : marketRows.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {marketTab === "Favorite"
                          ? "Click the star icon on any asset to add it here."
                          : "Nothing to show yet."}
                      </p>
                    ) : (
                      <div>
                        {marketRows.map((a) => (
                          <AssetRow key={a.sym} asset={a} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {sidebar === "orders" && (
                <div className="mt-6 rounded-2xl border border-border bg-card p-6">
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
                    <Link to="/history" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
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
                      <p className="py-8 text-center text-sm text-muted-foreground">No payments found.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                              <th className="px-2 py-2 font-medium">Time</th>
                              <th className="px-2 py-2 font-medium">Currency</th>
                              <th className="px-2 py-2 text-right font-medium">Amount</th>
                              <th className="px-2 py-2 font-medium">Status</th>
                              <th className="px-2 py-2 text-right font-medium">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredPayments.map((t) => (
                              <tr key={t.id} className="border-b border-border last:border-b-0">
                                <td className="px-2 py-3 text-muted-foreground">{new Date(t.date).toLocaleString()}</td>
                                <td className="px-2 py-3 text-foreground">{t.method}</td>
                                <td className="px-2 py-3 text-right font-mono font-semibold text-up">
                                  +{t.method === "INR" ? "₹" : ""}
                                  {t.amount.toLocaleString()}
                                  {t.method === "USDT" ? " USDT" : ""}
                                </td>
                                <td className="px-2 py-3">
                                  <span className="rounded-full bg-up/10 px-2.5 py-0.5 text-xs font-semibold text-up">
                                    Successful
                                  </span>
                                </td>
                                <td className="px-2 py-3 text-right">
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
                            <th className="px-2 py-2 font-medium">Time</th>
                            <th className="px-2 py-2 font-medium">Type</th>
                            <th className="px-2 py-2 font-medium">Asset</th>
                            <th className="px-2 py-2 text-right font-medium">Quantity</th>
                            <th className="px-2 py-2 text-right font-medium">Price</th>
                            <th className="px-2 py-2 text-right font-medium">Remark</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTradeOrders.map((o) => (
                            <tr key={o.id} className="border-b border-border last:border-b-0">
                              <td className="px-2 py-3 text-muted-foreground">{new Date(o.date).toLocaleString()}</td>
                              <td className="px-2 py-3 capitalize text-foreground">{o.action}</td>
                              <td className="px-2 py-3 font-semibold text-foreground">{o.symbol}</td>
                              <td className="px-2 py-3 text-right font-mono text-foreground">{o.qty}</td>
                              <td className="px-2 py-3 text-right font-mono text-foreground">{o.price}</td>
                              <td className="px-2 py-3 text-right text-muted-foreground">Completed</td>
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
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-lg font-bold text-foreground">Account details</h2>
                      {kycCompleted && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-up/10 px-2.5 py-0.5 text-xs font-semibold text-up">
                          <i className="fa-solid fa-check text-[10px]" />
                          Verified
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {kycCompleted
                        ? "Submitted at signup and verified. These can only be viewed here, not changed."
                        : "Complete your account details"}
                    </p>
                    {kycCompleted && kycProfile ? (
                      <KycDetails profile={kycProfile} />
                    ) : (
                      !kycCompleted && (
                        <Link
                          to="/kyc"
                          className="mt-4 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          Complete account details
                        </Link>
                      )
                    )}
                  </div>

                  <div className="rounded-2xl border border-border bg-card p-6">
                    <h2 className="text-lg font-bold text-foreground">Security</h2>
                    <div className="mt-4 flex flex-col gap-2">
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
                <div className="mt-6 rounded-2xl border border-border bg-card p-6">
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
                    <div className="mb-5 grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-border bg-background/40 p-4">
                        <div className="text-xs text-muted-foreground">INR Balance</div>
                        <div className="mt-1 font-mono text-xl font-bold text-foreground">
                          ₹{balances.INR.toLocaleString()}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border bg-background/40 p-4">
                        <div className="text-xs text-muted-foreground">USDT Balance</div>
                        <div className="mt-1 font-mono text-xl font-bold text-foreground">
                          {balances.USDT.toLocaleString()} USDT
                        </div>
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

                  {assetsSubTab === "withdraw" ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No withdrawals yet — withdrawals aren't available in this demo.
                    </p>
                  ) : filteredAssetsTx.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No transactions found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-2 py-2 font-medium">Time</th>
                            <th className="px-2 py-2 font-medium">Type</th>
                            <th className="px-2 py-2 font-medium">Asset</th>
                            <th className="px-2 py-2 text-right font-medium">Amount</th>
                            <th className="px-2 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAssetsTx.map((t) => (
                            <tr key={t.id} className="border-b border-border last:border-b-0">
                              <td className="px-2 py-3 text-muted-foreground">{new Date(t.date).toLocaleString()}</td>
                              <td className="px-2 py-3 text-foreground">Deposit</td>
                              <td className="px-2 py-3 text-foreground">{t.method}</td>
                              <td className="px-2 py-3 text-right font-mono font-semibold text-up">
                                +{t.amount.toLocaleString()}
                              </td>
                              <td className="px-2 py-3">
                                <span className="rounded-full bg-up/10 px-2.5 py-0.5 text-xs font-semibold text-up">
                                  Completed
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
