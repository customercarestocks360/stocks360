import { useId, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Area,
  Line,
  Bar,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { TIMEFRAMES, generateSeries, type ChartPoint, type Timeframe } from "@/lib/dummy-chart-data";

const MA_WINDOW = 5;
type ChartType = "candles" | "area" | "line";

function fmt(n: number, decimals: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Custom Bar shape drawing a wick + body from a [low, high] range value. */
function CandleShape(props: any) {
  const { x, y, width, height, payload } = props;
  const point = payload as ChartPoint;
  const isUp = point.close >= point.open;
  const color = isUp ? "var(--up)" : "var(--down)";
  const range = point.high - point.low;
  if (!range || !Number.isFinite(height)) return <g />;

  const scale = height / range;
  const bodyTopVal = Math.max(point.open, point.close);
  const bodyBotVal = Math.min(point.open, point.close);
  const bodyTop = y + (point.high - bodyTopVal) * scale;
  const bodyBottom = y + (point.high - bodyBotVal) * scale;
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1.5);
  const cx = x + width / 2;
  const bodyWidth = Math.max(width * 0.6, 2);

  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1.2} />
      <rect x={cx - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} rx={1} />
    </g>
  );
}

function ChartTooltip({ active, payload, decimals }: any) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload as ChartPoint;
  const isUp = p.close >= p.open;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] shadow-lg">
      <div className="mb-1 font-mono font-bold text-foreground">{p.label}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
        <span className="text-muted-foreground">O</span>
        <span className="text-right text-foreground">{fmt(p.open, decimals)}</span>
        <span className="text-muted-foreground">H</span>
        <span className="text-right text-foreground">{fmt(p.high, decimals)}</span>
        <span className="text-muted-foreground">L</span>
        <span className="text-right text-foreground">{fmt(p.low, decimals)}</span>
        <span className="text-muted-foreground">C</span>
        <span className={`text-right font-bold ${isUp ? "text-up" : "text-down"}`}>{fmt(p.close, decimals)}</span>
        <span className="text-muted-foreground">Vol</span>
        <span className="text-right text-foreground">{p.volume.toLocaleString()}</span>
      </div>
    </div>
  );
}

/**
 * Shared chart panel used on the Crypto/Stocks/Forex pages — same dummy OHLCV
 * generator across all three (per-symbol seed), rendered as a professional
 * candlestick/area/line chart with a synced volume pane, moving average and a
 * live OHLC readout. Fills whatever height its flex parent gives it.
 */
export function AssetChart({
  seed,
  color,
  basePrice,
}: {
  seed: string;
  color: string;
  basePrice: number;
  height?: number;
}) {
  const gradientId = useId();
  const syncId = useId();
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [showMA, setShowMA] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const data = useMemo(() => {
    const series = generateSeries(seed, timeframe, basePrice);
    return series.map((p, i) => {
      const start = Math.max(0, i - MA_WINDOW + 1);
      const slice = series.slice(start, i + 1);
      const ma = slice.reduce((sum, x) => sum + x.close, 0) / slice.length;
      return { ...p, ma };
    });
  }, [seed, timeframe, basePrice]);

  const firstPoint = data[0];
  const lastPoint = data[data.length - 1];
  const firstPrice = firstPoint?.open ?? basePrice;
  const lastPrice = lastPoint?.close ?? basePrice;
  const changePct = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const up = changePct >= 0;
  const decimals = lastPrice < 1 ? 4 : lastPrice < 100 ? 3 : 2;

  const readout = hoverIndex !== null ? data[hoverIndex] ?? lastPoint : lastPoint;

  const [yMin, yMax] = useMemo(() => {
    const lows = data.map((d) => (chartType === "candles" ? d.low : Math.min(d.close, showMA ? d.ma : d.close)));
    const highs = data.map((d) => (chartType === "candles" ? d.high : Math.max(d.close, showMA ? d.ma : d.close)));
    const min = lows.length ? Math.min(...lows) : basePrice * 0.9;
    const max = highs.length ? Math.max(...highs) : basePrice * 1.1;
    const pad = (max - min) * 0.1 || max * 0.01;
    return [min - pad, max + pad];
  }, [data, chartType, showMA, basePrice]);

  const handleMove = (state: any) => {
    if (state && typeof state.activeTooltipIndex === "number") setHoverIndex(state.activeTooltipIndex);
  };
  const handleLeave = () => setHoverIndex(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: price + live OHLCV readout */}
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
            <span>
              O <span className="text-foreground">{fmt(readout.open, decimals)}</span>
            </span>
            <span>
              H <span className="text-foreground">{fmt(readout.high, decimals)}</span>
            </span>
            <span>
              L <span className="text-foreground">{fmt(readout.low, decimals)}</span>
            </span>
            <span>
              C{" "}
              <span className={readout.close >= readout.open ? "text-up" : "text-down"}>
                {fmt(readout.close, decimals)}
              </span>
            </span>
            <span>
              Vol <span className="text-foreground">{readout.volume.toLocaleString()}</span>
            </span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`rounded border px-2 py-1 text-xs font-mono transition-colors ${
                tf === timeframe
                  ? "border-primary bg-primary text-primary-foreground font-bold"
                  : "border-border bg-secondary/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <div className="flex gap-1 border-r border-border pr-2">
            {(
              [
                { key: "candles", icon: "fa-chart-column", label: "Candles" },
                { key: "area", icon: "fa-chart-area", label: "Area" },
                { key: "line", icon: "fa-chart-line", label: "Line" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setChartType(opt.key)}
                aria-label={opt.label}
                title={opt.label}
                className={`flex h-7 w-7 items-center justify-center rounded border text-xs transition-colors ${
                  chartType === opt.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                <i className={`fa-solid ${opt.icon}`} />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowMA((v) => !v)}
            className={`rounded border px-2 py-1 text-xs font-mono font-semibold transition-colors ${
              showMA
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            MA{MA_WINDOW}
          </button>
          <button
            type="button"
            onClick={() => setShowVolume((v) => !v)}
            className={`rounded border px-2 py-1 text-xs font-mono font-semibold transition-colors ${
              showVolume
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            Vol
          </button>
        </div>
      </div>

      {/* Main price chart */}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} syncId={syncId} onMouseMove={handleMove} onMouseLeave={handleLeave} margin={{ left: -20, right: 8, top: 4 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} minTickGap={24} hide={showVolume} />
            <YAxis
              domain={[yMin, yMax]}
              stroke="var(--muted-foreground)"
              fontSize={10}
              width={56}
              tickFormatter={(v: number) => fmt(v, decimals)}
            />
            <Tooltip content={<ChartTooltip decimals={decimals} />} />

            {chartType === "candles" && (
              <Bar dataKey={(d: ChartPoint) => [d.low, d.high]} shape={CandleShape} isAnimationActive={false} />
            )}
            {chartType === "area" && (
              <Area
                type="monotone"
                dataKey="close"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
              />
            )}
            {chartType === "line" && (
              <Line type="monotone" dataKey="close" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
            )}
            {showMA && (
              <Line
                type="monotone"
                dataKey="ma"
                stroke="var(--primary)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Volume pane, synced to the main chart's crosshair */}
      {showVolume && (
        <div className="mt-1 h-16 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} syncId={syncId} onMouseMove={handleMove} onMouseLeave={handleLeave} margin={{ left: -20, right: 8, top: 0 }}>
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={9} minTickGap={24} tickLine={false} />
              <YAxis hide domain={[0, "dataMax"]} />
              <Bar dataKey="volume" isAnimationActive={false}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.close >= d.open ? "var(--up)" : "var(--down)"} fillOpacity={0.55} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
