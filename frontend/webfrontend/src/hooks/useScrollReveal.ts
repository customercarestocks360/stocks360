import { useEffect, useRef, useCallback } from "react";

/**
 * useScrollReveal — Intersection Observer hook for scroll-triggered animations.
 *
 * Watches a container ref and adds `data-revealed="true"` to child elements
 * that have the `[data-reveal]` attribute when they enter the viewport.
 *
 * Usage:
 *   const containerRef = useScrollReveal();
 *   <div ref={containerRef}>
 *     <div data-reveal="fade-up">...</div>
 *     <div data-reveal="fade-left" data-delay="1">...</div>
 *   </div>
 *
 * The `data-reveal` value maps to CSS classes that define the initial hidden
 * state and the revealed transition (see styles.css for definitions).
 *
 * `data-delay` adds stagger delay (100ms increments).
 */
export function useScrollReveal(threshold = 0.12) {
  const containerRef = useRef<HTMLDivElement>(null);

  const observe = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const elements = container.querySelectorAll("[data-reveal]");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.revealed = "true";
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold, rootMargin: "0px 0px -40px 0px" },
    );

    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [threshold]);

  useEffect(() => {
    // Small delay to let the DOM paint first
    const timer = setTimeout(observe, 60);
    return () => clearTimeout(timer);
  }, [observe]);

  return containerRef;
}
