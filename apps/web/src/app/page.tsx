'use client';

import { Suspense } from 'react';
import { ActivityFeed } from '@/components/overview/activity-feed';
import {
  AttemptsDistribution,
  FailureReasons,
  RetryOutcomes,
} from '@/components/overview/failure-insights';
import { ApprovalHero, HeadlineTiles, RANGE_COPY } from '@/components/overview/headline';
import { Pipeline } from '@/components/overview/pipeline';
import { ThroughputChart } from '@/components/overview/throughput-chart';
import { RangePicker, useRange } from '@/components/range-picker';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useInsights, useStats } from '@/lib/queries';

function Overview() {
  const [range, setRange] = useRange();
  const insights = useInsights(range);
  const stats = useStats();
  const data = insights.data;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-ink">
            Overview
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            How payments are doing in {RANGE_COPY[range]}, updating live.
          </p>
        </div>
        <RangePicker range={range} onChange={setRange} />
      </header>

      {insights.isError && !data ? (
        <Card>
          <ErrorState
            error={insights.error}
            title="Could not load the overview"
            onRetry={() => void insights.refetch()}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12 lg:gap-5">
            <div className="sm:col-span-2 lg:col-span-4">
              <ApprovalHero insights={data} range={range} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2 lg:col-span-8 lg:gap-5">
              <HeadlineTiles insights={data} />
            </div>
          </div>

          <Card aria-labelledby="pipeline-heading">
            <CardHeader
              id="pipeline-heading"
              title="Payments in each state right now"
              description="The lifecycle every payment follows. Watch payments move through it as events stream in."
            />
            {stats.isError ? (
              <ErrorState
                error={stats.error}
                title="Could not load status counts"
                onRetry={() => void stats.refetch()}
              />
            ) : (
              <Pipeline
                counts={stats.data?.countsByStatus}
                retries={data?.totals.retries}
              />
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
            <Card aria-labelledby="throughput-heading" className="lg:col-span-8">
              <CardHeader
                id="throughput-heading"
                title="Outcomes over time"
                description="Approvals above the line, failures and cancellations below it, with payments accepted traced on top."
              />
              {data ? (
                <ThroughputChart
                  buckets={data.buckets}
                  bucketMs={data.bucketMs}
                  range={range}
                  height={300}
                />
              ) : (
                <Skeleton className="h-[350px]" />
              )}
            </Card>
            <Card aria-labelledby="activity-heading" className="lg:col-span-4">
              <CardHeader id="activity-heading" title="Live activity" />
              <ActivityFeed />
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
            <Card aria-labelledby="reasons-heading" className="lg:col-span-4">
              <CardHeader
                id="reasons-heading"
                title="Why payments failed"
                description={
                  data
                    ? `${data.totals.failed.toLocaleString('en-US')} failed in ${RANGE_COPY[range]}.`
                    : undefined
                }
              />
              {data ? (
                <FailureReasons failures={data.failures} />
              ) : (
                <Skeleton className="h-48" />
              )}
            </Card>
            <Card aria-labelledby="retries-heading" className="lg:col-span-4">
              <CardHeader id="retries-heading" title="What retries rescued" />
              {data ? (
                <RetryOutcomes failures={data.failures} />
              ) : (
                <Skeleton className="h-48" />
              )}
            </Card>
            <Card
              aria-labelledby="attempts-heading"
              className="md:col-span-2 lg:col-span-4"
            >
              <CardHeader
                id="attempts-heading"
                title="Attempts per payment"
                description="Gateway calls each settled payment needed."
              />
              {data ? (
                <AttemptsDistribution failures={data.failures} />
              ) : (
                <Skeleton className="h-48" />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default function OverviewPage() {
  // The range lives in the URL; reading it needs a Suspense boundary for prerendering.
  return (
    <Suspense fallback={<Skeleton className="h-[600px] rounded-panel" />}>
      <Overview />
    </Suspense>
  );
}
