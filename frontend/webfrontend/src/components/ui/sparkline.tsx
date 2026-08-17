import { useMemo } from "react";
import { sparkPoints } from "@/lib/market-stats";

export function Sparkline({
  seed,
  up,
  width = 96,
  height = 32,
  points = 20,
}: {
  seed: string;
  up: boolean;
  width?: number;
  height?: number;
  points?: number;
}) {
  const path = useMemo(() => {
    const vals = sparkPoints(seed, up, points);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const stepX = width / (points - 1);
    return vals
      .map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [seed, up, width, height, points]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke={up ? "var(--up)" : "var(--down)"}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
