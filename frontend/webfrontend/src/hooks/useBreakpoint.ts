/**
 * True once the viewport is at least `px` wide.
 *
 * `useIsMobile` already covers the 768px case, but the trading desk switches layout at Tailwind's
 * `lg` (1024px) — and it needs the answer in JS, not only in CSS, because the resizable pane
 * layout is a different component tree rather than different classes on the same one.
 *
 * Starts `false` so the server render and the first client render agree; a mismatch here is a
 * hydration error rather than a flicker.
 */
import { useEffect, useState } from "react";

export function useMinWidth(px: number): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${px}px)`);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [px]);

  return matches;
}
