const COLORS = ["#3b82f6", "#f7931a", "#10b981", "#eab308", "#8b5cf6", "#ef4444"];

const PIECES = Array.from({ length: 70 }).map((_, i) => ({
  id: i,
  left: Math.random() * 100,
  delay: Math.random() * 0.4,
  duration: 2.2 + Math.random() * 1.4,
  drift: (Math.random() - 0.5) * 160,
  spin: 360 * (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random()),
  color: COLORS[i % COLORS.length],
  size: 6 + Math.random() * 6,
  round: Math.random() > 0.5,
}));

/** One-shot confetti burst — mount when a celebratory moment happens, unmount after ~3s. */
export function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {PIECES.map((p) => (
        <span
          key={p.id}
          className="animate-confetti-fall absolute top-0"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.round ? "9999px" : "2px",
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            // @ts-expect-error custom properties consumed by the confetti-fall keyframes
            "--confetti-drift": `${p.drift}px`,
            "--confetti-spin": `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}
