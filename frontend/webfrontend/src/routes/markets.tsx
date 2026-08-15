import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useFavorites } from "@/components/FavoritesProvider";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { SearchInput } from "@/components/ui/marketing";
import {
  ASSETS,
  CATEGORY_PICKS,
  TIME_OPTIONS,
  TYPE_ROUTES,
  changeFor,
  findAsset,
  favKey,
  type Asset,
  type TimeOption,
} from "@/lib/market-assets";

export const Route = createFileRoute("/markets")({
  head: () => ({
    meta: [
      { title: "Markets Overview — Stocks360" },
      { name: "description", content: "Global markets overview, indices, and top movers." },
    ],
  }),
  component: MarketsPage,
});

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

function MarketsPage() {
  const [time, setTime] = useState<TimeOption>("24h");
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const [query, setQuery] = useState("");
  const { isFavorite } = useFavorites();

  const favoriteAssets = useMemo(
    () => ASSETS.filter((a) => isFavorite(favKey(a))),
    [isFavorite],
  );

  const sortedAssets = useMemo(() => {
    const filtered = ASSETS.filter(
      (a) =>
        a.name.toLowerCase().includes(query.toLowerCase()) || a.sym.toLowerCase().includes(query.toLowerCase()),
    );
    if (!sortDir) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const diff = changeFor(a, time) - changeFor(b, time);
      return sortDir === "asc" ? diff : -diff;
    });
    return copy;
  }, [sortDir, time, query]);

  const toggleSort = () => {
    setSortDir((d) => (d === null ? "desc" : d === "desc" ? "asc" : null));
  };

  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border">
        <div className="grid-bg absolute inset-0 opacity-40" />

        <div className="relative mx-auto max-w-7xl px-6 py-12 md:py-16">
          {/* ── Category strip: Hot / New / Top Gainer / Top Volume ── */}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {CATEGORY_PICKS.map((cat) => (
              <div
                key={cat.title}
                className="rounded-2xl border border-border bg-card p-5 shadow-sm hover:border-primary/20"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{cat.title}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    More <i className="fa-solid fa-chevron-right text-[10px]" />
                  </span>
                </div>
                <div className="space-y-3">
                  {cat.syms.map((sym) => {
                    const a = findAsset(sym);
                    return (
                      <div key={sym} className="flex items-center gap-2.5">
                        <FavoriteStar id={favKey(a)} />
                        <AssetIcon asset={a} size="h-7 w-7" />
                        <span className="text-sm font-semibold text-foreground">{a.sym}</span>
                        <span className="ml-auto font-mono text-sm text-foreground">{a.price}</span>
                        <span className="w-16 text-right">
                          <ChangeBadge value={changeFor(a, "24h")} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* ── My Favorites — assets starred on this page ── */}
          <div className="mt-8 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <i className="fa-solid fa-star text-sm text-amber-400" />
              <span className="text-sm font-semibold text-foreground">My Favorites</span>
            </div>
            {favoriteAssets.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Click the star icon on any asset to add it here.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {favoriteAssets.map((a) => (
                  <div
                    key={a.sym}
                    className="flex items-center gap-2.5 rounded-xl border border-border bg-background/40 px-3 py-2.5"
                  >
                    <FavoriteStar id={favKey(a)} />
                    <AssetIcon asset={a} size="h-7 w-7" />
                    <span className="text-sm font-semibold text-foreground">{a.sym}</span>
                    <span className="ml-auto font-mono text-sm text-foreground">{a.price}</span>
                    <span className="w-16 text-right">
                      <ChangeBadge value={changeFor(a, "24h")} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Full market table ── */}
          <div className="mt-14">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-foreground">Top Tokens by Market Capitalization</h2>
              <div className="w-full max-w-xs">
                <SearchInput value={query} onChange={setQuery} placeholder="Search ticker or company..." />
              </div>
            </div>

            {sortedAssets.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">No assets found.</p>
            )}

            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Name</th>
                    <th className="px-5 py-3 font-medium">Price</th>
                    <th className="px-5 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <div className="relative inline-block">
                          <button
                            type="button"
                            onClick={() => setTimeMenuOpen((v) => !v)}
                            className="flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 font-mono text-xs font-semibold text-foreground"
                          >
                            {time}
                            <i className="fa-solid fa-chevron-down text-[9px]" />
                          </button>
                          {timeMenuOpen && (
                            <div className="absolute left-0 top-8 z-10 w-20 rounded-md border border-border bg-card p-1 shadow-lg">
                              {TIME_OPTIONS.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => {
                                    setTime(opt);
                                    setTimeMenuOpen(false);
                                  }}
                                  className={`block w-full rounded px-2 py-1.5 text-left font-mono text-xs ${
                                    opt === time
                                      ? "bg-primary text-primary-foreground"
                                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                                  }`}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={toggleSort}
                          className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                        >
                          Change
                          <i
                            className={`fa-solid text-[10px] ${
                              sortDir === "asc"
                                ? "fa-arrow-up-short-wide text-primary"
                                : sortDir === "desc"
                                  ? "fa-arrow-down-wide-short text-primary"
                                  : "fa-sort"
                            }`}
                          />
                        </button>
                      </div>
                    </th>
                    <th className="px-5 py-3 font-medium">24h Volume</th>
                    <th className="px-5 py-3 font-medium">Market Cap</th>
                    <th className="px-5 py-3 text-right font-medium">Trade</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAssets.map((a) => (
                    <tr key={a.sym} className="border-b border-border last:border-b-0 hover:bg-secondary/30">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <FavoriteStar id={favKey(a)} />
                          <AssetIcon asset={a} />
                          <div>
                            <div className="font-semibold text-foreground">{a.sym}</div>
                            <div className="text-xs text-muted-foreground">{a.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-mono text-foreground">{a.price}</td>
                      <td className="px-5 py-4">
                        <ChangeBadge value={changeFor(a, time)} />
                      </td>
                      <td className="px-5 py-4 font-mono text-muted-foreground">{a.volume}</td>
                      <td className="px-5 py-4 font-mono text-muted-foreground">{a.marketCap}</td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          to={TYPE_ROUTES[a.type]}
                          className="inline-block rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          Trade
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
