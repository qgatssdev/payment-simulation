'use client';

import type { PaymentStreamMessage, PaymentView } from '@payment-sim/shared';
import { ErrorCode } from '@payment-sim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FlaskConical, SearchX } from 'lucide-react';
import Link from 'next/link';
import { ReasonBadge, StatusBadge } from '@/common/statusBadge';
import { LiveIndicator } from '@/components/layout/liveIndicator';
import { buttonClasses } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useEventStream } from '@/hooks/useEventStream';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { STREAM_EVENTS } from '@/providers/live.provider';
import { ApiError } from '@/services/api';
import PaymentsRoute from '@/services/payments/payments.route';
import {
  rememberEvent,
  rememberPayment,
  usePayment,
  usePaymentEvents,
  usePaymentRequest,
} from '@/services/payments/queries';
import { formatMoney } from '@/utils/format';
import { AttemptTimeline } from './attemptTimeline';
import DetailsCard from './detailsCard';
import { EventTimeline } from './eventTimeline';
import { LifecyclePath } from './lifecyclePath';
import { PaymentActions } from './paymentActions';
import RequestCard from './requestCard';

export default function PaymentDetailView({ id }: { id: string }) {
  const client = useQueryClient();
  const payment = usePayment(id);
  const events = usePaymentEvents(id);
  const origin = usePaymentRequest(id);
  const desktop = useMediaQuery('(min-width: 1024px)');

  const stream = useEventStream(
    payment.isError ? null : PaymentsRoute.paymentStream(id),
    ['snapshot', ...STREAM_EVENTS],
    (name, data) => {
      if (name === 'snapshot') {
        rememberPayment(client, data as PaymentView);
        return;
      }
      const message = data as PaymentStreamMessage;
      rememberPayment(client, message.payment);
      rememberEvent(client, message.event);
    },
  );

  if (payment.isError) {
    const notFound =
      payment.error instanceof ApiError &&
      (payment.error.code === ErrorCode.NOT_FOUND || payment.error.status === 400);
    return (
      <Card>
        {notFound ? (
          <EmptyState
            icon={SearchX}
            title="Payment not found"
            action={
              <Link
                href="/payments"
                className={buttonClasses('secondary', undefined, 'sm')}
              >
                Back to payments
              </Link>
            }
          >
            No payment has the id{' '}
            <code className="font-mono text-xs break-all">{id}</code>. Check it, or search
            for the payment with ⌘K.
          </EmptyState>
        ) : (
          <ErrorState
            error={payment.error}
            title="Could not load this payment"
            onRetry={() => void payment.refetch()}
          />
        )}
      </Card>
    );
  }

  const p = payment.data;
  if (!p) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-16 w-80" />
        <div className="grid gap-5 lg:grid-cols-12">
          <Skeleton className="h-64 rounded-panel lg:col-span-8" />
          <Skeleton className="h-64 rounded-panel lg:col-span-4" />
        </div>
      </div>
    );
  }

  const synthetic = events.data?.some((e) => e.metadata.synthetic === true);
  const actionsCard = (
    <Card aria-labelledby="actions-heading">
      <CardHeader id="actions-heading" title="Actions" />
      <PaymentActions payment={p} />
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/payments"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Payments
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1 className="hero-number text-ink">{formatMoney(p.amount, p.currency)}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span role="status" aria-label={`Status: ${p.status}`}>
                <StatusBadge status={p.status} size="lg" />
              </span>
              {p.failureCode && (
                <ReasonBadge code={p.failureCode} className="h-8 px-3 text-sm" />
              )}
              {synthetic && (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-sunken px-3 text-xs font-medium text-ink-2">
                  <FlaskConical className="size-3.5" aria-hidden />
                  Synthetic demo data
                </span>
              )}
            </div>
            <p className="mt-3 text-sm text-ink-2">
              {p.description ?? 'No description'} · {p.customerEmail}
            </p>
            {p.failureMessage && (
              <p className="mt-1 text-sm font-medium text-ink">{p.failureMessage}</p>
            )}
          </div>
          {/* Phones show the app-wide status in the header; one indicator per screen. */}
          <LiveIndicator state={stream} className="hidden lg:inline-flex" />
        </div>
      </div>

      {/* On a phone the actions come first; on a laptop they head the right column. */}
      {!desktop && actionsCard}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="min-w-0 space-y-5 lg:col-span-8">
          <Card aria-labelledby="attempts-heading">
            <CardHeader
              id="attempts-heading"
              title="Gateway attempts"
              description="Each call to the gateway to scale, with the backoff the worker waited between retries."
            />
            {events.data ? (
              <AttemptTimeline payment={p} events={events.data} />
            ) : (
              <Skeleton className="h-40" />
            )}
          </Card>

          <RequestCard payment={p} events={events.data} origin={origin} />

          <Card aria-labelledby="timeline-heading">
            <CardHeader
              id="timeline-heading"
              title="Timeline"
              description="Every change, recorded in the same transaction as the change itself."
            />
            {events.data ? (
              <EventTimeline events={events.data} />
            ) : (
              <Skeleton className="h-32" />
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5 lg:col-span-4">
          {desktop && actionsCard}

          <Card aria-labelledby="path-heading">
            <CardHeader id="path-heading" title="Lifecycle" />
            {events.data ? (
              <LifecyclePath createdAt={p.createdAt} events={events.data} />
            ) : (
              <Skeleton className="h-10" />
            )}
          </Card>

          <DetailsCard payment={p} events={events.data} />
        </div>
      </div>
    </div>
  );
}
