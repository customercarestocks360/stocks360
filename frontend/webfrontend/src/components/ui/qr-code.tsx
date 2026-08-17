import { useMemo } from "react";
import { qrMatrix } from "@/lib/qr-code";

/**
 * Renders a scannable QR code as inline SVG. The matrix is pure data, so this
 * produces identical markup on the server and the client — no hydration risk.
 */
export function QrCode({
  value,
  size = 148,
  className = "",
  title,
}: {
  value: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const modules = useMemo(() => qrMatrix(value), [value]);
  const count = modules.length;
  const QUIET = 2;
  const total = count + QUIET * 2;

  // One path for every dark module keeps the DOM small compared to per-module rects.
  const path = useMemo(() => {
    let d = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (modules[r]![c]) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
      }
    }
    return d;
  }, [modules, count]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      className={className}
      role="img"
      aria-label={title ?? "QR code"}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
