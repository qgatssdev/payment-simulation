'use client';

import { Suspense } from 'react';
import PageHeader from '@/components/layout/pageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useStats } from '@/services/stats/queries';
import { PaymentsTable } from './paymentsTable';

export default function PaymentsView() {
  const stats = useStats();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description={
          stats.data
            ? `${stats.data.total.toLocaleString('en-US')} payments, newest first. Rows update live as payments move through their lifecycle.`
            : 'Newest first. Rows update live as payments move through their lifecycle.'
        }
      />
      {/* Suspense because the table keeps its filters in the URL (useSearchParams). */}
      <Suspense fallback={<Skeleton className="h-[480px] rounded-panel" />}>
        <PaymentsTable />
      </Suspense>
    </div>
  );
}
