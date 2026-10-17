'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that counts to its new value instead of jumping (about 450 ms, strong ease-out).
 * Tabular figures keep its width steady while it moves; reduced motion shows the value at once.
 */
export function NumberTicker({
  value,
  format = (n) => Math.round(n).toLocaleString('en-US'),
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const began = performance.now();
    const duration = reduce ? 0 : 450;
    const step = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - t) ** 4;
      const current = start + (value - start) * eased;
      setShown(current);
      from.current = current;
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value]);

  return <span className="tabular-nums">{format(shown)}</span>;
}
