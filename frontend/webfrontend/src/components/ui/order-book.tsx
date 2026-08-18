import { useEffect, useMemo, useState } from "react";

function fmt(n: number, decimals: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Deterministic pseudo-random in [0, 1) so re-renders with the same seed don't jump around between ticks. */
function rand(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

type Row = { price: number; amount: number };

function buildLadder(mid: number, decimals: number, tick: number, rows = 7): { asks: Row[]; bids: Row[] } {
  const step = mid * 0.00025;
  const asks: Row[] = [];
  const bids: Row[] = [];
  for (let i = rows; i >= 1; i--) {
    asks.push({ price: mid + step * i, amount: 0.05 + rand(tick + i) * 1.3 });
  }
  for (let i = 1; i <= rows; i++) {
    bids.push({ price: mid - step * i, amount: 0.05 + rand(tick + i + 100) * 1.3 });
  }
  return { asks, bids };
}

/**
 * Simulated live order book — there's no real matching engine or liquidity
 * feed here, so the ladder is regenerated on an interval around the asset's
 * current price to give the "live" feel the rest of the trade page has.
 */
export function OrderBook({ price, currency, className = "" }: { price: number; currency: string; className?: string }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(id);
  }, []);

  const decimals = price >= 100 ? 2 : price >= 1 ? 4 : 6;
  const { asks, bids } = useMemo(() => buildLadder(price, decimals, tick), [price, decimals, tick]);

  return (
    <div className={`rounded sm:rounded-2xl border border-overlay-border bg-surface p-2 sm:p-5 flex flex-col ${className}`}>
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-sm font-bold text-foreground">Order book</h3>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <i className="fa-solid fa-rotate animate-spin text-[10px]" />
          live
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground shrink-0">
        <span>Price ({currency})</span>
        <span>Amount</span>
      </div>

      <div className="mt-1 flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex flex-col">
        <div className="flex-1 flex flex-col justify-end space-y-0.5 min-h-[min-content]">
          {asks.map((r, i) => (
          <div key={`ask-${i}`} className="flex items-center justify-between font-mono text-xs">
            <span className="text-down">{fmt(r.price, decimals)}</span>
            <span className="text-muted-foreground">{fmt(r.amount, 3)}</span>
          </div>
        ))}
        </div>

        <div className="my-2 border-y border-border py-2 shrink-0">
          <div className="font-mono text-sm font-bold text-foreground">{fmt(price, decimals)}</div>
        </div>

        <div className="flex-1 space-y-0.5 min-h-[min-content]">
          {bids.map((r, i) => (
          <div key={`bid-${i}`} className="flex items-center justify-between font-mono text-xs">
            <span className="text-up">{fmt(r.price, decimals)}</span>
            <span className="text-muted-foreground">{fmt(r.amount, 3)}</span>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}

type Trade = { price: number; amount: number; up: boolean; time: string };

function stampNow(secondsAgo: number) {
  const d = new Date(Date.now() - secondsAgo * 1000);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function buildTrades(mid: number, decimals: number, tick: number, rows = 12): Trade[] {
  const step = mid * 0.0002;
  const trades: Trade[] = [];
  for (let i = 0; i < rows; i++) {
    const seed = tick * 1000 + i;
    const up = rand(seed) > 0.45;
    trades.push({
      price: mid + step * (rand(seed + 1) - 0.5) * 4,
      amount: 0.02 + rand(seed + 2) * 0.9,
      up,
      time: stampNow(i * 3),
    });
  }
  return trades;
}

/**
 * A live-feeling trade tape underneath the order book — same simulation
 * approach (no real feed exists), regenerated on the same interval so the
 * two panels stay in sync visually.
 */
export function RecentTrades({ price, currency, className = "" }: { price: number; currency: string; className?: string }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(id);
  }, []);

  const decimals = price >= 100 ? 2 : price >= 1 ? 4 : 6;
  const trades = useMemo(() => buildTrades(price, decimals, tick), [price, decimals, tick]);

  return (
    <div className={`rounded sm:rounded-2xl border border-overlay-border bg-surface p-2 sm:p-5 flex flex-col ${className}`}>
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-sm font-bold text-foreground">Recent trades</h3>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <i className="fa-solid fa-rotate animate-spin text-[10px]" />
          live
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground shrink-0">
        <span>Price ({currency})</span>
        <span>Amount</span>
        <span>Time</span>
      </div>

      <div className="mt-1 flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden space-y-0.5">
        {trades.map((t, i) => (
          <div key={i} className="flex items-center justify-between font-mono text-xs">
            <span className={t.up ? "text-up" : "text-down"}>{fmt(t.price, decimals)}</span>
            <span className="text-muted-foreground">{fmt(t.amount, 3)}</span>
            <span className="text-muted-foreground/70">{t.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
