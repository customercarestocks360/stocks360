import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { TIMEFRAMES, generateSeries, isIntraday, type ChartPoint, type Timeframe } from "@/lib/dummy-chart-data";

const MA_WINDOW = 20;
const UP = "#26a69a";
const DOWN = "#ef5350";
const ACCENT = "#2b6ef2";

type ChartType = "candles" | "area" | "line";
type Tool = "cursor" | "crosshair" | "trendline" | "hline" | "ray" | "rect" | "fib" | "arrow" | "measure";

/** How many clicks each tool needs before the drawing is committed. */
const REQUIRED_POINTS: Partial<Record<Tool, number>> = {
  trendline: 2,
  hline: 1,
  ray: 2,
  rect: 2,
  fib: 2,
  arrow: 2,
  measure: 2,
};
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const PALETTE = ["#2b6ef2", "#26a69a", "#ef5350", "#eab308", "#a855f7", "#f97316", "#38bdf8", "#e5e7eb"];
const WIDTHS = [1, 1.5, 2, 3];

type DrawPoint = { time: number; price: number };
type Drawing = { id: number; type: Tool; points: DrawPoint[]; color: string; width: number };

export type WatchlistItem = {
  sym: string;
  name: string;
  seed: string;
  basePrice: number;
  color: string;
  price: string;
  changePct: number;
  group?: string;
};

/**
 * Always format with an explicit locale. `toLocaleString()` without one uses the
 * host locale, which differs between the SSR process and the browser (e.g. en-IN
 * groups 2794281 as "27,94,281" while en-US gives "2,794,281") and that mismatch
 * throws a React hydration error.
 */
