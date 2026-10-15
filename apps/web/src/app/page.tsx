'use client';

import Link from 'next/link';
import { LiveIndicator } from '@/components/live-indicator';
import { LoadSimulator } from '@/components/load-simulator';
import { PaymentsTable } from '@/components/payments-table';
import { StatsCards } from '@/components/stats-cards';
import { StatusChart } from '@/components/status-chart';
import { buttonClasses } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLiveDashboard } from '@/lib/live-sync';
import { useStats } from '@/lib/queries';

export default function DashboardPage() {
  const stream = useLiveDashboard();
  const stats = useStats();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-2">
            Payments are accepted instantly and processed in the background.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <LiveIndicator state={stream} />
          <Link href="/payments/new" className={buttonClasses()}>
            New payment
          </Link>
        </div>
      </div>

      {stats.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          Could not load statistics: {stats.error.message}
        </p>
      ) : (
        <StatsCards stats={stats.data} />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card aria-labelledby="status-heading">
          <CardHeader
            id="status-heading"
            title="Payments by status"
            description="Where every payment is in its lifecycle right now."
          />
          {stats.data ? (
            <StatusChart counts={stats.data.countsByStatus} />
          ) : (
            <Skeleton className="h-52" />
          )}
        </Card>
        <LoadSimulator />
      </div>

      <PaymentsTable />
    </div>
  );
}
