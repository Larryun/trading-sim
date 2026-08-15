import { useEffect, useRef, useState } from 'react';

/**
 * Measure a container's width via a single ResizeObserver (disconnected on
 * unmount). Used by the hand-rolled SVG charts so we don't depend on a charting
 * library that retains memory across the tens of thousands of re-renders a long
 * live session produces.
 */
export function useContainerWidth(initial = 800) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
