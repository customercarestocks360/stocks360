/**
 * The trading desk shared by `/trade` and `/forex`.
 *
 * The two pages were ~90 % identical — same watchlist, chart, ticket, depth panel, table and
 * orders block, differing only in which asset class they point at. They are one component
 * now, parameterised by asset class, so a fix to the order flow lands on both.
 *
 * Live prices come from the public overview stream, so the watchlist and table tick for any
 * visitor. Everything that needs a token — quote detail, candles, depth, orders, balances —
 * degrades to a stated reason rather than a fabricated number.
 *
 * **Layout.** This is a terminal, not an article: on `lg` and up the desk is a fixed-height
 * shell that fills the viewport — toolbar, instrument ribbon, a three-pane workspace, and a
 * tabbed dock — and nothing scrolls but the panes themselves. The previous version was a
 * `max-w-7xl` column that stacked the ticket, the instruments table, positions and orders as
 * four separate full-width blocks down the page, which is what made it read as mostly empty.
 * Below `lg` the same panes fall back to ordinary vertical flow, since three columns of
 * real-time data do not fit a phone.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { currentIdToken } from "@/lib/firebase";
import { SearchInput } from "@/components/ui/marketing";
import { AssetChart, type WatchlistItem } from "@/components/ui/asset-chart";
import { DepthPanel, MyFills } from "@/components/ui/order-book";
import { OrderTicket } from "@/components/ui/order-ticket";
import { InstrumentRibbon } from "@/components/ui/instrument-ribbon";
import { DeskDock } from "@/components/ui/desk-dock";
import { formatPrice, type TradeInstrument } from "@/lib/instrument";
import { searchUniverse, type SearchHit } from "@/lib/instrument-search";
import { type AssetClass, type PositionValuation } from "@/lib/trading-api";
import { fetchForexSession, type SessionInfo } from "@/lib/watchlists-api";
import type { Timeframe } from "@/lib/dummy-chart-data";
import { WatchlistPanel } from "@/components/ui/watchlist-panel";
import { useTrading } from "@/hooks/useTrading";
import { useTradingBoard } from "@/hooks/useTradingBoard";
import { useChartSeries } from "@/hooks/useChartSeries";

const CLASS_LABELS: Record<AssetClass, string> = {
  crypto: "Crypto",
  forex: "Forex",
  stocks: "Equities",
};

const CLASS_STYLES: Record<AssetClass, { icon: string; color: string }> = {
  crypto: { icon: "fa-coins", color: "#f59e0b" },
  forex: { icon: "fa-money-bill-transfer", color: "#3b82f6" },
  stocks: { icon: "fa-chart-line", color: "#10b981" },
};

/** Favourite ids stay namespaced per class so the same ticker on two feeds never collides. */
function favKey(instrument: { assetClass: AssetClass; symbol: string }) {
  return `${instrument.assetClass}:${instrument.symbol}`;
}

