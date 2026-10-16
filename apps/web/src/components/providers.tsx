'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';
import { LiveProvider } from '@/lib/live';
import { useIsDark } from '@/lib/theme';

function ThemedToaster() {
  const dark = useIsDark();
  return (
    <Toaster
      position="bottom-right"
      theme={dark ? 'dark' : 'light'}
      closeButton
      mobileOffset={{ bottom: 96 }}
      toastOptions={{
        classNames: {
          toast:
            '!rounded-[18px] !border-0 !bg-panel !text-ink !shadow-[var(--shadow-2)] !font-sans',
          description: '!text-ink-2',
        },
      }}
    />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            // Retry what might succeed (network, 5xx); a 404 or 400 will not change.
            retry: (failures, error) =>
              failures < 2 && !(error instanceof ApiError && !error.retryable),
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <LiveProvider>{children}</LiveProvider>
      <ThemedToaster />
    </QueryClientProvider>
  );
}
