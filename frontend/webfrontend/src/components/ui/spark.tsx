export function Spark({ up }: { up: boolean }) {
  const path = up
    ? "M0 30 L14 26 L26 28 L38 18 L52 20 L66 10 L80 12 L96 3"
    : "M0 8 L14 12 L26 9 L38 18 L52 15 L66 24 L80 22 L96 31";
  const id = up ? "u" : "d";
  return (
    <svg viewBox="0 0 96 36" className="h-9 w-24" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={up ? "var(--up)" : "var(--down)"}
            stopOpacity="0.45"
          />
          <stop offset="100%" stopColor={up ? "var(--up)" : "var(--down)"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L96 36 L0 36 Z`} fill={`url(#g-${id})`} />
      <path
        d={path}
        fill="none"
        stroke={up ? "var(--up)" : "var(--down)"}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
