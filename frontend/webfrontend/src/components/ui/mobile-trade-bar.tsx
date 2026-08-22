/**
 * The phone's order entry: a fixed Buy/Sell bar that opens the real ticket as a bottom sheet.
 *
 * On a narrow viewport the desk stacks — watchlist, chart, then the rail — so the ticket sat
 * several screens below the chart. The buy button existed but you had to know to scroll for
 * it. This keeps one tap between "looking at the chart" and "placing the order", which is the
 * whole point of a trading UI on a phone.
 *
 * It renders the same `OrderTicket` as the desktop rail rather than a reduced copy: a second
 * implementation of order entry is a second place for validation to drift.
 */
import { useEffect, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { OrderTicket } from "@/components/ui/order-ticket";
import { decimalsFor, formatPrice, type TradeInstrument } from "@/lib/instrument";
import type { TradingState } from "@/hooks/useTrading";

export function MobileTradeBar({
  instrument,
  action,
  onActionChange,
  trading,
  prefill,
}: {
  instrument: TradeInstrument;
  action: "buy" | "sell";
  onActionChange: (action: "buy" | "sell") => void;
  trading: TradingState;
  prefill?: { symbol: string; quantity: string } | null;
}) {
  const [open, setOpen] = useState(false);

  // A sheet left open across an instrument change would be showing the previous symbol's
  // ticket under the new symbol's heading.
  useEffect(() => setOpen(false), [instrument.symbol]);

  const start = (side: "buy" | "sell") => {
    onActionChange(side);
    setOpen(true);
  };

  return (
    <>
      {/*
        `fixed`, not `sticky`. Sticky positions against the nearest scrollport, and on a phone
        the desk container is several screens tall — so the bar parked at the *container's*
        bottom, which is exactly the offscreen spot the ticket was already in.

        It also has to clear `BottomTabBar`, which is itself fixed at `bottom-0` with `h-14`
        below `md` and hidden from `md` up — hence the offset that collapses at `md`.
        `lg:hidden` mirrors the workspace breakpoint: above it the rail's ticket is already on
        screen, and a second entry point would be two ways to do one thing.
      */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 border-t border-overlay-border bg-surface/95 px-3 py-2 backdrop-blur md:bottom-0 lg:hidden">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold text-foreground">
            {instrument.label}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {formatPrice(instrument.price, decimalsFor(instrument.price))}
            {instrument.currency ? ` ${instrument.currency}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => start("buy")}
          className="rounded-lg bg-up px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-sm transition-opacity active:opacity-80"
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => start("sell")}
          className="rounded-lg bg-down px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-sm transition-opacity active:opacity-80"
        >
          Sell
        </button>
      </div>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[92vh] border-overlay-border">
          <DrawerHeader className="pb-2 text-left">
            <DrawerTitle className="text-base">
              {action === "buy" ? "Buy" : "Sell"} {instrument.label}
            </DrawerTitle>
            <DrawerDescription className="font-mono text-xs">
              {formatPrice(instrument.price, decimalsFor(instrument.price))}
              {instrument.currency ? ` ${instrument.currency}` : ""}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-2 pb-6">
            <OrderTicket
              instrument={instrument}
              action={action}
              onActionChange={onActionChange}
              trading={trading}
              prefill={prefill}
              flush
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
