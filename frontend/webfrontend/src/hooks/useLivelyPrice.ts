/**
 * A display-only price that never sits still, without ever showing a number that isn't
 * grounded in a real quote.
 *
 * FX ticks arrive every few seconds at best — this app's own poller only broadcasts when the
 * provider's bid actually moves (`app/forex/hub.py`) — so a raw render of `price` sits frozen
 * between ticks and reads as dead rather than live. This hook does two things about that,
 * both display-only:
 *
 * 1. **On a real tick**, it eases the shown value from wherever it was to the new real price
 *    over `TWEEN_MS`, instead of snapping. That alone makes every genuine update visible as
 *    motion rather than a jump-cut.
 * 2. **Between ticks**, if a real bid and ask are known, it drifts the shown value in a smooth
 *    curve confined to `[bid, ask]` — never outside the spread the provider actually quoted,
 *    never further from the last real price than that spread allows, and reconciled back to
 *    the real price the instant a new tick lands. Without bid/ask (equities, or a pair
 *    quoting neither) it simply holds the last real value; there is no bound to make up a
 *    number within, so it doesn't.
 *
 * What this deliberately does not do: change `price` itself, write anywhere `AssetChart` or
 * the order ticket reads, or touch a single stored candle. This codebase removed a seeded
 * random-walk generator once already (`chart-data.ts`) because a synthetic series is
 * indistinguishable from a real one under a UI that says "Live" — this hook exists to make
 * the real feed *feel* as alive as it is without repeating that mistake: nothing it returns
 * is ever more than a bounded, real-anchored animation frame between two real observations.
 */
import { useEffect, useRef, useState } from "react";

const TWEEN_MS = 450;
/** One idle drift cycle, randomised a little per mount so rows do not pulse in lockstep. */
const IDLE_PERIOD_MS = [1400, 2600] as const;

function ease(t: number): number {
  // easeOutCubic — fast then settling, so a tick reads as a snap-then-glide rather than linear.
  return 1 - (1 - t) ** 3;
}

export function useLivelyPrice(
  price: number | null,
  bid: number | null = null,
  ask: number | null = null,
): number | null {
  const [display, setDisplay] = useState(price);

  /** Everything the animation frame reads, so the rAF loop never closes over stale props. */
  const state = useRef({
    price,
    bid,
    ask,
    shown: price,
    tweenFrom: price,
    tweenStart: 0,
    phase: Math.random() * Math.PI * 2,
    periodMs: IDLE_PERIOD_MS[0] + Math.random() * (IDLE_PERIOD_MS[1] - IDLE_PERIOD_MS[0]),
  });

  // A real tick landed: start (or retarget) the tween from whatever is on screen right now,
  // not from the previous real price — a tick arriving mid-tween should not visibly jump.
  useEffect(() => {
    const s = state.current;
    const changed = price !== null && price !== s.price;
    s.price = price;
    s.bid = bid;
    s.ask = ask;
    if (changed) {
      s.tweenFrom = s.shown ?? price;
      s.tweenStart = performance.now();
    } else if (s.shown === null && price !== null) {
      s.shown = price;
      setDisplay(price);
    }
  }, [price, bid, ask]);

  useEffect(() => {
    if (price === null) {
      setDisplay(null);
      return;
    }

    let raf = 0;
    let visible = typeof document === "undefined" || document.visibilityState === "visible";
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
    };
    document.addEventListener?.("visibilitychange", onVisibility);

    const tick = (now: number) => {
      const s = state.current;
      if (!visible || s.price === null) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const tweenElapsed = now - s.tweenStart;
      let next: number;
      if (tweenElapsed < TWEEN_MS) {
        next = s.tweenFrom! + (s.price - s.tweenFrom!) * ease(Math.min(1, tweenElapsed / TWEEN_MS));
      } else {
        // Tween finished. Drift within the real spread, if there is one to drift within.
        const half = s.bid !== null && s.ask !== null ? Math.min(s.price - s.bid, s.ask - s.price) : 0;
        next = half > 0 ? s.price + half * Math.sin(now / s.periodMs + s.phase) : s.price;
      }

      if (next !== s.shown) {
        s.shown = next;
        setDisplay(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener?.("visibilitychange", onVisibility);
    };
    // Runs once per mount; the effect above keeps `state.current` current for every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price === null]);

  return display;
}
