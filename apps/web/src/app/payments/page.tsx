'use client';

import { Suspense } from 'react';
import { PaymentsTable } from '@/components/payments/payments-table';
import { Skeleton } from '@/components/ui/skeleton';
import { useStats } from '@/lib/queries';

function Header() {
  const stats = useStats();
  return (
    <header>
      <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-ink">Payments</h1>
      <p className="mt-1 text-sm text-ink-2">
        {stats.data
          ? `${stats.data.total.toLocaleString('en-US')} payments, newest first. Rows update live as payments move through their lifecycle.`
          : 'Newest first. Rows update live as payments move through their lifecycle.'}
      </p>
    </header>
  );
}

export default function PaymentsPage() {
  return (
    <div className="space-y-6">
      <Header />
      <Suspense fallback={<Skeleton className="h-[480px] rounded-panel" />}>
        <PaymentsTable />
      </Suspense>
    </div>
  );
}