function ClassIcon({ assetClass, size = "h-7 w-7" }: { assetClass: AssetClass; size?: string }) {
  const { icon, color } = CLASS_STYLES[assetClass];
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full`}
      style={{ backgroundColor: `${color}20`, color }}
    >
      <i className={`fa-solid ${icon} text-[10px]`} />
    </span>
  );
}

/** The right rail shows one of these at a time — the book and your fills want the same space. */
const RAIL_VIEWS = ["Book", "Fills"] as const;
type RailView = (typeof RAIL_VIEWS)[number];

export function TradingDesk({
  assetClasses,
  tableTitle,
  initialAssetClass,
  initialSymbol,
}: {
  /** One or more classes this desk can trade. A picker appears when there is more than one. */
  assetClasses: readonly AssetClass[];
  tableTitle: string;
  /** Deep-link target from `/markets`' "Trade" button — which class the desk should open on. */
  initialAssetClass?: AssetClass | undefined;
  /** Deep-link target from `/markets`' "Trade" button — which instrument to preselect. */
  initialSymbol?: string | undefined;
}) {
  const [assetClass, setAssetClass] = useState<AssetClass>(
    initialAssetClass && assetClasses.includes(initialAssetClass)
      ? initialAssetClass
      : assetClasses[0]!,
  );
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [action, setAction] = useState<"buy" | "sell">("buy");
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  /** Set by "Close" on a position row: pre-fills the ticket to sell the whole free quantity. */
  const [closeIntent, setCloseIntent] = useState<{ symbol: string; quantity: string } | null>(null);
  const [railView, setRailView] = useState<RailView>("Book");

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState("");
  const [showResults, setShowResults] = useState(false);

  const searchBoxRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);

  // One poller for the whole desk: the ticket, the orders panel and the fills list all read
  // the same instance rather than each starting their own.
  const trading = useTrading();
  const board = useTradingBoard(assetClass);

  const instruments = board.instruments;

  // Default to the first streamed instrument, and re-anchor when the class changes.
  useEffect(() => {
    setSelectedSymbol(null);
  }, [assetClass]);

  // Consumed once: a symbol arriving via the URL wins the very first selection, same as a
  // manual search pick, then behaves exactly like any other selection from then on.
  const initialSymbolConsumed = useRef(false);
  useEffect(() => {
    if (!initialSymbol || initialSymbolConsumed.current) return;
    initialSymbolConsumed.current = true;
    let cancelled = false;
    void (async () => {
      const resolved = await board.resolve(initialSymbol);
      if (!cancelled) setSelectedSymbol(resolved?.symbol ?? initialSymbol);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSymbol, board.resolve]);

  const selected = useMemo(() => {
    if (selectedSymbol) {
      const found = instruments.find((i) => i.symbol === selectedSymbol);
      if (found) return found;
    }
    return instruments[0] ?? null;
  }, [instruments, selectedSymbol]);

  const chart = useChartSeries(assetClass, selected?.symbol ?? "", timeframe);

  /** Whichever socket is feeding this board is the one whose liveness matters. */
  const live = board.fromWatchlist ? board.streaming : board.connected;

  // ── FX session. One call for the whole feed, and only on the FX desk. ─────────────────
  const [session, setSession] = useState<SessionInfo | null>(null);
  useEffect(() => {
    if (assetClass !== "forex" || !trading.ready) {
      setSession(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const run = async () => {
      try {
        const info = await fetchForexSession(await currentIdToken(), controller.signal);
        if (!cancelled) setSession(info);
      } catch {
        // Cosmetic: every quote already carries its own `market_state`, so a failure here
        // costs a banner, not correctness.
      }
    };
    void run();
    // The interbank week turns over on a fixed schedule, so this needs re-reading rarely.
    const interval = setInterval(run, 300_000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [assetClass, trading.ready]);

  // ── Search: debounced, against the feed's own universe ────────────────────────────────
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setSearchNote("");
      return;
    }
    if (!trading.ready) {
      setHits([]);
      setSearchNote("Sign in to search the full instrument universe.");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        setSearching(true);
        setSearchNote("");
        try {
          const token = await currentIdToken();
          const found = await searchUniverse(assetClass, term, token, 12, controller.signal);
          if (controller.signal.aborted) return;
          setHits(found);
          if (found.length === 0) setSearchNote("No instruments matched.");
        } catch {
          if (!controller.signal.aborted) setSearchNote("Search is unavailable right now.");
        } finally {
          if (!controller.signal.aborted) setSearching(false);
        }
      })();
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, assetClass, trading.ready]);

  useEffect(() => {
    if (!showResults) return;
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node))
        setShowResults(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showResults]);

  /**
   * Selecting an instrument. On a phone the ticket is far down the page, so the selection
   * scrolls to it; on a desktop it is already on screen in the right rail and scrolling would
   * be a jarring no-op, which is why this is guarded on the same breakpoint as the layout.
   */
  const revealTicket = () => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) return;
    ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pick = async (symbol: string) => {
    setQuery("");
    setShowResults(false);
    // Pull a searched symbol into the board so it has a real quote before the ticket sizes it.
    const resolved = await board.resolve(symbol);
    setSelectedSymbol(resolved?.symbol ?? symbol);
    revealTicket();
  };

  const closePosition = (p: PositionValuation) => {
    setSelectedSymbol(p.symbol);
    setAction("sell");
    setCloseIntent({ symbol: p.symbol, quantity: p.available_quantity });
    revealTicket();
  };

  const watchlist: WatchlistItem[] = useMemo(
    () =>
      instruments.map((i) => ({
        sym: i.symbol,
        name: i.name,
        seed: i.symbol,
        basePrice: i.price ?? 0,
        color: CLASS_STYLES[i.assetClass].color,
        price: formatPrice(i.price),
        changePct: i.changePercent ?? 0,
        group: CLASS_LABELS[i.assetClass],
      })),
    [instruments],
  );

  const feedLabel = board.fromWatchlist
    ? board.streaming
      ? `Streaming ${board.watchlists.selected?.name}`
      : "Reconnecting to your watchlist feed…"
    : board.connected
      ? "Live prices streaming"
      : "Connecting to live prices…";

  return (
    <div className="flex flex-col bg-background lg:h-[calc(100vh-6rem)] lg:overflow-hidden">
      {/* ── Toolbar: what market, which instrument, is the feed up ─────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-overlay-border bg-surface px-2.5 py-2 sm:px-3">
        {assetClasses.length > 1 && (
          <div className="flex shrink-0 gap-px rounded border border-overlay-border p-0.5">
            {assetClasses.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAssetClass(c)}
                className={`rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  assetClass === c
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {CLASS_LABELS[c]}
              </button>
            ))}
          </div>
        )}

        <div
          ref={searchBoxRef}
          className="relative min-w-0 flex-1 sm:max-w-xs"
          onFocusCapture={() => setShowResults(true)}
        >
          <SearchInput
            value={query}
            onChange={(v) => {
              setQuery(v);
              setShowResults(true);
            }}
            placeholder={
              assetClass === "stocks"
                ? "Search any ticker or company…"
                : assetClass === "forex"
                  ? "Search any currency pair…"
                  : "Search any spot pair…"
            }
          />
          {showResults && query.trim().length >= 2 && (
            <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-40 max-h-80 overflow-y-auto rounded-lg border border-overlay-border bg-surface-elevated shadow-2xl">
              {searching ? (
                <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                  <i className="fa-solid fa-circle-notch fa-spin mr-2" />
                  Searching…
                </p>
              ) : hits.length === 0 ? (
                <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                  {searchNote || "No results found."}
                </p>
              ) : (
                hits.map((h) => (
                  <button
                    type="button"
                    key={h.symbol}
                    onClick={() => void pick(h.symbol)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-primary/10"
                  >
                    <ClassIcon assetClass={assetClass} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-foreground">
                        {h.symbol}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{h.name}</div>
                    </div>
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      {h.detail}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Which socket is actually feeding this board — the user's own, or the public one. */}
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              live ? "animate-pulse bg-up" : "bg-muted-foreground/50"
            }`}
          />
          <span className="hidden sm:inline">{feedLabel}</span>
        </span>

        {/* FX has one interbank session for the whole feed, unlike equities' per-symbol calendar. */}
        {assetClass === "forex" && session && (
          <span
            title={session.detail}
            className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            <i
              className={`fa-solid ${
                session.market_state === "open" ? "fa-circle-check text-up" : "fa-moon"
              } text-[10px]`}
            />
            <span className="hidden md:inline">
              {session.market_state === "open" ? "Interbank open" : "Interbank closed"}
            </span>
          </span>
        )}

        {!board.enriched && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            <Link to="/login" className="font-semibold text-primary hover:underline">
              Sign in
            </Link>
            <span className="hidden sm:inline"> for candles, depth and trading</span>
          </span>
        )}
      </div>

      {/* ── The instrument ribbon: the one place this desk prints the quote ────────────── */}
      {selected && (
        <InstrumentRibbon
          instrument={selected}
          onBuy={() => {
            setAction("buy");
            revealTicket();
          }}
          onSell={() => {
            setAction("sell");
            revealTicket();
          }}
        />
      )}

      {/* ── Workspace: watchlist │ chart │ book + ticket ───────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-overlay-border bg-surface lg:w-60 lg:border-b-0 lg:border-r xl:w-64">
          <WatchlistPanel
            assetClass={assetClass}
            watchlists={board.watchlists}
            instruments={instruments}
            selectedSymbol={selected?.symbol ?? null}
            onSelectSymbol={setSelectedSymbol}
            activeSymbol={selected?.symbol ?? null}
            streaming={board.streaming}
            connected={board.connected}
            className="h-72 min-h-0 lg:h-auto lg:flex-1"
          />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <div className="flex h-[26rem] min-h-0 flex-col p-2 sm:h-[30rem] sm:p-3 lg:h-auto lg:flex-1">
              <AssetChart
                seed={selected.symbol}
                color={CLASS_STYLES[assetClass].color}
                basePrice={selected.price ?? 0}
                symbol={selected.label}
                name={selected.name}
                exchange={selected.currency ?? CLASS_LABELS[assetClass]}
                marketStatusLabel={
                  selected.marketState === "closed" ? "Market closed" : "Market open"
                }
                watchlist={watchlist}
                onSelectSymbol={(item) => setSelectedSymbol(item.sym)}
                {...(chart.series ? { series: chart.series } : {})}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
                loadingSeries={chart.loading}
                seriesError={chart.error}
                livePrice={selected.price ?? undefined}
                feedConnected={board.connected}
              />
            </div>
          ) : (
            <div className="flex h-72 items-center justify-center text-xs text-muted-foreground lg:h-auto lg:flex-1">
              {board.connected ? "Loading market…" : "Connecting to the market feed…"}
            </div>
          )}
        </main>

        <aside
          ref={ticketRef}
          className="flex shrink-0 flex-col border-t border-overlay-border bg-surface lg:w-72 lg:border-l lg:border-t-0 xl:w-80"
        >
          {selected && (
            <>
              {/* Book and your fills want the same rectangle, so they share it. */}
              <div className="flex shrink-0 items-center gap-px border-b border-overlay-border px-1.5 pt-1.5">
                {RAIL_VIEWS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setRailView(v)}
                    className={`rounded-t px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      railView === v
                        ? "bg-surface-hover text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {v === "Fills" ? "Your fills" : v}
                  </button>
                ))}
              </div>
              <div className="flex h-64 min-h-0 flex-col lg:h-auto lg:flex-1">
                {railView === "Book" ? (
                  <DepthPanel instrument={selected} className="min-h-0 flex-1" flush />
                ) : (
                  <MyFills
                    instrument={selected}
                    trading={trading}
                    className="min-h-0 flex-1"
                    flush
                  />
                )}
              </div>
              <div className="shrink-0 border-t border-overlay-border">
                <OrderTicket
                  instrument={selected}
                  action={action}
                  onActionChange={setAction}
                  trading={trading}
                  prefill={closeIntent}
                  flush
                />
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ── Dock: positions, orders, and the full instrument list ──────────────────────── */}
      <DeskDock
        trading={trading}
        instruments={instruments}
        assetClass={assetClass}
        selectedSymbol={selected?.symbol ?? null}
        connected={board.connected}
        boardError={board.error}
        onSelect={(symbol) => {
          setSelectedSymbol(symbol);
          revealTicket();
        }}
        onClosePosition={closePosition}
        favKey={favKey}
        classIcon={(c) => <ClassIcon assetClass={c} />}
        instrumentsLabel={tableTitle}
      />
    </div>
  );
}
