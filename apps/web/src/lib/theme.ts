'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'auto';
const KEY = 'payment-sim:theme';

/**
 * Runs before first paint (inlined in the root layout), so a chosen theme never flashes the
 * other one. "auto" leaves the attribute off and the CSS follows prefers-color-scheme.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

const listeners = new Set<() => void>();

function read(): ThemeChoice {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'auto';
}

export function setTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'auto') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked (private mode): the choice still applies for this visit.
  }
  for (const l of listeners) l();
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => void listeners.delete(onChange);
    },
    read,
    (): ThemeChoice => 'auto',
  );
  return [choice, useCallback((c: ThemeChoice) => setTheme(c), [])];
}

/** Whether the page is currently dark, whatever made it so (choice or OS). */
export function useIsDark(): boolean {
  const [choice] = useTheme();
  const osDark = useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => false,
  );
  return choice === 'dark' || (choice === 'auto' && osDark);
}
