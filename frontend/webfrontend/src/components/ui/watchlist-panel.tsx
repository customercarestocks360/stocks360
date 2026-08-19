/**
 * The watchlist column: pick a list, edit it, and see it tick.
 *
 * "Headline" is the public overview set — five fixed symbols per market, live for anyone with
 * no token. Anything else is one of the user's own server-side watchlists, which streams over
 * its own authenticated socket, so symbols they chose tick too.
 *
 * Edits here are deliberately *not* followed by a reconnect: the server re-binds the open
 * socket and pushes a `resynced` frame, so the list and its quotes update on the connection
 * that is already there.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ApiError } from "@/lib/api";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { formatPrice, type TradeInstrument } from "@/lib/instrument";
import type { AssetClass } from "@/lib/trading-api";
import { MAX_SYMBOLS_PER_WATCHLIST, MAX_WATCHLISTS } from "@/lib/watchlists-api";
import type { WatchlistsState } from "@/hooks/useWatchlists";

function ChangeText({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="font-mono text-xs text-muted-foreground">—</span>;
  return (
    <span className={`font-mono text-xs font-semibold ${pct >= 0 ? "text-up" : "text-down"}`}>
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

export function WatchlistPanel({
  assetClass,
  watchlists,
  instruments,
  selectedSymbol,
  onSelectSymbol,
  /** The symbol the desk currently has open, so it can be added to a list in one click. */
  activeSymbol,
  streaming,
  connected,
  className = "",
}: {
  assetClass: AssetClass;
  watchlists: WatchlistsState;
  instruments: TradeInstrument[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
  activeSymbol: string | null;
  streaming: boolean;
  connected: boolean;
  className?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const { selected, watchlists: lists, ready } = watchlists;
  const cap = MAX_SYMBOLS_PER_WATCHLIST[assetClass];

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError("");
    try {
      await fn();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "That did not work. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    // A watchlist must hold at least one symbol — an empty one has nothing to stream — so the
    // instrument on screen seeds it.
    const seed = activeSymbol ?? instruments[0]?.symbol;
    if (!seed) {
      setActionError("Pick an instrument first — a watchlist cannot be empty.");
      return;
    }
    await run(async () => {
      await watchlists.create(name, [seed]);
      setNewName("");
      setCreating(false);
    });
  };

  const canAddActive =
    selected !== null &&
    activeSymbol !== null &&
    !selected.symbols.includes(activeSymbol) &&
    selected.symbols.length < cap;

  const atCap = selected !== null && selected.symbols.length >= cap;

  return (
    <div
      className={`flex flex-col rounded border border-overlay-border bg-surface p-2 sm:rounded-xl sm:p-4 ${className}`}
    >
      {/* ── Header: which list, and its live state ── */}
      <div className="mb-2 flex shrink-0 items-center gap-1.5">
        <div ref={menuRef} className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => ready && setMenuOpen((v) => !v)}
            disabled={!ready}
            className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-secondary/40 disabled:cursor-default disabled:hover:bg-transparent"
          >
            <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-foreground">
              {selected?.name ?? "Headline"}
            </span>
            {ready && (
              <i
                className={`fa-solid fa-chevron-down shrink-0 text-[9px] text-muted-foreground transition-transform ${
                  menuOpen ? "rotate-180" : ""
                }`}
              />
            )}
          </button>

          {menuOpen && (
            <div className="absolute left-0 right-0 top-[calc(100%+0.3rem)] z-30 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  watchlists.select(null);
                  setMenuOpen(false);
                }}
                className={`w-full truncate rounded-md px-2 py-1.5 text-left text-xs ${
                  selected === null
                    ? "bg-secondary font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60"
                }`}
              >
                Headline
                <span className="ml-1 opacity-60">· public</span>
              </button>
              {lists.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    watchlists.select(w.id);
                    setMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs ${
                    selected?.id === w.id
                      ? "bg-secondary font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <span className="shrink-0 font-mono text-[10px] opacity-60">
                    {w.symbols.length}
                  </span>
                </button>
              ))}
              {lists.length < MAX_WATCHLISTS && (
                <button
                  type="button"
                  onClick={() => {
                    setCreating(true);
                    setMenuOpen(false);
                  }}
                  className="mt-1 w-full rounded-md border-t border-border px-2 py-1.5 text-left text-xs text-primary hover:bg-secondary/60"
                >
                  <i className="fa-solid fa-plus mr-1.5 text-[9px]" />
                  New watchlist
                </button>
              )}
            </div>
          )}
        </div>

        {/* A watchlist streams over its own authenticated socket; Headline over the public one. */}
        <span
          title={
            selected
              ? streaming
                ? "Streaming live over your watchlist's own socket"
                : "Reconnecting to your watchlist feed"
              : connected
                ? "Streaming live over the public feed"
                : "Connecting to the public feed"
          }
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            (selected ? streaming : connected) ? "animate-pulse bg-up" : "bg-muted-foreground/50"
          }`}
        />
        {selected && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => watchlists.remove(selected.id))}
            title="Delete this watchlist"
            className="shrink-0 px-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:text-down disabled:opacity-40"
          >
            <i className="fa-solid fa-trash" />
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-2 shrink-0 space-y-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Watchlist name"
            autoFocus
            maxLength={64}
            className="w-full rounded border border-border bg-background/60 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy || !newName.trim()}
              onClick={() => void submitCreate()}
              className="flex-1 rounded bg-primary px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              className="rounded border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <p className="mb-2 shrink-0 text-[10px] leading-tight text-down">{actionError}</p>
      )}

      {/* ── Rows ── */}
      {instruments.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          {selected
            ? "This watchlist is empty."
            : connected
              ? "Loading instruments…"
              : "Connecting…"}
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {instruments.map((i) => (
            <div
              key={i.symbol}
              className={`group flex items-center gap-1.5 rounded-md px-1.5 py-1.5 transition-colors ${
                selectedSymbol === i.symbol ? "bg-primary/10" : "hover:bg-secondary/40"
              }`}
            >
              <FavoriteStar id={`${i.assetClass}:${i.symbol}`} />
              <button
                type="button"
                onClick={() => onSelectSymbol(i.symbol)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-foreground">
                  {i.label}
                </span>
                <span className="shrink-0 font-mono text-xs text-foreground">
                  {formatPrice(i.price)}
                </span>
                <span className="w-14 shrink-0 text-right">
                  <ChangeText pct={i.changePercent} />
                </span>
              </button>
              {/* The venue refuses to leave a watchlist empty, so the last row keeps no remove. */}
              {selected && selected.symbols.length > 1 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => watchlists.removeSymbol(selected.id, i.symbol))}
                  title={`Remove ${i.label}`}
                  className="shrink-0 text-[10px] text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60 hover:!text-down disabled:opacity-40"
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Add the open instrument ── */}
      {ready && selected && activeSymbol && (
        <div className="mt-2 shrink-0">
          {canAddActive ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => watchlists.addSymbols(selected.id, [activeSymbol]))}
              className="w-full rounded border border-dashed border-border px-2 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-secondary/40 disabled:opacity-40"
            >
              <i className="fa-solid fa-plus mr-1.5 text-[9px]" />
              Add {activeSymbol}
            </button>
          ) : atCap ? (
            <p className="text-center text-[10px] text-muted-foreground">
              At the {cap}-symbol limit for {assetClass}.
            </p>
          ) : null}
        </div>
      )}

      {!ready && (
        <p className="mt-2 shrink-0 text-center text-[10px] leading-relaxed text-muted-foreground">
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>{" "}
          to build watchlists that stream any symbol.
        </p>
      )}
    </div>
  );
}
