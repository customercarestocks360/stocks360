import { useCallback, useMemo, useState } from "react";
import { useFavorites } from "@/components/FavoritesProvider";
import { FavoriteStar } from "@/components/ui/favorite-star";

export type MarketWatchlistItem = {
  /** Unique key, e.g. "EUR/USD" */
  symbol: string;
  /** Display name, defaults to `symbol` */
  name?: string;
  /** Quote currency this pair trades against, e.g. "USD" — powers the top filter tabs */
  quote: string;
  price: string;
  changePct: number;
  /** Optional badge shown next to the name, e.g. "5x" */
  badge?: string;
};

type SortKey = "name" | "price" | "change";
type SubTab = "favorites" | "all" | "recent";
type Movement = "all" | "gainers" | "losers";

/**
 * Compact Binance-style watchlist: quote-asset tabs, a search box that scopes
 * to Favorites/All/Recent, and a sortable Name / Last Price·24h Chg list.
 */
export function MarketWatchlist({
  items,
  favoriteScope,
  onSelect,
  className = "",
}: {
  items: MarketWatchlistItem[];
  /** Prefix used for favorite ids, e.g. "forex" → favorites keyed "forex:EUR/USD" */
  favoriteScope: string;
  onSelect?: (item: MarketWatchlistItem) => void;
  className?: string;
}) {
  const { isFavorite } = useFavorites();
  const [query, setQuery] = useState("");
  const [subTab, setSubTab] = useState<SubTab>("all");
  const [quoteTab, setQuoteTab] = useState("ALL");
  const [movement, setMovement] = useState<Movement>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [recent, setRecent] = useState<string[]>([]);

  const quoteTabs = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) seen.add(it.quote);
    return ["ALL", ...Array.from(seen)];
  }, [items]);

  const favId = useCallback((sym: string) => `${favoriteScope}:${sym}`, [favoriteScope]);

  const rows = useMemo(() => {
    let list = items;
    if (quoteTab !== "ALL") list = list.filter((it) => it.quote === quoteTab);
    if (movement === "gainers") list = list.filter((it) => it.changePct > 0);
    if (movement === "losers") list = list.filter((it) => it.changePct < 0);
    if (subTab === "favorites") list = list.filter((it) => isFavorite(favId(it.symbol)));
    if (subTab === "recent") list = list.filter((it) => recent.includes(it.symbol));
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter(
        (it) => it.symbol.toLowerCase().includes(q) || (it.name ?? "").toLowerCase().includes(q),
      );

    const sorted = [...list].sort((a, b) => {
      const cmp =
        sortKey === "name"
          ? a.symbol.localeCompare(b.symbol)
          : sortKey === "price"
            ? parseFloat(a.price.replace(/[^0-9.-]/g, "")) -
              parseFloat(b.price.replace(/[^0-9.-]/g, ""))
            : a.changePct - b.changePct;
      return sortAsc ? cmp : -cmp;
    });

    if (subTab === "recent") {
      sorted.sort((a, b) => recent.indexOf(a.symbol) - recent.indexOf(b.symbol));
    }
    return sorted;
  }, [items, quoteTab, movement, subTab, query, isFavorite, favId, sortKey, sortAsc, recent]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((a) => !a);
    else {
      setSortKey(key);
      setSortAsc(key === "name");
    }
  };

  const filtersActive = quoteTab !== "ALL" || movement !== "all" || query.trim() !== "";
  const clearFilters = () => {
    setQuoteTab("ALL");
    setMovement("all");
    setQuery("");
  };

  const handleSelect = (item: MarketWatchlistItem) => {
    setRecent((r) => [item.symbol, ...r.filter((s) => s !== item.symbol)].slice(0, 10));
    onSelect?.(item);
  };

  return (
    <div
      className={`rounded sm:rounded-xl border border-overlay-border bg-surface p-1.5 sm:p-3 flex flex-col ${className}`}
    >
      {/* Quote-asset tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border pb-2 shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {quoteTabs.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setQuoteTab(q)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              quoteTab === q
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {q}
          </button>
        ))}
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Movement filter */}
      <div className="mt-2 flex gap-1 shrink-0">
        {(["all", "gainers", "losers"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMovement(m)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
              movement === m
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "gainers" && <i className="fa-solid fa-arrow-trend-up text-up" />}
            {m === "losers" && <i className="fa-solid fa-arrow-trend-down text-down" />}
            {m}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mt-3 shrink-0">
        <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          className="w-full rounded-lg border border-border bg-background/40 py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

      {/* Favorites / All / Recent */}
      <div className="mt-3 flex items-center gap-4 text-xs font-semibold shrink-0">
        <button
          type="button"
          onClick={() => setSubTab("favorites")}
          aria-label="Favorites"
          className={
            subTab === "favorites"
              ? "text-amber-400"
              : "text-muted-foreground hover:text-foreground"
          }
        >
          <i className={`${subTab === "favorites" ? "fa-solid" : "fa-regular"} fa-star`} />
        </button>
        <button
          type="button"
          onClick={() => setSubTab("all")}
          className={
            subTab === "all" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setSubTab("recent")}
          className={
            subTab === "recent" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }
        >
          Recent
        </button>
      </div>

      {/* Column headers */}
      <div className="mt-2 flex items-center justify-between text-[10px] sm:text-[11px] text-muted-foreground shrink-0">
        <button
          type="button"
          onClick={() => toggleSort("name")}
          className="flex items-center gap-1 hover:text-foreground"
        >
          Name
          {sortKey === "name" && <i className={`fa-solid fa-caret-${sortAsc ? "up" : "down"}`} />}
        </button>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => toggleSort("price")}
            className="flex items-center gap-0.5 sm:gap-1 hover:text-foreground"
          >
            Last Price
            {sortKey === "price" && (
              <i className={`fa-solid fa-caret-${sortAsc ? "up" : "down"}`} />
            )}
          </button>
          <button
            type="button"
            onClick={() => toggleSort("change")}
            className="flex items-center gap-0.5 sm:gap-1 hover:text-foreground"
          >
            24h Chg
            {sortKey === "change" && (
              <i className={`fa-solid fa-caret-${sortAsc ? "up" : "down"}`} />
            )}
          </button>
        </div>
      </div>

      {/* Rows */}
      <div className="mt-1 flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {subTab === "favorites"
              ? "Star a pair to add it here."
              : subTab === "recent"
                ? "No recent pairs yet."
                : "No pairs match these filters."}
          </p>
        ) : (
          rows.map((it) => (
            <button
              key={it.symbol}
              type="button"
              onClick={() => handleSelect(it)}
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-secondary/40"
            >
              <FavoriteStar id={favId(it.symbol)} />
              <span className="min-w-0 flex-1 truncate text-xs sm:text-sm font-medium text-foreground">
                {it.symbol}
                {it.badge && (
                  <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 align-middle text-[9px] sm:text-[10px] font-semibold text-muted-foreground">
                    {it.badge}
                  </span>
                )}
              </span>
              <span className="text-right shrink-0">
                <div className="font-mono text-xs sm:text-sm text-foreground">{it.price}</div>
                <div
                  className={`font-mono text-[10px] sm:text-xs ${it.changePct >= 0 ? "text-up" : "text-down"}`}
                >
                  {it.changePct >= 0 ? "+" : ""}
                  {it.changePct.toFixed(2)}%
                </div>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
