/**
 * The side panels beside the chart: real market depth, and the user's own fills.
 *
 * **Depth exists for exactly one of the three feeds.** Binance publishes a book, so
 * `GET /crypto/orderbook/{symbol}` is real bids and asks. The FX and equity providers publish
 * none at all, and the venue behind `/trading/*` has no book of its own — it fills against
 * the feed price, never against another user. So rather than synthesise a ladder for those
 * two markets, this shows what their feeds *do* publish: the real quoted spread for FX, and
 * the session range, previous close and volume for equities.
 *
 * **There is no market trade tape anywhere in this API** — no `/trades` on any feed. What a
 * user can truthfully be shown is their *own* executions, which is what `MyFills` renders
 * from `GET /trading/trades`. The panel it replaces invented a twelve-row tape with
 * timestamps counted back from `Date.now()`.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import { decimalsFor, formatCompact, formatPrice, type TradeInstrument } from "@/lib/instrument";
import { fetchCryptoOrderBook, type CryptoOrderBook } from "@/lib/markets-api";
import { amount } from "@/lib/trading-api";
import type { TradingState } from "@/hooks/useTrading";

/** The book moves constantly, but each poll is a real upstream call — keep it modest. */
const BOOK_POLL_MS = 5_000;
const BOOK_LEVELS = 10;

