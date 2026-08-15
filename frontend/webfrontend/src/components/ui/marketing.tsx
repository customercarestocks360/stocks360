import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import SpecularButton from "@/components/ui/specular-button";

/**
 * Shared visual components for the Stocks360 marketing/product pages.
 * These implement the "obsidian terminal" design language established on
 * the homepage (src/routes/index.tsx): glow-blob cards, mock ticker panels,
 * animated counters and icon tiles. Reuse these instead of re-implementing
 * similar pieces per page so the whole site reads as one system.
 */

/* ────── Animated Counter — counts up from 0 when scrolled into view ────── */
export function AnimatedNumber({ value, suffix = "" }: { value: string; suffix?: string }) {
  const [display, setDisplay] = useState("0");
  const ref = useRef<HTMLSpanElement>(null);
  const triggered = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !triggered.current) {
          triggered.current = true;
          const numericStr = value.replace(/[^0-9.]/g, "");
          const target = parseFloat(numericStr);
          const isDecimal = numericStr.includes(".");
          const prefix = value.replace(/[0-9.,]+.*/, "");
          const duration = 1800;
          const start = performance.now();
          const animate = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 4);
            const current = target * eased;
            const formatted = isDecimal ? current.toFixed(1) : Math.floor(current).toLocaleString();
            setDisplay(prefix + formatted);
            if (progress < 1) requestAnimationFrame(animate);
          };
          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <span ref={ref}>
      {display}
      {suffix}
    </span>
  );
}

