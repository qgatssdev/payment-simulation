'use client';

import type { PaymentStreamMessage, PaymentView } from '@payment-sim/shared';
import { ErrorCode } from '@payment-sim/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EventTimeline } from '@/components/event-timeline';
import { LiveIndicator } from '@/components/live-indicator';
import { PaymentActions } from '@/components/payment-actions';
import { StateMachineDiagram } from '@/components/state-machine-diagram';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { STREAM_EVENTS } from '@/lib/live-sync';
import {
  rememberEvent,
  rememberPayment,
  usePayment,
  usePaymentEvents,
} from '@/lib/queries';
import { useEventStream } from '@/lib/use-event-stream';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const payment = usePayment(id);
  const events = usePaymentEvents(id);

  const stream = useEventStream(
    payment.isError ? null : `/api/v1/payments/${id}/stream`,
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
      <Card role="alert">
        <h1 className="text-lg font-semibold text-ink">
          {notFound ? 'Payment not found' : 'Could not load this payment'}
        </h1>
        <p className="mt-1 text-sm text-ink-2">{payment.error.message}</p>
        <Link href="/" className="mt-3 inline-block text-sm text-accent-ink underline">
          Back to the dashboard
        </Link>
      </Card>
    );
  }

  const p = payment.data;
  if (!p) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-ink-2 hover:text-ink">
            ← Dashboard
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold text-ink">
            <span className="tabular-nums">{formatMoney(p.amount, p.currency)}</span>
            <span role="status" aria-label={`Status: ${p.status}`}>
              <StatusBadge status={p.status} className="text-sm" />
            </span>
          </h1>
          <p className="mt-1 text-sm text-ink-2">{p.description ?? 'No description'}</p>
        </div>
        <LiveIndicator state={stream} />
      </div>

      {/* min-w-0: grid items default to min-width:auto and would grow to the diagram's width. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card aria-labelledby="lifecycle-heading">
            <CardHeader id="lifecycle-heading" title="Lifecycle" />
            {/* Scroll rather than shrink: the diagram's labels must stay legible on a phone. */}
            <div className="-mx-5 overflow-x-auto px-5">
              <div className="min-w-[560px]">
                <StateMachineDiagram status={p.status} events={events.data ?? []} />
              </div>
            </div>
          </Card>
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

        <div className="min-w-0 space-y-6">
          <Card aria-labelledby="actions-heading">
            <CardHeader id="actions-heading" title="Actions" />
            <PaymentActions payment={p} />
          </Card>
          <Card aria-labelledby="details-heading">
            <CardHeader id="details-heading" title="Details" />
            <dl>
              <Detail label="Customer">{p.customerEmail}</Detail>
              <Detail label="Card">
                <span className="capitalize">{p.paymentMethod.brand}</span> ····{' '}
                {p.paymentMethod.last4} ·{' '}
                {String(p.paymentMethod.expMonth).padStart(2, '0')}/
                {p.paymentMethod.expYear}
              </Detail>
              <Detail label="Gateway attempts">{p.attempts}</Detail>
              {p.failureCode && (
                <Detail label="Failure">
                  <span className="text-critical-ink">
                    {p.failureMessage ?? p.failureCode}
                  </span>
                </Detail>
              )}
              <Detail label="Created">{formatDateTime(p.createdAt)}</Detail>
              <Detail label="Processed">
                {p.processedAt ? formatDateTime(p.processedAt) : '—'}
              </Detail>
              <Detail label="Version (ETag)">
                <code className="font-mono">&quot;{p.version}&quot;</code>
              </Detail>
              <Detail label="ID">
                <code className="font-mono text-xs break-all">{p.id}</code>
              </Detail>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