function Panel({
  title,
  badge,
  className = "",
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded border border-overlay-border bg-surface p-2.5 sm:rounded-xl sm:p-4 ${className}`}
    >
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {title}
        </span>
        {badge}
      </div>
      {children}
    </div>
  );
}

function LiveDot({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-500">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
      {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

// --------------------------------------------------------------------------------------- //
// Real crypto depth
// --------------------------------------------------------------------------------------- //

function CryptoDepth({
  instrument,
  className,
}: {
  instrument: TradeInstrument;
  className: string;
}) {
  const { isLoggedIn, authReady } = useAuth();
  const [book, setBook] = useState<CryptoOrderBook | null>(null);
  const [error, setError] = useState("");
  const { symbol } = instrument;
  const decimals = decimalsFor(instrument.price);

  useEffect(() => {
    if (!authReady || !isLoggedIn) {
      setBook(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      try {
        const token = await currentIdToken();
        const next = await fetchCryptoOrderBook(symbol, token, 20, controller.signal);
        if (cancelled) return;
        setBook(next);
        setError("");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : "Could not load the order book.");
      }
    };

    void run();
    const interval = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void run();
    }, BOOK_POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [authReady, isLoggedIn, symbol]);

  const asks = (book?.asks ?? []).slice(0, BOOK_LEVELS).reverse();
  const bids = (book?.bids ?? []).slice(0, BOOK_LEVELS);
  // Scale the depth shading against the largest size on screen, so the bars mean something.
  const maxSize = Math.max(
    ...[...asks, ...bids].map((l) => Number(l.quantity) || 0),
    Number.EPSILON,
  );

  const spread =
    bids[0] && asks[asks.length - 1]
      ? Number(asks[asks.length - 1]!.price) - Number(bids[0]!.price)
      : null;

  const row = (level: { price: string; quantity: string }, side: "ask" | "bid") => {
    const size = Number(level.quantity) || 0;
    return (
      <div key={`${side}-${level.price}`} className="relative flex justify-between px-1 py-[3px]">
        <span
          className={`absolute inset-y-0 right-0 ${side === "ask" ? "bg-down/10" : "bg-up/10"}`}
          style={{ width: `${Math.min(100, (size / maxSize) * 100)}%` }}
        />
        <span
          className={`relative font-mono text-[11px] ${side === "ask" ? "text-down" : "text-up"}`}
        >
          {formatPrice(Number(level.price), decimals)}
        </span>
        <span className="relative font-mono text-[11px] text-muted-foreground">
          {formatCompact(size)}
        </span>
      </div>
    );
  };

  return (
    <Panel
      title="Order book"
      badge={book ? <LiveDot label="Binance" /> : undefined}
      className={className}
    >
      {error && !book ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{error}</p>
      ) : !isLoggedIn ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          Sign in to see live exchange depth.
        </p>
      ) : !book ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          <i className="fa-solid fa-circle-notch fa-spin mr-1.5" />
          Loading depth…
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mb-1 flex justify-between px-1 font-mono text-[9px] uppercase text-muted-foreground/70">
            <span>Price</span>
            <span>Size</span>
          </div>
          {asks.map((l) => row(l, "ask"))}
          <div className="my-1.5 flex items-baseline justify-between border-y border-border px-1 py-1.5">
            <span className="font-mono text-xs font-bold text-foreground">
              {formatPrice(instrument.price, decimals)}
            </span>
            {spread !== null && (
              <span className="font-mono text-[10px] text-muted-foreground">
                spread {formatPrice(spread, decimals)}
              </span>
            )}
          </div>
          {bids.map((l) => row(l, "bid"))}
        </div>
      )}
    </Panel>
  );
}

// --------------------------------------------------------------------------------------- //
// What FX and equities actually publish
// --------------------------------------------------------------------------------------- //

function QuoteDetail({
  instrument,
  className,
}: {
  instrument: TradeInstrument;
  className: string;
}) {
  const decimals = decimalsFor(instrument.price);
  const isForex = instrument.assetClass === "forex";

  return (
    <Panel
      title={isForex ? "Quote" : "Session"}
      badge={
        instrument.stale ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {instrument.marketState === "closed" ? "Closed" : "Stale"}
          </span>
        ) : (
          <LiveDot label={isForex ? "FX" : "Exchange"} />
        )
      }
      className={className}
    >
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/*
          No ladder for these two: the providers publish no depth, and the venue has no book
          of its own to show. These are the real fields they do publish.
        */}
        {isForex ? (
          <>
            <Stat label="Bid" value={formatPrice(instrument.bid, decimals)} />
            <Stat label="Ask" value={formatPrice(instrument.ask, decimals)} />
            <Stat label="Spread" value={formatPrice(instrument.spread, decimals)} />
            <Stat
              label="Spread (pips)"
              value={
                instrument.spreadPips === null ? "—" : instrument.spreadPips.toLocaleString("en-US")
              }
            />
            <Stat label="Session high" value={formatPrice(instrument.dayHigh, decimals)} />
            <Stat label="Session low" value={formatPrice(instrument.dayLow, decimals)} />
          </>
        ) : (
          <>
            <Stat label="Day high" value={formatPrice(instrument.dayHigh, decimals)} />
            <Stat label="Day low" value={formatPrice(instrument.dayLow, decimals)} />
            <Stat label="Previous close" value={formatPrice(instrument.previousClose, decimals)} />
            <Stat
              label={`Volume${instrument.volumeUnit ? ` (${instrument.volumeUnit})` : ""}`}
              value={formatCompact(instrument.volume)}
            />
            <Stat
              label="Market"
              value={instrument.marketState ? instrument.marketState : "unknown"}
            />
          </>
        )}
        <p className="pt-3 text-[10px] leading-relaxed text-muted-foreground/80">
          {isForex
            ? "FX is traded over the counter — there is no central book to show."
            : "Exchange depth is not published on this feed."}
        </p>
      </div>
    </Panel>
  );
}

/** Real depth for crypto; the real published quote for FX and equities. */
export function DepthPanel({
  instrument,
  className = "",
}: {
  instrument: TradeInstrument;
  className?: string;
}) {
  return instrument.assetClass === "crypto" ? (
    <CryptoDepth instrument={instrument} className={className} />
  ) : (
    <QuoteDetail instrument={instrument} className={className} />
  );
}

// --------------------------------------------------------------------------------------- //
// The user's own executions
// --------------------------------------------------------------------------------------- //

/**
 * Replaces the old "Recent trades" market tape, which had no source: no feed in this API
 * publishes one. These are the caller's own fills for this symbol, which are real.
 */
export function MyFills({
  instrument,
  trading,
  className = "",
}: {
  instrument: TradeInstrument;
  trading: TradingState;
  className?: string;
}) {
  const fills = trading.trades.filter((t) => t.symbol === instrument.symbol).slice(0, 15);
  const decimals = decimalsFor(instrument.price);

  return (
    <Panel title={`Your fills · ${instrument.label}`} className={className}>
      {!trading.ready ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          Sign in to see your executions.
        </p>
      ) : fills.length === 0 ? (
        <p className="py-4 text-center text-xs leading-relaxed text-muted-foreground">
          No fills on {instrument.label} yet.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mb-1 flex justify-between px-1 font-mono text-[9px] uppercase text-muted-foreground/70">
            <span>Price</span>
            <span>Qty</span>
            <span>Time</span>
          </div>
          {fills.map((t) => {
            const at = new Date(t.at);
            const pad = (v: number) => String(v).padStart(2, "0");
            return (
              <div key={t.id} className="flex justify-between px-1 py-[3px]">
                <span
                  className={`font-mono text-[11px] ${t.side === "buy" ? "text-up" : "text-down"}`}
                >
                  {formatPrice(amount(t.price), decimals)}
                </span>
                <span className="font-mono text-[11px] text-foreground">{t.quantity}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {pad(at.getHours())}:{pad(at.getMinutes())}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
