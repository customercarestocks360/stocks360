function hashSeed(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) — same seed always replays the same numbers. */
function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MarketStats = {
  /** "1W avg vol diff" — how far today's volume sits from the trailing week's average. */
  avgVolDiffPct: number;
  low52w: number;
  high52w: number;
};

/**
 * Fills in the columns a Groww-style market table shows but our demo asset
 * data doesn't carry (52-week range, weekly volume delta). Derived from the
 * seed + price so the same asset always renders the same numbers instead of
 * reshuffling on every render.
 */
export function deriveMarketStats(seed: string, price: number): MarketStats {
  const rng = mulberry32(hashSeed(`stats:${seed}`));
  const roll = rng();
  const avgVolDiffPct =
    roll < 0.12
      ? (5 + rng() * 20) * 1000 // occasional huge spike, e.g. a name suddenly in play
      : roll < 0.55
        ? rng() * 300
        : -(rng() * 60);

  const band = 0.15 + rng() * 0.35;
  const high52w = price * (1 + band * (0.5 + rng() * 0.5));
  const low52w = price * (1 - band * (0.5 + rng() * 0.5));
  return { avgVolDiffPct, low52w, high52w };
}

/** A short deterministic wiggly walk for sparklines, biased toward the day's direction. */
export function sparkPoints(seed: string, up: boolean, count = 20): number[] {
  const rng = mulberry32(hashSeed(`spark:${seed}`));
  const vals: number[] = [0.5];
  for (let i = 1; i < count; i++) {
    const next = vals[i - 1]! + (rng() - 0.5) * 0.24;
    vals.push(Math.max(0.05, Math.min(0.95, next)));
  }
  const bias = (up ? 1 : -1) * 0.35;
  return vals.map((v, i) => v + bias * (i / (count - 1)));
}
