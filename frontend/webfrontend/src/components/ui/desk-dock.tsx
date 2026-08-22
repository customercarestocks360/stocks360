/** Professional trade blotter pinned below the chart. */
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { amount, money2, type AssetClass, type PositionValuation } from "@/lib/trading-api";
import type { TradingState } from "@/hooks/useTrading";

const TABS = ["Open Positions", "Pending Orders", "Closed Positions", "Finance"] as const;
type Tab = (typeof TABS)[number];

const TAB_ICON: Record<Tab, string> = {
  "Open Positions": "fa-book-open",
  "Pending Orders": "fa-file-lines",
  "Closed Positions": "fa-circle-xmark",
  Finance: "fa-wallet",
};
const TH = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em]";
const TD = "px-3 py-2 font-mono text-xs tabular-nums";

function Empty({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <i className={`fa-solid ${icon}`} />
      </span>
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

function Pnl({
  value,
  currency,
  percent,
}: {
  value: string | null;
  currency: string;
  percent?: string | null;
}) {
  const parsed = amount(value);
  if (parsed === null) return <span className="text-muted-foreground">—</span>;
  const pct = amount(percent);
  return (
    <div className={`font-mono font-bold tabular-nums ${parsed >= 0 ? "text-up" : "text-down"}`}>
      <div>
        {parsed >= 0 ? "+" : ""}
        {money2(value)} <span className="text-[9px] font-medium opacity-70">{currency}</span>
      </div>
      {pct !== null && (
        <div className="text-[10px] font-semibold opacity-80">
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(2)}% ROI
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  currency,
  pnl = false,
}: {
  label: string;
  value: string | null | undefined;
  currency: string;
  pnl?: boolean;
}) {
  const parsed = amount(value);
  const color =
    pnl && parsed !== null ? (parsed >= 0 ? "text-up" : "text-down") : "text-foreground";
  return (
    <div className="min-w-[8.5rem] border-r border-overlay-border px-3 py-2 last:border-r-0">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${color}`}>
        {parsed === null ? "—" : `${parsed > 0 && pnl ? "+" : ""}${money2(value)}`}
        {parsed !== null && (
          <span className="ml-1 text-[9px] font-medium text-muted-foreground">{currency}</span>
        )}
      </div>
    </div>
  );
}

function Positions({
  trading,
  assetClass,
  onSelect,
  onClose,
}: {
  trading: TradingState;
  assetClass: AssetClass;
  onSelect: (symbol: string) => void;
  onClose: (position: PositionValuation) => void;
}) {
  const rows = trading.positions.filter((position) => position.asset_class === assetClass);
  const portfolio = trading.portfolio;
  const currency = portfolio?.account_currency ?? rows[0]?.account_currency ?? "USDT";
  if (rows.length === 0)
    return <Empty icon="fa-book-open">You don&apos;t have any open {assetClass} positions.</Empty>;

  return (
    <>
      <div className="flex overflow-x-auto border-b border-overlay-border bg-background/25">
        <Metric label="Account equity" value={portfolio?.equity} currency={currency} />
        <Metric label="Unrealized P&L" value={portfolio?.unrealized_pnl} currency={currency} pnl />
        <Metric label="Realized P&L" value={portfolio?.realized_pnl} currency={currency} pnl />
        <Metric label="Margin used" value={portfolio?.margin_used} currency={currency} />
        <Metric label="Free margin" value={portfolio?.free_margin} currency={currency} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-overlay-border text-muted-foreground">
              <th className={TH}>Instrument</th>
              <th className={TH}>Side</th>
              <th className={`${TH} text-right`}>Size</th>
              <th className={`${TH} text-right`}>Entry price</th>
              <th className={`${TH} text-right`}>Mark price</th>
              <th className={`${TH} text-right`}>Margin</th>
              <th className={`${TH} text-right`}>Exposure</th>
              <th className={`${TH} text-right`}>Unrealized P&amp;L</th>
              <th className={`${TH} text-right`}>Realized P&amp;L</th>
              <th className={`${TH} text-right`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((position) => {
              const free = Math.abs(amount(position.available_quantity) ?? 0);
              const side = position.position_side ?? position.direction;
              return (
                <tr
                  key={`${position.asset_class}:${position.symbol}:${side}`}
                  onClick={() => onSelect(position.symbol)}
                  className="cursor-pointer border-b border-overlay-border/60 transition-colors last:border-0 hover:bg-surface-hover"
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-foreground">{position.symbol}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {position.asset_class} · quoted in {position.currency}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${side === "long" ? "bg-up/10 text-up" : "bg-down/10 text-down"}`}
                    >
                      {side}
                    </span>
                  </td>
                  <td className={`${TD} text-right text-foreground`}>
                    {Math.abs(amount(position.quantity) ?? 0)}
                  </td>
                  <td className={`${TD} text-right text-muted-foreground`}>
                    {position.average_price === null ? "—" : money2(position.average_price)}{" "}
                    <span className="text-[9px]">{position.currency}</span>
                  </td>
                  <td className={`${TD} text-right text-foreground`}>
                    {position.last_price === null ? "—" : money2(position.last_price)}{" "}
                    <span className="text-[9px] text-muted-foreground">{position.currency}</span>
                  </td>
                  <td className={`${TD} text-right text-foreground`}>
                    {money2(position.margin_used)}{" "}
                    <span className="text-[9px] text-muted-foreground">
                      {position.account_currency}
                    </span>
                  </td>
                  <td className={`${TD} text-right text-foreground`}>
                    {position.market_value === null
                      ? "—"
                      : money2(String(Math.abs(amount(position.market_value) ?? 0)))}{" "}
                    <span className="text-[9px] text-muted-foreground">
                      {position.account_currency}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Pnl
                      value={position.unrealized_pnl}
                      percent={position.unrealized_pnl_percent}
                      currency={position.account_currency}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Pnl value={position.realized_pnl} currency={position.account_currency} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {free > 0 && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onClose(position);
                        }}
                        className="rounded border border-down/30 bg-down/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-down transition-colors hover:bg-down/15"
                      >
                        Close
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PendingOrders({ trading, assetClass }: { trading: TradingState; assetClass: AssetClass }) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rows = trading.orders.filter(
    (order) => order.asset_class === assetClass && order.status === "open",
  );
  const cancel = async (id: string) => {
    setCancelling(id);
    setError("");
    try {
      await trading.cancel(id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not cancel this order.");
    } finally {
      setCancelling(null);
    }
  };
  if (rows.length === 0)
    return <Empty icon="fa-file-lines">No pending orders on this market.</Empty>;
  return (
    <div className="overflow-x-auto">
      {error && <p className="px-3 py-2 text-xs text-down">{error}</p>}
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr className="border-b border-overlay-border text-muted-foreground">
            <th className={TH}>Time</th>
            <th className={TH}>Instrument</th>
            <th className={TH}>Instruction</th>
            <th className={`${TH} text-right`}>Order price</th>
            <th className={`${TH} text-right`}>Quantity</th>
            <th className={`${TH} text-right`}>Reserved</th>
            <th className={`${TH} text-right`}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((order) => (
            <tr key={order.id} className="border-b border-overlay-border/60 last:border-0">
              <td className={`${TD} text-muted-foreground`}>
                {new Date(order.created_at).toLocaleString()}
              </td>
              <td className="px-3 py-2 font-semibold text-foreground">{order.symbol}</td>
              <td className="px-3 py-2">
                <span
                  className={order.side === "buy" ? "font-bold text-up" : "font-bold text-down"}
                >
                  {order.side.toUpperCase()}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {order.position_side ?? "one-way"} · {order.type.replace("_", " ")} ·{" "}
                  {order.time_in_force.toUpperCase()}
                </span>
              </td>
              <td className={`${TD} text-right text-foreground`}>
                {money2(order.limit_price ?? order.stop_price)}{" "}
                <span className="text-[9px] text-muted-foreground">{order.currency}</span>
              </td>
              <td className={`${TD} text-right text-foreground`}>{order.quantity}</td>
              <td className={`${TD} text-right text-muted-foreground`}>
                {money2(order.reserved_amount)} {order.account_currency}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  disabled={cancelling === order.id}
                  onClick={() => void cancel(order.id)}
                  className="text-[10px] font-bold uppercase text-down disabled:opacity-40"
                >
                  {cancelling === order.id ? "Cancelling…" : "Cancel"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClosedPositions({
  trading,
  assetClass,
}: {
  trading: TradingState;
  assetClass: AssetClass;
}) {
  const rows = trading.trades.filter(
    (trade) => trade.asset_class === assetClass && (amount(trade.closed) ?? 0) > 0,
  );
  if (rows.length === 0)
    return <Empty icon="fa-circle-xmark">No closed {assetClass} positions yet.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] border-collapse">
        <thead>
          <tr className="border-b border-overlay-border text-muted-foreground">
            <th className={TH}>Closed at</th>
            <th className={TH}>Instrument</th>
            <th className={TH}>Leg</th>
            <th className={`${TH} text-right`}>Closed size</th>
            <th className={`${TH} text-right`}>Exit price</th>
            <th className={`${TH} text-right`}>Value</th>
            <th className={`${TH} text-right`}>Fee</th>
            <th className={`${TH} text-right`}>Realized P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((trade) => (
            <tr key={trade.id} className="border-b border-overlay-border/60 last:border-0">
              <td className={`${TD} text-muted-foreground`}>
                {new Date(trade.at).toLocaleString()}
              </td>
              <td className="px-3 py-2 font-semibold text-foreground">{trade.symbol}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${trade.position_side === "short" ? "bg-down/10 text-down" : "bg-up/10 text-up"}`}
                >
                  {trade.position_side ?? trade.side}
                </span>
              </td>
              <td className={`${TD} text-right text-foreground`}>{trade.closed}</td>
              <td className={`${TD} text-right text-foreground`}>
                {money2(trade.price)}{" "}
                <span className="text-[9px] text-muted-foreground">{trade.currency}</span>
              </td>
              <td className={`${TD} text-right text-foreground`}>
                {money2(trade.notional)}{" "}
                <span className="text-[9px] text-muted-foreground">{trade.account_currency}</span>
              </td>
              <td className={`${TD} text-right text-down`}>
                -{money2(trade.fee)}{" "}
                <span className="text-[9px] opacity-70">{trade.account_currency}</span>
              </td>
              <td className="px-3 py-2 text-right">
                <Pnl value={trade.realized_pnl} currency={trade.account_currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LEDGER_LABEL: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  reserve: "Margin held",
  release: "Margin released",
  trade_debit: "Trade debit",
  trade_credit: "Trade credit",
  fee: "Fee",
};

function Finance({ trading }: { trading: TradingState }) {
  const portfolio = trading.portfolio;
  const currency = portfolio?.account_currency ?? "USDT";
  const wallet = trading.balances.find((balance) => balance.currency === currency);
  const totalPnl = portfolio
    ? String((amount(portfolio.realized_pnl) ?? 0) + (amount(portfolio.unrealized_pnl) ?? 0))
    : null;
  return (
    <>
      <div className="flex overflow-x-auto border-b border-overlay-border bg-background/25">
        <Metric label="Wallet balance" value={wallet?.total} currency={currency} />
        <Metric label="Available" value={wallet?.available} currency={currency} />
        <Metric label="Reserved" value={wallet?.reserved} currency={currency} />
        <Metric label="Account equity" value={portfolio?.equity} currency={currency} />
        <Metric label="Total P&L" value={totalPnl} currency={currency} pnl />
      </div>
      {trading.ledger.length === 0 ? (
        <Empty icon="fa-wallet">No finance activity recorded yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] border-collapse">
            <thead>
              <tr className="border-b border-overlay-border text-muted-foreground">
                <th className={TH}>Time</th>
                <th className={TH}>Activity</th>
                <th className={TH}>Reference</th>
                <th className={`${TH} text-right`}>Movement</th>
                <th className={`${TH} text-right`}>Available after</th>
                <th className={`${TH} text-right`}>Reserved after</th>
              </tr>
            </thead>
            <tbody>
              {trading.ledger.slice(0, 50).map((entry) => {
                const movement = amount(entry.amount) ?? 0;
                return (
                  <tr key={entry.id} className="border-b border-overlay-border/60 last:border-0">
                    <td className={`${TD} text-muted-foreground`}>
                      {new Date(entry.at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-medium text-foreground">
                      {LEDGER_LABEL[entry.kind] ?? entry.kind}
                    </td>
                    <td className="max-w-64 truncate px-3 py-2 text-xs text-muted-foreground">
                      {entry.reference ?? entry.order_id ?? "—"}
                    </td>
                    <td
                      className={`${TD} text-right font-bold ${movement >= 0 ? "text-up" : "text-down"}`}
                    >
                      {movement > 0 ? "+" : ""}
                      {money2(entry.amount)} {entry.currency}
                    </td>
                    <td className={`${TD} text-right text-foreground`}>
                      {money2(entry.available_after)} {entry.currency}
                    </td>
                    <td className={`${TD} text-right text-muted-foreground`}>
                      {money2(entry.reserved_after)} {entry.currency}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function DeskDock({
  trading,
  assetClass,
  onSelect,
  onClosePosition,
}: {
  trading: TradingState;
  assetClass: AssetClass;
  onSelect: (symbol: string) => void;
  onClosePosition: (position: PositionValuation) => void;
}) {
  const [tab, setTab] = useState<Tab>("Open Positions");
  const [collapsed, setCollapsed] = useState(false);
  const count = (target: Tab) =>
    target === "Open Positions"
      ? trading.positions.filter((position) => position.asset_class === assetClass).length
      : target === "Pending Orders"
        ? trading.orders.filter(
            (order) => order.asset_class === assetClass && order.status === "open",
          ).length
        : target === "Closed Positions"
          ? trading.trades.filter(
              (trade) => trade.asset_class === assetClass && (amount(trade.closed) ?? 0) > 0,
            ).length
          : 0;
  return (
    <div
      className={`flex shrink-0 flex-col border-t border-overlay-border bg-surface ${collapsed ? "" : "lg:h-[min(18rem,32vh)]"}`}
    >
      <div className="flex shrink-0 items-center overflow-x-auto border-b border-overlay-border bg-surface-elevated no-scrollbar">
        {TABS.map((target) => (
          <button
            key={target}
            type="button"
            onClick={() => {
              setTab(target);
              setCollapsed(false);
            }}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2 text-[11px] font-semibold transition-colors ${tab === target && !collapsed ? "border-primary bg-background/30 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <i className={`fa-solid ${TAB_ICON[target]} ${tab === target ? "text-primary" : ""}`} />
            {target}
            {count(target) > 0 && (
              <span className="rounded bg-secondary px-1.5 py-px font-mono text-[9px]">
                {count(target)}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-1 px-2">
          <button
            type="button"
            onClick={() => void trading.refresh()}
            title="Refresh account data"
            className="flex h-7 w-7 items-center justify-center rounded text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <i className="fa-solid fa-rotate" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? "Expand panel" : "Collapse panel"}
            className="flex h-7 w-7 items-center justify-center rounded text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <i className={`fa-solid ${collapsed ? "fa-chevron-up" : "fa-chevron-down"}`} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto max-h-[28rem] lg:max-h-none">
          {!trading.ready ? (
            <Empty icon="fa-lock">Sign in to see your trading activity.</Empty>
          ) : tab === "Open Positions" ? (
            <Positions
              trading={trading}
              assetClass={assetClass}
              onSelect={onSelect}
              onClose={onClosePosition}
            />
          ) : tab === "Pending Orders" ? (
            <PendingOrders trading={trading} assetClass={assetClass} />
          ) : tab === "Closed Positions" ? (
            <ClosedPositions trading={trading} assetClass={assetClass} />
          ) : (
            <Finance trading={trading} />
          )}
        </div>
      )}
    </div>
  );
}