/* ────── Orbit Ring SVG — decorative ambient background motion ────── */
export function OrbitRing({
  size = 400,
  duration = 20,
  dotCount = 6,
  color = "var(--primary)",
}: {
  size?: number;
  duration?: number;
  dotCount?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="absolute opacity-20"
      style={{ animation: `spin ${duration}s linear infinite` }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={size / 2 - 2}
        fill="none"
        stroke={color}
        strokeWidth={0.5}
        strokeDasharray="4 8"
        opacity={0.4}
      />
      {Array.from({ length: dotCount }).map((_, i) => {
        const angle = (360 / dotCount) * i;
        const rad = (angle * Math.PI) / 180;
        const cx = size / 2 + (size / 2 - 2) * Math.cos(rad);
        const cy = size / 2 + (size / 2 - 2) * Math.sin(rad);
        return <circle key={i} cx={cx} cy={cy} r={2} fill={color} opacity={0.6} />;
      })}
    </svg>
  );
}

/* ────── Mini Sparkline — mock ticker/chart preview ────── */
export function MiniSparkline({
  color = "var(--up)",
  points,
  className = "h-32 w-full",
}: {
  color?: string;
  points: number[];
  /** Tailwind sizing classes for the chart's rendered box (bigger = more visible). */
  className?: string;
}) {
  const width = 320;
  const height = 140;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => `${i * step},${height - ((p - min) / range) * height}`);
  const linePath = `M${coords.join(" L")}`;
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const gradId = `spark-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`${className} overflow-visible`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-700"
      />
    </svg>
  );
}

/* ────── Icon Tile Row — colored icon chips standing in for illustrations ────── */
export function IconTileRow({ items }: { items: { icon: string; color: string }[] }) {
  return (
    <div className="flex gap-3">
      {items.map((it, i) => (
        <div
          key={it.icon}
          className="flex h-14 w-14 items-center justify-center rounded-2xl transition-transform duration-500 group-hover:-translate-y-1.5"
          style={{ backgroundColor: `${it.color}15`, color: it.color, transitionDelay: `${i * 60}ms` }}
        >
          <i className={`fa-solid ${it.icon} text-xl`} />
        </div>
      ))}
    </div>
  );
}

/* ────── Search Input — filter bar used on Stocks / Crypto / Markets list pages ────── */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <i className="fa-solid fa-magnifying-glass pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-background/60 py-2.5 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <i className="fa-solid fa-xmark text-sm" />
        </button>
      )}
    </div>
  );
}

/* ────── OTP Verification — step-two check shown after login/signup submits ──────
 * No backend exists yet, so this simulates verification against a fixed demo
 * code. Wrong codes clear the boxes and show an error; "Resend code" resets
 * the attempt and shows a confirmation toast-style line. */
export function OtpVerification({
  onBack,
  onVerified,
  correctCode = "123456",
  destination = "your registered email address",
}: {
  onBack: () => void;
  onVerified: () => void;
  correctCode?: string;
  destination?: string;
}) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState(false);
  const [justResent, setJustResent] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError(false);
    if (digit && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const code = digits.join("");
  const isComplete = code.length === 6;

  const handleVerify = () => {
    if (!isComplete) return;
    if (code === correctCode) {
      onVerified();
    } else {
      setError(true);
      setDigits(["", "", "", "", "", ""]);
      inputsRef.current[0]?.focus();
    }
  };

  const handleResend = () => {
    setError(false);
    setDigits(["", "", "", "", "", ""]);
    inputsRef.current[0]?.focus();
    setJustResent(true);
    setTimeout(() => setJustResent(false), 3000);
  };

  return (
    <div className="relative mx-auto w-full max-w-sm rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur-xl">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
        <i className="fa-solid fa-shield-halved text-base" />
      </div>

      <div className="mt-4 text-center">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Verify it's you</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Enter the 6-digit code we sent to {destination}.
        </p>
      </div>

      <div className="mt-6 flex justify-center gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            inputMode="numeric"
            maxLength={1}
            aria-invalid={error}
            className={`h-12 w-10 rounded-xl border bg-background/60 text-center text-lg font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 ${
              error
                ? "border-destructive focus-visible:ring-destructive/40"
                : "border-border focus-visible:ring-primary/40"
            }`}
          />
        ))}
      </div>

      {error && (
        <p className="mt-3 text-center text-xs font-medium text-destructive">
          That code's incorrect. Try again or resend a new one.
        </p>
      )}
      {justResent && !error && (
        <p className="mt-3 text-center text-xs font-medium text-up">A new code has been sent.</p>
      )}

      <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
        Demo code: <span className="font-mono">{correctCode}</span>
      </p>

      <SpecularButton
        type="button"
        size="lg"
        radius={16}
        tint="#000000"
        tintOpacity={1}
        blur={0}
        textColor="#ffffff"
        lineColor="#ffffff"
        baseColor="#000000"
        intensity={1}
        shineSize={10}
        shineFade={40}
        thickness={1}
        speed={0.35}
        followMouse
        proximity={250}
        autoAnimate={false}
        disabled={!isComplete}
        className="mt-6 w-full uppercase tracking-[0.2em] font-bold disabled:opacity-40"
        onClick={handleVerify}
      >
        Verify &amp; continue
      </SpecularButton>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <button type="button" onClick={onBack} className="font-medium text-primary hover:text-primary/80">
          Back
        </button>
        <button type="button" onClick={handleResend} className="font-medium text-primary hover:text-primary/80">
          Resend code
        </button>
      </div>
    </div>
  );
}

/* ────── Google "G" logomark — used by the Google sign-in button ────── */
export function GoogleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

/* ────── Testimonial Card — used on the homepage "Trusted By" wall ────── */
export function TestimonialCard({
  name,
  role,
  quote,
  delay = 0,
}: {
  name: string;
  role: string;
  quote: string;
  delay?: number;
}) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);
  return (
    <div
      data-reveal="approach"
      style={{ transitionDelay: `${delay}ms` }}
      className="group w-72 shrink-0 rounded-2xl border border-border bg-card p-5 transition-all duration-500 hover:-translate-y-1.5 hover:shadow-xl hover:border-primary/30"
    >
      <p className="text-sm leading-relaxed text-foreground line-clamp-4">&ldquo;{quote}&rdquo;</p>
      <div className="mt-4 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-foreground transition-colors duration-500 group-hover:bg-primary group-hover:text-primary-foreground">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{role}</div>
        </div>
      </div>
    </div>
  );
}
