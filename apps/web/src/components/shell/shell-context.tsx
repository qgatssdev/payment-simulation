'use client';

import { createContext, useContext } from 'react';

export interface ShellActions {
  openNewPayment: () => void;
  openPalette: () => void;
}

export const ShellContext = createContext<ShellActions>({
  openNewPayment: () => {},
  openPalette: () => {},
});

export const useShell = () => useContext(ShellContext);