function fmt(n: number, decimals: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtInt(n: number) {
  return n.toLocaleString("en-US");
}
function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Floating label shown on hover so no control is a mystery button. */
function HoverTip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: React.ReactNode;
  side?: "top" | "right";
}) {
  return (
    <div className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-[80] whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 ${
          side === "right" ? "left-full top-1/2 ml-2 -translate-y-1/2" : "bottom-full left-1/2 mb-2 -translate-x-1/2"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function ToolBtn({
  icon,
  label,
  active,
  disabled,
  onClick,
  side = "right",
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  side?: "top" | "right";
}) {
  return (
    <HoverTip label={label} side={side}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition-colors ${
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
        } ${disabled ? "cursor-not-allowed opacity-30" : ""}`}
      >
        <i className={`fa-solid ${icon}`} />
      </button>
    </HoverTip>
  );
}

function PerfTile({ label, pct }: { label: string; pct: number }) {
  const up = pct >= 0;
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-center">
      <div className={`font-mono text-sm font-bold ${up ? "text-up" : "text-down"}`}>
        {up ? "+" : ""}
        {pct.toFixed(2)}%
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * Shared chart panel used on the Trade/Forex pages, rendered with
 * lightweight-charts so pixel↔price mapping is exact (which is what makes the
 * free-form drawing layer possible) and large series stay smooth.
 *
 * Full-screen mode adds a left drawing toolbar, a right watchlist wired back to
 * the parent via `onSelectSymbol`, and a fully interactive vector layer:
 * drawings can be selected, dragged by body or by individual anchor, restyled,
 * duplicated, undone/redone and removed — via mouse, right-click or keyboard.
 */
export function AssetChart({
  seed,
  color,
  basePrice,
  symbol,
  name,
  exchange = "NASDAQ",
  watchlist = [],
  onSelectSymbol,
  marketStatusLabel = "Market Open",
}: {
  seed: string;
  color: string;
  basePrice: number;
  symbol?: string;
  name?: string;
  exchange?: string;
  watchlist?: WatchlistItem[];
  onSelectSymbol?: (item: WatchlistItem) => void;
  marketStatusLabel?: string;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [showMA, setShowMA] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  /** Below `lg` the tools/watchlist columns don't fit — they become slide-in overlays instead. */
  const [mobilePanel, setMobilePanel] = useState<"none" | "tools" | "watchlist">("none");
  const [activeTool, setActiveTool] = useState<Tool>("cursor");
  const [showDrawings, setShowDrawings] = useState(true);
  const [locked, setLocked] = useState(false);
  const [magnet, setMagnet] = useState(false);

  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [pending, setPending] = useState<DrawPoint[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; onDrawing: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [watchQuery, setWatchQuery] = useState("");
  const [watchSort, setWatchSort] = useState<"desc" | "asc" | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | ISeriesApi<"Line"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maRef = useRef<ISeriesApi<"Line"> | null>(null);
  const drawIdRef = useRef(1);
  /** A fingertip is far less precise than a mouse cursor — widen the hit-test radius for it. */
  const lastPointerTypeRef = useRef<string>("mouse");
  const undoRef = useRef<Drawing[][]>([]);
  const redoRef = useRef<Drawing[][]>([]);
  const dragRef = useRef<
    | {
        id: number;
        mode: "body" | "anchor";
        anchorIdx: number | undefined;
        start: DrawPoint & { idx: number; rawPrice: number };
        startPoints: DrawPoint[];
        snapshot: Drawing[];
        moved: boolean;
      }
    | null
  >(null);

  const data = useMemo(() => {
    const series = generateSeries(seed, timeframe, basePrice);
    let sum = 0;
    return series.map((p, i) => {
      sum += p.close;
      if (i >= MA_WINDOW) sum -= series[i - MA_WINDOW]!.close;
      return { ...p, ma: i >= MA_WINDOW - 1 ? sum / MA_WINDOW : undefined } as ChartPoint;
    });
  }, [seed, timeframe, basePrice]);

  const timeIndex = useMemo(() => {
    const m = new Map<number, number>();
    data.forEach((d, i) => m.set(d.time, i));
    return m;
  }, [data]);

  const lastPoint = data[data.length - 1];
  const firstPoint = data[0];
  const lastPrice = lastPoint?.close ?? basePrice;
  const firstPrice = firstPoint?.open ?? basePrice;
  const changePct = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const up = changePct >= 0;
  const decimals = lastPrice < 1 ? 4 : lastPrice < 100 ? 3 : 2;
  const readout = hoverIndex !== null ? (data[hoverIndex] ?? lastPoint) : lastPoint;

  const perf = useMemo(
    () =>
      (["1W", "1M", "ALL"] as Timeframe[]).map((tf) => {
        const s = generateSeries(seed, tf, basePrice);
        const f = s[0]?.open ?? basePrice;
        const l = s[s.length - 1]?.close ?? basePrice;
        return { tf: tf === "ALL" ? "2Y" : tf, pct: f ? ((l - f) / f) * 100 : 0 };
      }),
    [seed, basePrice],
  );

  /* Everything the imperative listeners need, kept in a ref so the handlers
     never read stale closure values. */
  const S = useRef({ activeTool, drawings, selectedId, hoverId, magnet, locked, showDrawings, pending, data, timeIndex, decimals });
  S.current = { activeTool, drawings, selectedId, hoverId, magnet, locked, showDrawings, pending, data, timeIndex, decimals };

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1800);
  }, []);

  /* ---------------- coordinate helpers ---------------- */
  const xFor = useCallback((time: number) => {
    try {
      return chartRef.current?.timeScale().timeToCoordinate(time as UTCTimestamp) ?? null;
    } catch {
      return null;
    }
  }, []);
  const yFor = useCallback((price: number) => {
    try {
      return mainRef.current?.priceToCoordinate(price) ?? null;
    } catch {
      return null;
    }
  }, []);
  const ptPx = useCallback(
    (p: DrawPoint) => {
      const x = xFor(p.time);
      const y = yFor(p.price);
      return x == null || y == null ? null : { x, y };
    },
    [xFor, yFor],
  );
  const pxToPoint = useCallback((x: number, y: number) => {
    const chart = chartRef.current;
    const series = mainRef.current;
    if (!chart || !series) return null;
    const logical = chart.timeScale().coordinateToLogical(x);
    const raw = series.coordinateToPrice(y);
    if (logical == null || raw == null) return null;
    const arr = S.current.data;
    const idx = Math.max(0, Math.min(arr.length - 1, Math.round(logical)));
    const bar = arr[idx];
    if (!bar) return null;
    let price = raw as number;
    if (S.current.magnet) {
      let bd = Infinity;
      for (const v of [bar.open, bar.high, bar.low, bar.close]) {
        const d = Math.abs(v - price);
        if (d < bd) {
          bd = d;
          price = v;
        }
      }
    }
    return { time: bar.time, price, rawPrice: raw as number, idx };
  }, []);

  /* ---------------- undo / redo ---------------- */
  const cloneList = (l: Drawing[]) => l.map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) }));
  const pushUndo = useCallback(() => {
    undoRef.current.push(cloneList(S.current.drawings));
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
  }, []);
  const doUndo = useCallback(() => {
    if (!undoRef.current.length) return flash("Nothing to undo");
    redoRef.current.push(cloneList(S.current.drawings));
    setDrawings(undoRef.current.pop()!);
    setSelectedId(null);
  }, [flash]);
  const doRedo = useCallback(() => {
    if (!redoRef.current.length) return flash("Nothing to redo");
    undoRef.current.push(cloneList(S.current.drawings));
    setDrawings(redoRef.current.pop()!);
    setSelectedId(null);
  }, [flash]);

  /* ---------------- geometry / hit testing ---------------- */
  const segmentsFor = useCallback(
    (d: Drawing, width: number) => {
      const pts = d.points.map(ptPx);
      const segs: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
      if (pts.some((p) => !p)) return { pts, segs };
      const P = pts as { x: number; y: number }[];
      if (d.type === "hline") {
        segs.push([{ x: 0, y: P[0]!.y }, { x: width, y: P[0]!.y }]);
      } else if (d.type === "ray") {
        segs.push([P[0]!, P[1]!]);
      } else if (d.type === "rect") {
        const x1 = P[0]!.x, y1 = P[0]!.y, x2 = P[1]!.x, y2 = P[1]!.y;
        segs.push([{ x: x1, y: y1 }, { x: x2, y: y1 }], [{ x: x2, y: y1 }, { x: x2, y: y2 }],
                  [{ x: x2, y: y2 }, { x: x1, y: y2 }], [{ x: x1, y: y2 }, { x: x1, y: y1 }]);
      } else if (d.type === "fib") {
        const a = d.points[0]!.price, b = d.points[1]!.price;
        const xL = Math.min(P[0]!.x, P[1]!.x), xR = Math.max(P[0]!.x, P[1]!.x);
        for (const lvl of FIB_LEVELS) {
          const y = yFor(a - (a - b) * lvl);
          if (y == null) continue;
          segs.push([{ x: xL, y }, { x: xR, y }]);
        }
      } else {
        for (let i = 0; i < P.length - 1; i++) segs.push([P[i]!, P[i + 1]!]);
      }
      return { pts, segs };
    },
    [ptPx, yFor],
  );

  const findAt = useCallback(
    (x: number, y: number) => {
      const w = overlayRef.current?.clientWidth ?? 0;
      const touch = lastPointerTypeRef.current === "touch";
      const anchorTolerance = touch ? 18 : 7;
      const bodyTolerance = touch ? 14 : 6;
      const list = S.current.drawings;
      for (let i = list.length - 1; i >= 0; i--) {
        const d = list[i]!;
        const { pts, segs } = segmentsFor(d, w);
        for (let k = 0; k < pts.length; k++) {
          const p = pts[k];
          if (p && Math.hypot(x - p.x, y - p.y) <= anchorTolerance) return { drawing: d, mode: "anchor" as const, anchorIdx: k };
        }
        for (const [a, b] of segs) if (distToSeg(x, y, a.x, a.y, b.x, b.y) <= bodyTolerance) return { drawing: d, mode: "body" as const };
      }
      return null;
    },
    [segmentsFor],
  );

  /* ---------------- overlay painting ---------------- */
  const renderOverlay = useCallback(() => {
    const cv = overlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const dec = S.current.decimals;

    const paint = (d: Drawing, preview: boolean) => {
      const P = d.points.map(ptPx);
      const base = preview ? "#5b6670" : d.color;
      const active = !preview && (d.id === S.current.selectedId || d.id === S.current.hoverId);
      ctx.save();
      ctx.strokeStyle = base;
      ctx.fillStyle = base;
      ctx.lineWidth = d.width + (active ? 0.8 : 0);
      ctx.font = "10px ui-monospace, monospace";
      const line = (a: any, b: any) => {
        if (!a || !b) return;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      };
      switch (d.type) {
        case "trendline":
        case "arrow":
        case "ray": {
          if (!P[0] || !P[1]) break;
          line(P[0], P[1]);
          if (d.type === "arrow" || d.type === "ray") {
            const ang = Math.atan2(P[1]!.y - P[0]!.y, P[1]!.x - P[0]!.x);
            ctx.beginPath();
            ctx.moveTo(P[1]!.x, P[1]!.y);
            ctx.lineTo(P[1]!.x - 10 * Math.cos(ang - 0.4), P[1]!.y - 10 * Math.sin(ang - 0.4));
            ctx.moveTo(P[1]!.x, P[1]!.y);
            ctx.lineTo(P[1]!.x - 10 * Math.cos(ang + 0.4), P[1]!.y - 10 * Math.sin(ang + 0.4));
            ctx.stroke();
          }
          break;
        }
        case "hline": {
          if (!P[0]) break;
          line({ x: 0, y: P[0]!.y }, { x: w, y: P[0]!.y });
          ctx.fillText(fmt(d.points[0]!.price, dec), 6, P[0]!.y - 4);
          break;
        }
        case "rect": {
          if (!P[0] || !P[1]) break;
          const x = Math.min(P[0]!.x, P[1]!.x), y = Math.min(P[0]!.y, P[1]!.y);
          const rw = Math.abs(P[1]!.x - P[0]!.x), rh = Math.abs(P[1]!.y - P[0]!.y);
          ctx.fillStyle = withAlpha(base, 0.12);
          ctx.fillRect(x, y, rw, rh);
          ctx.strokeRect(x, y, rw, rh);
          break;
        }
        case "fib": {
          if (!P[0] || !P[1]) break;
          const a = d.points[0]!.price, b = d.points[1]!.price;
          const xL = Math.min(P[0]!.x, P[1]!.x), xR = Math.max(P[0]!.x, P[1]!.x);
          for (const lvl of FIB_LEVELS) {
            const price = a - (a - b) * lvl;
            const y = yFor(price);
            if (y == null) continue;
            ctx.setLineDash(lvl === 0 || lvl === 1 ? [] : [4, 3]);
            ctx.strokeStyle = lvl === 0 || lvl === 1 ? "#8b95a1" : base;
            line({ x: xL, y }, { x: xR, y });
            ctx.setLineDash([]);
            ctx.fillStyle = base;
            ctx.textAlign = "left";
            ctx.fillText(`${lvl.toFixed(3)}  ${fmt(price, dec)}`, xR + 5, y + 3);
          }
          break;
        }
        case "measure": {
          if (!P[0] || !P[1]) break;
          ctx.setLineDash([4, 3]);
          line(P[0], P[1]);
          ctx.setLineDash([]);
          const p1 = d.points[0]!, p2 = d.points[1]!;
          const dP = p2.price - p1.price;
          const pct = (dP / p1.price) * 100;
          const i1 = S.current.timeIndex.get(p1.time);
          const i2 = S.current.timeIndex.get(p2.time);
          const bars = i1 != null && i2 != null ? Math.abs(i2 - i1) : "?";
          const mx = (P[0]!.x + P[1]!.x) / 2, my = (P[0]!.y + P[1]!.y) / 2;
          const t1 = `${dP >= 0 ? "+" : ""}${fmt(dP, dec)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
          const t2 = `${bars} bars`;
          ctx.font = "11px ui-monospace, monospace";
          const bw = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 16;
          ctx.fillStyle = dP >= 0 ? withAlpha(UP, 0.92) : withAlpha(DOWN, 0.92);
          ctx.fillRect(mx - bw / 2, my - 20, bw, 34);
          ctx.fillStyle = "#fff";
          ctx.textAlign = "center";
          ctx.fillText(t1, mx, my - 6);
          ctx.fillText(t2, mx, my + 10);
          break;
        }
      }
      ctx.restore();
    };

    if (S.current.showDrawings) {
      for (const d of S.current.drawings) paint(d, false);
      // anchor handles for selected / hovered
      for (const d of S.current.drawings) {
        if (d.id !== S.current.selectedId && d.id !== S.current.hoverId) continue;
        for (const p of d.points.map(ptPx)) {
          if (!p) continue;
          ctx.save();
          ctx.fillStyle = d.id === S.current.selectedId ? "#ffffff" : "rgba(255,255,255,.6)";
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    if (S.current.pending.length) {
      paint({ id: -1, type: S.current.activeTool, points: S.current.pending, color: ACCENT, width: 1.5 }, true);
      for (const p of S.current.pending.map(ptPx)) {
        if (!p) continue;
        ctx.beginPath();
        ctx.fillStyle = ACCENT;
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [ptPx, yFor]);

  /* ---------------- chart lifecycle (recreated when entering/leaving fullscreen) ---------------- */
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8b95a1", fontSize: 11 },
      grid: { vertLines: { color: "rgba(128,140,155,.10)" }, horzLines: { color: "rgba(128,140,155,.10)" } },
      rightPriceScale: { borderColor: "rgba(128,140,155,.22)", scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderColor: "rgba(128,140,155,.22)", rightOffset: 4, rightBarStaysOnScroll: true },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#5b6670", style: LineStyle.Dashed, labelBackgroundColor: "#2b2f36" },
        horzLine: { color: "#5b6670", style: LineStyle.Dashed, labelBackgroundColor: "#2b2f36" },
      },
      // Wheel zooms in/out around the cursor for a closer look at the trend;
      // left-press-and-drag scrolls back through history / forward to the present.
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    });
    chartRef.current = chart;
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "volume" });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volRef.current = vol;

    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      chart.resize(r.width, r.height);
      const cv = overlayRef.current;
      if (cv) {
        const dpr = window.devicePixelRatio || 1;
        cv.width = r.width * dpr;
        cv.height = r.height * dpr;
        cv.style.width = `${r.width}px`;
        cv.style.height = `${r.height}px`;
        cv.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      renderOverlay();
    });
    ro.observe(host);

    const onRange = () => renderOverlay();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const onCross = (param: any) => {
      const idx = param?.time != null ? S.current.timeIndex.get(param.time as number) : undefined;
      setHoverIndex(idx ?? null);
    };
    chart.subscribeCrosshairMove(onCross);

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onCross);
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      volRef.current = null;
      maRef.current = null;
    };
  }, [isFullscreen, renderOverlay]);

  /* ---------------- series data ---------------- */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (mainRef.current) {
      chart.removeSeries(mainRef.current);
      mainRef.current = null;
    }
    if (maRef.current) {
      chart.removeSeries(maRef.current);
      maRef.current = null;
    }
    const closes = data.map((d) => ({ time: d.time as UTCTimestamp, value: d.close }));
    if (chartType === "candles") {
      const s = chart.addCandlestickSeries({
        upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      });
      s.setData(data.map((d) => ({ time: d.time as UTCTimestamp, open: d.open, high: d.high, low: d.low, close: d.close })));
      mainRef.current = s;
    } else if (chartType === "area") {
      const s = chart.addAreaSeries({ lineColor: color, topColor: withAlpha(color, 0.35), bottomColor: withAlpha(color, 0), lineWidth: 2 });
      s.setData(closes);
      mainRef.current = s;
    } else {
      const s = chart.addLineSeries({ color, lineWidth: 2, lineType: LineType.Simple });
      s.setData(closes);
      mainRef.current = s;
    }
    if (showMA) {
      const ma = chart.addLineSeries({ color: "#eab308", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
      ma.setData(data.filter((d) => d.ma != null).map((d) => ({ time: d.time as UTCTimestamp, value: d.ma! })));
      maRef.current = ma;
    }
    volRef.current?.setData(
      showVolume
        ? data.map((d) => ({ time: d.time as UTCTimestamp, value: d.volume, color: d.close >= d.open ? withAlpha(UP, 0.5) : withAlpha(DOWN, 0.5) }))
        : [],
    );
    chart.applyOptions({ timeScale: { timeVisible: isIntraday(timeframe), secondsVisible: false } });
    chart.timeScale().fitContent();
    renderOverlay();
  }, [data, chartType, showMA, showVolume, color, timeframe, isFullscreen, renderOverlay]);

  /* Repaint the vector layer whenever anything visual about it changes. */
  useEffect(() => {
    renderOverlay();
  }, [drawings, pending, selectedId, hoverId, showDrawings, renderOverlay]);

  /* Drawings are anchored to bar timestamps — drop them when the series changes shape. */
  useEffect(() => {
    setDrawings([]);
    setPending([]);
    setSelectedId(null);
    undoRef.current = [];
    redoRef.current = [];
  }, [timeframe, seed]);

  useEffect(() => setPending([]), [activeTool]);

  /* ---------------- pointer interaction (mouse, touch and pen alike) ---------------- */
  const local = (e: PointerEvent | React.PointerEvent) => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const commitPoint = useCallback(
    (x: number, y: number) => {
      const tool = S.current.activeTool;
      const need = REQUIRED_POINTS[tool];
      if (!need) return;
      const p = pxToPoint(x, y);
      if (!p) return;
      const next = [...S.current.pending, { time: p.time, price: p.price }];
      if (next.length >= need) {
        pushUndo();
        const id = drawIdRef.current++;
        setDrawings((d) => [...d, { id, type: tool, points: next, color: ACCENT, width: 1.5 }]);
        setPending([]);
        setSelectedId(id);
        setActiveTool("cursor");
      } else {
        setPending(next);
      }
    },
    [pxToPoint, pushUndo],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const onDragMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = local(e);
      const cur = pxToPoint(x, y);
      if (!cur) return;
      if (!drag.moved) {
        drag.moved = true;
        undoRef.current.push(drag.snapshot);
        redoRef.current = [];
      }
      setDrawings((list) =>
        list.map((d) => {
          if (d.id !== drag.id) return d;
          if (drag.mode === "anchor") {
            const pts = d.points.map((p, i) => (i === drag.anchorIdx ? { time: cur.time, price: cur.price } : p));
            return { ...d, points: pts };
          }
          const dIdx = cur.idx - drag.start.idx;
          const dPrice = cur.rawPrice - (drag.start as any).rawPrice;
          const arr = S.current.data;
          return {
            ...d,
            points: drag.startPoints.map((p) => {
              const i0 = S.current.timeIndex.get(p.time);
              const ni = i0 == null ? null : Math.max(0, Math.min(arr.length - 1, i0 + dIdx));
              return { time: ni == null ? p.time : arr[ni]!.time, price: p.price + dPrice };
            }),
          };
        }),
      );
    };
    const onDragEnd = () => {
      dragRef.current = null;
      host.style.cursor = "";
      window.removeEventListener("pointermove", onDragMove, true);
      window.removeEventListener("pointerup", onDragEnd, true);
      window.removeEventListener("pointercancel", onDragEnd, true);
    };

    /** Long-press on touch opens the same menu a right-click does on desktop. */
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    const clearLongPress = () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      lastPointerTypeRef.current = e.pointerType;
      setCtxMenu(null);
      const { x, y } = local(e);
      const tool = S.current.activeTool;

      if (e.pointerType === "touch") {
        clearLongPress();
        longPressTimer = setTimeout(() => {
          const found = S.current.showDrawings && !S.current.locked ? findAt(x, y) : null;
          if (found) setSelectedId(found.drawing.id);
          setCtxMenu({ x: e.clientX, y: e.clientY, onDrawing: !!found });
        }, 550);
      }

      if (REQUIRED_POINTS[tool]) {
        e.preventDefault();
        e.stopPropagation();
        commitPoint(x, y);
        return;
      }
      if (tool !== "cursor" || S.current.locked || !S.current.showDrawings) return;
      const found = findAt(x, y);
      if (!found) {
        setSelectedId(null);
        return; // fall through so the chart pans
      }
      e.preventDefault();
      e.stopPropagation();
      clearLongPress();
      const start = pxToPoint(x, y);
      if (!start) return;
      setSelectedId(found.drawing.id);
      dragRef.current = {
        id: found.drawing.id,
        mode: found.mode,
        anchorIdx: found.anchorIdx,
        start: start as any,
        startPoints: found.drawing.points.map((p) => ({ ...p })),
        snapshot: cloneList(S.current.drawings),
        moved: false,
      };
      host.style.cursor = found.mode === "anchor" ? "grabbing" : "move";
      window.addEventListener("pointermove", onDragMove, true);
      window.addEventListener("pointerup", onDragEnd, true);
      window.addEventListener("pointercancel", onDragEnd, true);
    };

    const onMove = (e: PointerEvent) => {
      lastPointerTypeRef.current = e.pointerType;
      if (e.pointerType === "touch") clearLongPress();
      if (dragRef.current) return;
      const { x, y } = local(e);
      if (REQUIRED_POINTS[S.current.activeTool]) {
        if (S.current.pending.length) renderOverlay();
        return;
      }
      if (S.current.activeTool !== "cursor") return;
      const found = S.current.showDrawings && !S.current.locked ? findAt(x, y) : null;
      host.style.cursor = found ? (found.mode === "anchor" ? "grab" : "move") : "";
      const id = found ? found.drawing.id : null;
      setHoverId((prev) => (prev === id ? prev : id));
    };

    const onUp = () => clearLongPress();

    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      const { x, y } = local(e as unknown as PointerEvent);
      const found = S.current.showDrawings && !S.current.locked ? findAt(x, y) : null;
      if (found) setSelectedId(found.drawing.id);
      setCtxMenu({ x: e.clientX, y: e.clientY, onDrawing: !!found });
    };

    const onDbl = () => {
      chartRef.current?.timeScale().fitContent();
    };

    host.addEventListener("pointerdown", onDown, true);
    host.addEventListener("pointermove", onMove, true);
    host.addEventListener("pointerup", onUp, true);
    host.addEventListener("pointercancel", onUp, true);
    host.addEventListener("contextmenu", onCtx);
    host.addEventListener("dblclick", onDbl);
    return () => {
      clearLongPress();
      host.removeEventListener("pointerdown", onDown, true);
      host.removeEventListener("pointermove", onMove, true);
      host.removeEventListener("pointerup", onUp, true);
      host.removeEventListener("pointercancel", onUp, true);
      host.removeEventListener("contextmenu", onCtx);
      host.removeEventListener("dblclick", onDbl);
      window.removeEventListener("pointermove", onDragMove, true);
      window.removeEventListener("pointerup", onDragEnd, true);
      window.removeEventListener("pointercancel", onDragEnd, true);
    };
  }, [isFullscreen, commitPoint, findAt, pxToPoint, renderOverlay]);

  /* ---------------- actions ---------------- */
  const deleteSelected = useCallback(() => {
    if (S.current.selectedId == null) return;
    pushUndo();
    setDrawings((l) => l.filter((d) => d.id !== S.current.selectedId));
    setSelectedId(null);
  }, [pushUndo]);

  const duplicateSelected = useCallback(() => {
    const src = S.current.drawings.find((d) => d.id === S.current.selectedId);
    if (!src) return;
    pushUndo();
    const arr = S.current.data;
    const id = drawIdRef.current++;
    setDrawings((l) => [
      ...l,
      {
        ...src,
        id,
        points: src.points.map((p) => {
          const i = S.current.timeIndex.get(p.time);
          const ni = i == null ? null : Math.min(arr.length - 1, i + 4);
          return { time: ni == null ? p.time : arr[ni]!.time, price: p.price };
        }),
      },
    ]);
    setSelectedId(id);
  }, [pushUndo]);

  const restyle = useCallback(
    (patch: Partial<Pick<Drawing, "color" | "width">>) => {
      if (S.current.selectedId == null) return;
      pushUndo();
      setDrawings((l) => l.map((d) => (d.id === S.current.selectedId ? { ...d, ...patch } : d)));
    },
    [pushUndo],
  );

  const clearDrawings = useCallback(() => {
    if (!S.current.drawings.length) return flash("No drawings to remove");
    pushUndo();
    setDrawings([]);
    setSelectedId(null);
    setPending([]);
  }, [pushUndo, flash]);

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        setCtxMenu(null);
        if (S.current.pending.length) {
          setPending([]);
          setActiveTool("cursor");
        } else if (S.current.selectedId != null) setSelectedId(null);
        else if (isFullscreen) setIsFullscreen(false);
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? doRedo() : doUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod) return;
      if ((e.key === "Delete" || e.key === "Backspace") && S.current.selectedId != null) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (!isFullscreen) return; // single-key tool shortcuts only inside the terminal
      const k = e.key.toLowerCase();
      if (k === "m") { setMagnet((v) => !v); return; }
      if (k === "t") { setActiveTool("trendline"); return; }
      if (k === "h") { setActiveTool("hline"); return; }
      if (k === "f") { setActiveTool("fib"); return; }
      if (k === "r") { setActiveTool("measure"); return; }
      if (k === "a") { setActiveTool("arrow"); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen, doUndo, doRedo, deleteSelected, duplicateSelected]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  /* ---------------- watchlist ---------------- */
  const filteredWatchlist = useMemo(() => {
    const q = watchQuery.trim().toLowerCase();
    let list = watchlist.filter((w) => !q || w.sym.toLowerCase().includes(q) || w.name.toLowerCase().includes(q));
    if (watchSort) list = [...list].sort((a, b) => (watchSort === "desc" ? b.changePct - a.changePct : a.changePct - b.changePct));
    return list;
  }, [watchlist, watchQuery, watchSort]);

  const groupedWatchlist = useMemo(() => {
    const groups: { label: string; items: WatchlistItem[] }[] = [];
    for (const item of filteredWatchlist) {
      const label = item.group ?? "Watchlist";
      let g = groups.find((x) => x.label === label);
      if (!g) groups.push((g = { label, items: [] }));
      g.items.push(item);
    }
    return groups;
  }, [filteredWatchlist]);

  const TOOLS: { key: Tool; icon: string; label: string }[] = [
    { key: "cursor", icon: "fa-arrow-pointer", label: "Cursor — select & drag drawings" },
    { key: "crosshair", icon: "fa-crosshairs", label: "Crosshair" },
    { key: "trendline", icon: "fa-slash", label: "Trend Line (T)" },
    { key: "ray", icon: "fa-arrow-right-long", label: "Arrow" },
    { key: "hline", icon: "fa-grip-lines", label: "Horizontal Line (H)" },
    { key: "rect", icon: "fa-vector-square", label: "Rectangle" },
    { key: "fib", icon: "fa-layer-group", label: "Fibonacci Retracement (F)" },
    { key: "arrow", icon: "fa-location-arrow", label: "Arrow" },
    { key: "measure", icon: "fa-ruler", label: "Measure (R)" },
  ];

  const selected = drawings.find((d) => d.id === selectedId) ?? null;

  /* ---------------- render pieces ---------------- */
  const header = (
    <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-2xl font-bold text-foreground">{fmt(lastPrice, decimals)}</span>
        <span className={`font-mono text-xs font-bold ${up ? "text-up" : "text-down"}`}>
          {up ? "+" : ""}
          {changePct.toFixed(2)}% ({timeframe})
        </span>
      </div>
      {readout && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
          <span>O <span className="text-foreground">{fmt(readout.open, decimals)}</span></span>
          <span>H <span className="text-foreground">{fmt(readout.high, decimals)}</span></span>
          <span>L <span className="text-foreground">{fmt(readout.low, decimals)}</span></span>
          <span>C <span className={readout.close >= readout.open ? "text-up" : "text-down"}>{fmt(readout.close, decimals)}</span></span>
          <span>Vol <span className="text-foreground">{fmtInt(readout.volume)}</span></span>
        </div>
      )}
    </div>
  );

  const controls = (
    <div className="mb-3 space-y-2">
      {/* Row 1 — timeframes */}
      <div className={`flex flex-wrap gap-1 ${isFullscreen ? "hidden" : ""}`}>
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => setTimeframe(tf)}
            className={`rounded border px-2 py-1 font-mono text-xs transition-colors ${
              tf === timeframe
                ? "border-primary bg-primary font-bold text-primary-foreground"
                : "border-border bg-secondary/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            {tf === "ALL" ? "2Y" : tf}
          </button>
        ))}
      </div>
      {/* Row 2 — chart type + indicators */}
      <div className="flex flex-wrap items-center gap-1">
        <div className="flex gap-1 border-r border-border pr-2">
          {([
            { key: "candles", icon: "fa-chart-column", label: "Candles" },
            { key: "area", icon: "fa-chart-area", label: "Area" },
            { key: "line", icon: "fa-chart-line", label: "Line" },
          ] as const).map((opt) => (
            <HoverTip key={opt.key} label={opt.label}>
              <button
                type="button"
                onClick={() => setChartType(opt.key)}
                aria-label={opt.label}
                className={`flex h-7 w-7 items-center justify-center rounded border text-xs transition-colors ${
                  chartType === opt.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                <i className={`fa-solid ${opt.icon}`} />
              </button>
            </HoverTip>
          ))}
        </div>
        <HoverTip label={showMA ? `Hide ${MA_WINDOW}-period moving average` : `Show ${MA_WINDOW}-period moving average`}>
          <button
            type="button"
            onClick={() => setShowMA((v) => !v)}
            className={`rounded border px-2 py-1 font-mono text-xs font-semibold transition-colors ${
              showMA ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            MA{MA_WINDOW}
          </button>
        </HoverTip>
        <HoverTip label={showVolume ? "Hide volume" : "Show volume"}>
          <button
            type="button"
            onClick={() => setShowVolume((v) => !v)}
            className={`rounded border px-2 py-1 font-mono text-xs font-semibold transition-colors ${
              showVolume ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            Vol
          </button>
        </HoverTip>
        {!isFullscreen && (
          <HoverTip label="Full screen">
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              aria-label="Full screen"
              className="flex h-7 w-7 items-center justify-center rounded border border-border bg-secondary/40 text-muted-foreground transition-colors hover:text-foreground"
            >
              <i className="fa-solid fa-expand" />
            </button>
          </HoverTip>
        )}
      </div>
    </div>
  );

  const chartPane = (
    <div className="relative min-h-0 flex-1">
      <div ref={hostRef} className="absolute inset-0 touch-none" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" />
      {selected && isFullscreen && (
        <div
          className="absolute left-2 top-2 z-40 flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2 py-1.5 shadow-xl backdrop-blur"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => restyle({ color: c })}
              className={`h-3.5 w-3.5 rounded-[3px] border border-white/20 transition-transform hover:scale-125 ${
                selected.color.toLowerCase() === c.toLowerCase() ? "ring-2 ring-white" : ""
              }`}
              style={{ background: c }}
            />
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => restyle({ width: w })}
              className={`flex h-5 w-6 items-center justify-center rounded font-mono text-[10px] transition-colors ${
                selected.width === w ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {w}
            </button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <HoverTip label="Duplicate (Ctrl+D)">
            <button type="button" onClick={duplicateSelected} className="flex h-5 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
              <i className="fa-regular fa-clone text-[10px]" />
            </button>
          </HoverTip>
          <HoverTip label="Delete (Del)">
            <button type="button" onClick={deleteSelected} className="flex h-5 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
              <i className="fa-solid fa-trash text-[10px]" />
            </button>
          </HoverTip>
        </div>
      )}
      {toast && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );

  const contextMenu =
    ctxMenu &&
    createPortal(
      <div
        className="fixed z-[300] min-w-[196px] rounded-lg border border-border bg-card p-1 shadow-2xl"
        style={{ left: Math.min(ctxMenu.x, window.innerWidth - 210), top: Math.min(ctxMenu.y, window.innerHeight - 260) }}
        onClick={(e) => e.stopPropagation()}
      >
        {ctxMenu.onDrawing && (
          <>
            <MenuItem icon="fa-trash" label="Remove drawing" hint="Del" onClick={() => { deleteSelected(); setCtxMenu(null); }} />
            <MenuItem icon="fa-clone" label="Duplicate" hint="Ctrl+D" onClick={() => { duplicateSelected(); setCtxMenu(null); }} />
            <MenuItem
              icon="fa-arrow-up"
              label="Bring to front"
              onClick={() => {
                pushUndo();
                setDrawings((l) => { const i = l.findIndex((d) => d.id === selectedId); if (i < 0) return l; const c = [...l]; c.push(c.splice(i, 1)[0]!); return c; });
                setCtxMenu(null);
              }}
            />
            <div className="my-1 h-px bg-border" />
          </>
        )}
        <MenuItem icon="fa-magnet" label={magnet ? "Turn magnet off" : "Turn magnet on"} hint="M" onClick={() => { setMagnet((v) => !v); setCtxMenu(null); }} />
        <MenuItem icon="fa-expand" label="Fit chart to data" onClick={() => { chartRef.current?.timeScale().fitContent(); setCtxMenu(null); }} />
        <MenuItem icon="fa-arrows-up-down" label="Auto-fit price scale" onClick={() => { chartRef.current?.priceScale("right").applyOptions({ autoScale: true }); setCtxMenu(null); }} />
        <div className="my-1 h-px bg-border" />
        <MenuItem icon="fa-rotate-left" label="Undo" hint="Ctrl+Z" onClick={() => { doUndo(); setCtxMenu(null); }} />
        <MenuItem icon="fa-eraser" label="Remove all drawings" onClick={() => { clearDrawings(); setCtxMenu(null); }} />
      </div>,
      document.body,
    );

  if (!isFullscreen) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        {controls}
        {chartPane}
        {contextMenu}
      </div>
    );
  }

  const toolbarButtons = (
    <>
      {TOOLS.map((t) => (
        <ToolBtn
          key={t.key}
          icon={t.icon}
          label={t.label}
          active={activeTool === t.key}
          onClick={() => {
            setActiveTool(t.key);
            setMobilePanel("none");
          }}
        />
      ))}
      <div className="my-2 h-px w-6 bg-border" />
      <ToolBtn icon="fa-magnet" label={magnet ? "Magnet on — snaps to OHLC (M)" : "Magnet off (M)"} active={magnet} onClick={() => setMagnet((v) => !v)} />
      <ToolBtn icon="fa-rotate-left" label="Undo (Ctrl+Z)" onClick={doUndo} disabled={!undoRef.current.length} />
      <ToolBtn icon="fa-rotate-right" label="Redo (Ctrl+Shift+Z)" onClick={doRedo} disabled={!redoRef.current.length} />
      <div className="flex-1" />
      <ToolBtn icon={showDrawings ? "fa-eye" : "fa-eye-slash"} label={showDrawings ? "Hide drawings" : "Show drawings"} active={showDrawings} onClick={() => setShowDrawings((v) => !v)} />
      <ToolBtn icon={locked ? "fa-lock" : "fa-lock-open"} label={locked ? "Unlock drawings" : "Lock drawings"} active={locked} onClick={() => setLocked((v) => !v)} />
      <ToolBtn icon="fa-trash" label="Remove all drawings" onClick={clearDrawings} disabled={!drawings.length} />
    </>
  );

  const watchlistPanel = (
    <>
      <div className="shrink-0 border-b border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-foreground">Watchlist</span>
          <HoverTip label={watchSort === "desc" ? "Sorted: top gainers first" : watchSort === "asc" ? "Sorted: top losers first" : "Sort by change"} side="right">
            <button
              type="button"
              onClick={() => setWatchSort((s) => (s === null ? "desc" : s === "desc" ? "asc" : null))}
              aria-label="Sort watchlist by change"
              className={`flex h-7 w-7 items-center justify-center rounded border text-xs transition-colors ${
                watchSort ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              <i className={`fa-solid text-[10px] ${watchSort === "asc" ? "fa-arrow-up-short-wide" : watchSort === "desc" ? "fa-arrow-down-wide-short" : "fa-sort"}`} />
            </button>
          </HoverTip>
        </div>
        <input
          type="text"
          value={watchQuery}
          onChange={(e) => setWatchQuery(e.target.value)}
          placeholder="Search symbol..."
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groupedWatchlist.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">No symbols found.</p>}
        {groupedWatchlist.map((group) => (
          <div key={group.label} className="mb-3">
            <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{group.label}</div>
            {group.items.map((item) => {
              const isActive = item.sym === symbol;
              const itemUp = item.changePct >= 0;
              return (
                <HoverTip key={item.sym} label={item.name} side="top">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectSymbol?.(item);
                      setMobilePanel("none");
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${isActive ? "bg-primary/10" : "hover:bg-secondary/60"}`}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
                      style={{ backgroundColor: `${item.color}20`, color: item.color }}
                    >
                      {item.sym.slice(0, 2)}
                    </span>
                    <span className={`truncate text-xs font-semibold ${isActive ? "text-primary" : "text-foreground"}`}>{item.sym}</span>
                    <span className="ml-auto text-right">
                      <span className="block font-mono text-xs text-foreground">{item.price}</span>
                      <span className={`block font-mono text-[10px] font-semibold ${itemUp ? "text-up" : "text-down"}`}>
                        {itemUp ? "+" : ""}
                        {item.changePct.toFixed(2)}%
                      </span>
                    </span>
                  </button>
                </HoverTip>
              );
            })}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up shadow-[0_0_5px_var(--up)]" />
          <span className="font-medium text-foreground">{marketStatusLabel}</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-mono text-xl font-bold text-foreground">{fmt(lastPrice, decimals)}</span>
          <span className={`font-mono text-xs font-bold ${up ? "text-up" : "text-down"}`}>
            {up ? "+" : ""}
            {changePct.toFixed(2)}%
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {perf.map((p) => (
            <PerfTile key={p.tf} label={p.tf} pct={p.pct} />
          ))}
        </div>
      </div>
    </>
  );

  return createPortal(
    <div className="fixed inset-0 z-[250] flex overflow-hidden bg-background">
      {/* Left drawing toolbar — desktop only; mobile gets a slide-in drawer below */}
      <div className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-card/60 py-4 lg:flex">
        {toolbarButtons}
      </div>

      {/* Center */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5 sm:px-5 sm:py-3">
          <button
            type="button"
            onClick={() => setMobilePanel((p) => (p === "tools" ? "none" : "tools"))}
            aria-label="Drawing tools"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-sm transition-colors lg:hidden ${
              mobilePanel === "tools" ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            <i className="fa-solid fa-pencil" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="shrink-0 text-base font-bold text-foreground sm:text-lg">{symbol ?? seed}</span>
            {name && <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">{name}</span>}
            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">{exchange}</span>
            <span className="mx-1 hidden h-4 w-px shrink-0 bg-border sm:block" />
            <div className="hidden shrink-0 gap-1 sm:flex">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={`rounded border px-2 py-1 font-mono text-xs transition-colors ${
                    tf === timeframe
                      ? "border-primary bg-primary font-bold text-primary-foreground"
                      : "border-border bg-secondary/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {tf === "ALL" ? "2Y" : tf}
                </button>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Watchlist button disabled on mobile full screen as requested */}
            <button
              type="button"
              onClick={() => setMobilePanel((p) => (p === "watchlist" ? "none" : "watchlist"))}
              aria-label="Watchlist"
              className={`hidden h-8 w-8 items-center justify-center rounded-md border text-sm transition-colors lg:hidden ${
                mobilePanel === "watchlist" ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary"
              }`}
            >
              <i className="fa-solid fa-list-ul" />
            </button>
            <HoverTip label="Exit full screen (Esc)">
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                aria-label="Exit full screen"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </HoverTip>
          </div>
        </div>

        {/* Timeframe row — its own line on mobile, where the title bar has no room for it */}
        <div className="flex shrink-0 gap-1 overflow-x-auto no-scrollbar border-b border-border px-3 py-2 sm:hidden">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`shrink-0 rounded border px-2.5 py-1 font-mono text-xs transition-colors ${
                tf === timeframe
                  ? "border-primary bg-primary font-bold text-primary-foreground"
                  : "border-border bg-secondary/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {tf === "ALL" ? "2Y" : tf}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-5">
          {header}
          {controls}
          {chartPane}
        </div>
      </div>

      {/* Right: watchlist + performance — desktop only; mobile gets a slide-in drawer below */}
      <div className="hidden w-80 shrink-0 flex-col border-l border-border bg-card/40 lg:flex">{watchlistPanel}</div>

      {/* Mobile drawers */}
      {mobilePanel !== "none" && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobilePanel("none")} />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-50 flex w-16 -translate-x-full flex-col items-center gap-1 border-r border-border bg-card py-4 shadow-2xl transition-transform duration-200 lg:hidden ${
          mobilePanel === "tools" ? "translate-x-0" : ""
        }`}
      >
        {toolbarButtons}
      </div>
      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-[85vw] max-w-xs translate-x-full flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200 lg:hidden ${
          mobilePanel === "watchlist" ? "translate-x-0" : ""
        }`}
      >
        {watchlistPanel}
      </div>
      {contextMenu}
    </div>,
    document.body,
  );
}

function MenuItem({ icon, label, hint, onClick }: { icon: string; label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-foreground transition-colors hover:bg-secondary"
    >
      <i className={`fa-solid ${icon} w-3.5 text-[11px] text-muted-foreground`} />
      <span>{label}</span>
      {hint && <span className="ml-auto font-mono text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  );
}
