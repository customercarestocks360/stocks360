/**
 * The bottom dock of the trading desk.
 *
 * The desk used to stack four full-width sections down the page — ticket, instruments table,
 * positions, orders — each in its own `mt-8` block. That is what made the page feel empty:
 * every block was one screen of scrolling to reach, and none of them filled its width. They
 * are one tabbed dock now, pinned under the workspace, so the desk fits a viewport and the
 * panels compete for the same rectangle instead of for vertical space.
 *
 * Orders keeps its own inner tabs (open / history / fills) because those are three views of
 * one resource; the dock's tabs are three different resources.
 */
import { useEffect, useRef, useState } from "react";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { OrdersPanelView } from "@/components/ui/orders-panel";
import { decimalsFor, formatCompact, formatPrice, type TradeInstrument } from "@/lib/instrument";
import { amount, type AssetClass, type Portfolio, type PositionValuation } from "@/lib/trading-api";
import type { TradingState } from "@/hooks/useTrading";

const TABS = ["Positions", "Orders", "Instruments"] as const;
type Tab = (typeof TABS)[number];

function ChangeText({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="font-mono text-xs text-muted-foreground">—</span>;
  return (
    <span className={`font-mono text-xs font-semibold ${pct >= 0 ? "text-up" : "text-down"}`}>
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

/** Low/high track with the price marked. Renders a dash when the feed publishes no range. */
function RangeBar({
  low,
  high,
  price,
}: {
  low: number | null;
  high: number | null;
  price: number | null;
}) {
  if (low === null || high === null || price === null || high <= low)
    return <span className="font-mono text-xs text-muted-foreground">—</span>;
  const pct = Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
  return (
    <div className="flex w-24 items-center gap-1.5">
      <span className="shrink-0 text-[10px] text-muted-foreground">L</span>
      <div className="relative h-1 flex-1 rounded-full bg-muted">
        <span
          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-sm"
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground">H</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-10 text-center text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

const TH = "px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider";
const TD = "px-3 py-2 font-mono text-xs";

/**
 * Holdings, marked to market from `GET /trading/portfolio`.
 *
 * A `null` mark means the feed had no usable price for that symbol — rendered as a dash, since
 * showing 0 would claim the position is worthless rather than unpriced. The per-currency
 * footer is the only total offered: adding INR to USDT would need an FX rate this API has no
 * licensed source for, so the venue reports per currency and so does this.
 */
function PositionsTable({
  positions,
  portfolio,
  assetClass,
  onSelect,
  onClose,
}: {
  positions: PositionValuation[];
  portfolio: Portfolio | null;
  assetClass: AssetClass;
  onSelect: (symbol: string) => void;
  onClose: (position: PositionValuation) => void;
}) {
  const mine = positions.filter((p) => p.asset_class === assetClass);
  if (mine.length === 0)
    return <Empty>No open positions on this market. A filled buy order opens one.</Empty>;

  const currencies = [...new Set(mine.map((p) => p.currency))];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-overlay-border text-muted-foreground">
            <th className={TH}>Symbol</th>
            <th className={`${TH} text-right`}>Qty</th>
            <th className={`${TH} text-right`}>Free</th>
            <th className={`${TH} text-right`}>Avg cost</th>
            <th className={`${TH} text-right`}>Last</th>
            <th className={`${TH} text-right`}>Value</th>
            <th className={`${TH} text-right`}>Unrealised</th>
            <th className={`${TH} text-right`}>Realised</th>
            <th className={`${TH} text-right`}>Action</th>
          </tr>
        </thead>
        <tbody>
          {mine.map((p) => {
            const unrealised = amount(p.unrealized_pnl);
            const unrealisedPct = amount(p.unrealized_pnl_percent);
            const realised = amount(p.realized_pnl);
            const canClose = (amount(p.available_quantity) ?? 0) > 0;
            return (
              <tr
                key={`${p.asset_class}:${p.symbol}`}
                onClick={() => onSelect(p.symbol)}
                className="cursor-pointer border-b border-overlay-border/60 last:border-b-0 hover:bg-surface-hover"
              >
                <td className={`${TD} font-sans font-semibold text-foreground`}>
                  {p.symbol}
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                    {p.currency}
                  </span>
                  {p.stale && (
                    <i
                      className="fa-solid fa-clock ml-1.5 text-[10px] text-muted-foreground"
                      title="Mark is from a closed or stale market"
                    />
                  )}
                </td>
                <td className={`${TD} text-right text-foreground`}>{p.quantity}</td>
                <td className={`${TD} text-right text-muted-foreground`}>
                  {p.available_quantity}
                </td>
                <td className={`${TD} text-right text-muted-foreground`}>
                  {p.average_price ?? "—"}
                </td>
                <td className={`${TD} text-right text-foreground`}>{p.last_price ?? "—"}</td>
                <td className={`${TD} text-right text-foreground`}>{p.market_value ?? "—"}</td>
                <td className={`${TD} text-right`}>
                  {unrealised === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={unrealised >= 0 ? "text-up" : "text-down"}>
                      {unrealised >= 0 ? "+" : ""}
                      {p.unrealized_pnl}
                      {unrealisedPct !== null && (
                        <span className="ml-1 text-[10px] opacity-80">
                          ({unrealisedPct >= 0 ? "+" : ""}
                          {unrealisedPct.toFixed(2)}%)
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className={`${TD} text-right`}>
                  {realised === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={realised >= 0 ? "text-up" : "text-down"}>
                      {realised >= 0 ? "+" : ""}
                      {p.realized_pnl}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {canClose && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(p);
                      }}
                      className="rounded border border-overlay-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-down/40 hover:text-down"
                    >
                      Close
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        {portfolio && (
          <tfoot>
            {currencies.map((ccy) => (
              <tr key={ccy} className="border-t border-overlay-border">
                <td
                  colSpan={5}
                  className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  Total in {ccy}
                  {portfolio.unpriced > 0 && (
                    <span className="ml-2 normal-case tracking-normal opacity-80">
                      · {portfolio.unpriced} of {portfolio.priced + portfolio.unpriced} unpriced
                    </span>
                  )}
                </td>
                <td className={`${TD} text-right text-foreground`}>
                  {portfolio.market_value_by_currency[ccy] ?? "—"}
                </td>
                <td className={`${TD} text-right text-muted-foreground`}>
                  {portfolio.unrealized_pnl_by_currency[ccy] ?? "—"}
                </td>
                <td className={`${TD} text-right text-muted-foreground`}>
                  {portfolio.realized_pnl_by_currency[ccy] ?? "—"}
                </td>
                <td />
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  );
}

function InstrumentsTable({
  instruments,
  assetClass,
  selectedSymbol,
  connected,
  error,
  onSelect,
  favKey,
  classIcon,
}: {
  instruments: TradeInstrument[];
  assetClass: AssetClass;
  selectedSymbol: string | null;
  connected: boolean;
  error: string;
  onSelect: (symbol: string) => void;
  favKey: (i: TradeInstrument) => string;
  classIcon: (assetClass: AssetClass) => React.ReactNode;
}) {
  if (instruments.length === 0)
    return <Empty>{connected ? "Loading instruments…" : "Connecting to the market feed…"}</Empty>;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-overlay-border text-muted-foreground">
              <th className={TH}>Instrument</th>
              <th className={`${TH} text-right`}>Price</th>
              <th className={`${TH} text-right`}>Change</th>
              <th className={`${TH} text-right`}>
                {assetClass === "forex" ? "Spread" : "Volume"}
              </th>
              <th className={TH}>{assetClass === "forex" ? "Session range" : "Day range"}</th>
              <th className={`${TH} text-right`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {instruments.map((i) => (
              <tr
                key={i.symbol}
                onClick={() => onSelect(i.symbol)}
                className={`cursor-pointer border-b border-overlay-border/60 transition-colors last:border-b-0 ${
                  selectedSymbol === i.symbol ? "bg-primary/5" : "hover:bg-surface-hover"
                }`}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    {classIcon(i.assetClass)}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-foreground">{i.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {i.label}
                        {i.currency && <span className="ml-1.5 opacity-70">{i.currency}</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td className={`${TD} text-right text-foreground`}>
                  {formatPrice(i.price, decimalsFor(i.price))}
                </td>
                <td className={`${TD} text-right`}>
                  <ChangeText pct={i.changePercent} />
                </td>
                <td className={`${TD} text-right text-muted-foreground`}>
                  {i.assetClass === "forex"
                    ? i.spreadPips === null
                      ? "—"
                      : `${i.spreadPips} pips`
                    : formatCompact(i.volume)}
                </td>
                <td className="px-3 py-2">
                  <RangeBar low={i.dayLow} high={i.dayHigh} price={i.price} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <FavoriteStar
                      id={favKey(i)}
                      className="flex h-6 w-6 items-center justify-center rounded border border-overlay-border text-[10px]"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(i.symbol);
                      }}
                      className="rounded bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      Trade
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="px-3 py-2 text-[11px] text-muted-foreground">{error}</p>}
    </>
  );
}

export function DeskDock({
  trading,
  instruments,
  assetClass,
  selectedSymbol,
  connected,
  boardError,
  onSelect,
  onClosePosition,
  favKey,
  classIcon,
  instrumentsLabel,
}: {
  trading: TradingState;
  instruments: TradeInstrument[];
  assetClass: AssetClass;
  selectedSymbol: string | null;
  connected: boolean;
  boardError: string;
  onSelect: (symbol: string) => void;
  onClosePosition: (position: PositionValuation) => void;
  favKey: (i: TradeInstrument) => string;
  classIcon: (assetClass: AssetClass) => React.ReactNode;
  /** What the desk calls its instrument list — "Instruments", "Currency pairs", etc. */
  instrumentsLabel: string;
}) {
  /**
   * Positions and orders both need a session, so a signed-out visitor would land on a panel
   * that can only say "sign in". The instrument list streams for everyone, so it opens there
   * and moves to positions once the session resolves — unless the visitor has already picked
   * a tab, in which case yanking it away underneath them would be worse than a stale default.
   */
  const [tab, setTab] = useState<Tab>("Instruments");
  const [collapsed, setCollapsed] = useState(false);
  const tabPickedByUser = useRef(false);
  useEffect(() => {
    if (!tabPickedByUser.current && trading.ready) setTab("Positions");
  }, [trading.ready]);

  const openCount = trading.orders.filter((o) => o.status === "open").length;
  const positionCount = trading.positions.filter((p) => p.asset_class === assetClass).length;

  /** A count beside a tab label, so the dock says what is in it while collapsed. */
  const badge = (n: number) =>
    n > 0 ? (
      <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-px font-mono text-[9px] font-bold text-primary">
        {n}
      </span>
    ) : null;

  // A fixed band on desktop whose body scrolls: without a height the tables grow to their
  // natural size and push the dock straight out through the bottom of the shell.
  return (
    <div
      className={`flex shrink-0 flex-col border-t border-overlay-border bg-surface ${
        collapsed ? "" : "lg:h-[min(17rem,30vh)]"
      }`}
    >
      <div className="flex shrink-0 items-center gap-px border-b border-overlay-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              tabPickedByUser.current = true;
              setTab(t);
              setCollapsed(false);
            }}
            className={`flex items-center border-b-2 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors sm:px-4 ${
              tab === t && !collapsed
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "Instruments" ? instrumentsLabel : t}
            {t === "Orders" && badge(openCount)}
            {t === "Positions" && badge(positionCount)}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 pr-2">
          <button
            type="button"
            onClick={() => void trading.refresh()}
            title="Refresh orders, positions and balances"
            className="flex h-7 w-7 items-center justify-center rounded text-[11px] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <i className="fa-solid fa-rotate" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "Expand panel" : "Collapse panel"}
            aria-expanded={!collapsed}
            className="flex h-7 w-7 items-center justify-center rounded text-[11px] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <i className={`fa-solid ${collapsed ? "fa-chevron-up" : "fa-chevron-down"}`} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto lg:max-h-none max-h-96">
          {!trading.ready && tab !== "Instruments" ? (
            <Empty>Sign in to see your {tab.toLowerCase()}.</Empty>
          ) : tab === "Positions" ? (
            <PositionsTable
              positions={trading.positions}
              portfolio={trading.portfolio}
              assetClass={assetClass}
              onSelect={onSelect}
              onClose={onClosePosition}
            />
          ) : tab === "Orders" ? (
            <OrdersPanelView trading={trading} variant="embedded" />
          ) : (
            <InstrumentsTable
              instruments={instruments}
              assetClass={assetClass}
              selectedSymbol={selectedSymbol}
              connected={connected}
              error={boardError}
              onSelect={onSelect}
              favKey={favKey}
              classIcon={classIcon}
            />
          )}
        </div>
      )}
    </div>
  );
}
