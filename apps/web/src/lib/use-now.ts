'use client';

import { useEffect, useState } from 'react';

/** The current time, refreshed every `ms`: for "12 s ago" labels that stay true. */
export function useNow(ms = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
