import { useEffect, useRef, useState, type RefObject } from 'react';
import { easeOutCubic } from './chartMath';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useContainerWidth(
  ref: RefObject<HTMLElement | null>,
  fallbackWidth = 640
): number {
  const [width, setWidth] = useState(fallbackWidth);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next > 0) {
        setWidth((prev) => (Math.abs(prev - next) >= 2 ? next : prev));
      }
    };

    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = Math.round(entry.contentRect.width);
        if (next > 0) {
          setWidth((prev) => (Math.abs(prev - next) >= 2 ? next : prev));
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

export function useAnimationProgress(triggerKey: string, durationMs = 420): number {
  const [progress, setProgress] = useState(() => (prefersReducedMotion() ? 1 : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setProgress(1);
      return;
    }

    let rafId = 0;
    const start = performance.now();
    setProgress(0);

    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      setProgress(easeOutCubic(t));
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [triggerKey, durationMs]);

  return progress;
}

export function useTweenedNumbers(targets: number[], durationMs = 300): number[] {
  const [values, setValues] = useState<number[]>(() => targets);
  const currentRef = useRef<number[]>(targets);

  const signature = targets.map((v) => v.toFixed(2)).join('|');

  useEffect(() => {
    if (prefersReducedMotion()) {
      currentRef.current = targets;
      setValues(targets);
      return;
    }

    const from =
      currentRef.current.length === targets.length
        ? currentRef.current.slice()
        : targets.map(() => 0);

    let rafId = 0;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easeOutCubic(t);
      const interpolated = targets.map((target, idx) => {
        const startVal = from[idx] ?? 0;
        return startVal + (target - startVal) * eased;
      });
      currentRef.current = interpolated;
      setValues(interpolated);
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, durationMs]);

  return values.length === targets.length ? values : targets;
}
