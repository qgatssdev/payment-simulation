'use client';

import type { PaymentStreamMessage, PaymentView } from '@payment-sim/shared';
import { ErrorCode, PaymentEventType, TEST_CARDS } from '@payment-sim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FlaskConical, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { EventTimeline } from '@/components/event-timeline';
import { PaymentActions } from '@/components/payment-actions';
import { AttemptTimeline } from '@/components/payments/attempt-timeline';
import { JsonInspector } from '@/components/payments/json-inspector';
import { LifecyclePath } from '@/components/payments/lifecycle-path';
import { LiveIndicator } from '@/components/shell/live-indicator';
import { ReasonBadge, StatusBadge } from '@/components/status-badge';
import { buttonClasses } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { STREAM_EVENTS } from '@/lib/live';
import {
  rememberEvent,
  rememberPayment,
  usePayment,
  usePaymentEvents,
  usePaymentRequest,
} from '@/lib/queries';
import { useEventStream } from '@/lib/use-event-stream';
import { useMedia } from '@/lib/use-media';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-hairline py-2.5 text-[13px] first:border-0">
      <dt className="shrink-0 text-ink-2">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1 text-right text-ink">
        {children}
      </dd>
    </div>
  );
}

function Mono({
  value,
  label,
  short,
}: {
  value: string;
  label: string;
  short?: boolean;
}) {
  return (
    <>
      <code className="truncate font-mono text-xs" title={value}>
        {short ? `${value.slice(0, 8)}…` : value}
      </code>
      <CopyButton value={value} label={label} />
    </>
  );
}

function PaymentDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const payment = usePayment(id);
  const events = usePaymentEvents(id);
  const origin = usePaymentRequest(id);
  const desktop = useMedia('(min-width: 1024px)');

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

  const created = events.data?.find((e) => e.type === PaymentEventType.CREATED);
  const jobId = events.data?.find((e) => typeof e.metadata.jobId === 'string')?.metadata
    .jobId as string | undefined;
  const synthetic = events.data?.some((e) => e.metadata.synthetic === true);
  const scenario = TEST_CARDS.find(
    (c) => c.number.endsWith(p.paymentMethod.last4) && c.brand === p.paymentMethod.brand,
  );
  const o = origin.data;
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

          <Card aria-labelledby="inspector-heading">
            <CardHeader
              id="inspector-heading"
              title="Request and response"
              description="What the client sent, what it got back, and the payment as it is now."
            />
            {o && (
              <dl className="mb-4 grid gap-x-6 gap-y-2 rounded-2xl bg-panel-2 px-4 py-3 text-[13px] sm:grid-cols-2">
                <div className="flex min-w-0 items-center gap-2">
                  <dt className="shrink-0 text-ink-2">Idempotency key</dt>
                  <dd className="flex min-w-0 items-center text-ink">
                    {o.idempotencyKey ? (
                      <Mono value={o.idempotencyKey} label="Copy idempotency key" />
                    ) : (
                      <span className="text-ink-3">expired</span>
                    )}
                  </dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="text-ink-2">Replays</dt>
                  <dd className="text-ink">
                    {o.replayCount === 0
                      ? 'None, sent once'
                      : `${o.replayCount}× answered from the stored response, no duplicate created`}
                  </dd>
                </div>
              </dl>
            )}
            {origin.isError ? (
              <ErrorState
                error={origin.error}
                title="Could not load the original request"
                onRetry={() => void origin.refetch()}
              />
            ) : (
              <JsonInspector
                label="Payment JSON"
                tabs={[
                  ...(o
                    ? [
                        {
                          id: 'request',
                          label: 'Request',
                          summary: `${o.request.method} ${o.request.path}${o.idempotencyKey ? ` · Idempotency-Key: ${o.idempotencyKey}` : ''}`,
                          value: o.request.body,
                        },
                        ...(o.response
                          ? [
                              {
                                id: 'response',
                                label: 'Response',
                                summary: `${o.response.status} Accepted · what every replay receives`,
                                value: o.response.body,
                              },
                            ]
                          : []),
                      ]
                    : []),
                  {
                    id: 'current',
                    label: 'Current',
                    summary: `GET /api/v1/payments/${p.id} · ETag "${p.version}"`,
                    value: p,
                  },
                  ...(events.data
                    ? [
                        {
                          id: 'events',
                          label: 'Events',
                          summary: `${events.data.length} audit events`,
                          value: events.data,
                        },
                      ]
                    : []),
                ]}
              />
            )}
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

          <Card aria-labelledby="details-heading">
            <CardHeader id="details-heading" title="Details" />
            <dl>
              <Detail label="Payment ID">
                <Mono value={p.id} label="Copy payment ID" short />
              </Detail>
              <Detail label="Version (ETag)">
                <code className="font-mono text-xs">&quot;{p.version}&quot;</code>
              </Detail>
              <Detail label="Card">
                <span className="capitalize">{p.paymentMethod.brand}</span>
                <span className="tabular-nums">
                  •••• {p.paymentMethod.last4} ·{' '}
                  {String(p.paymentMethod.expMonth).padStart(2, '0')}/
                  {p.paymentMethod.expYear}
                </span>
              </Detail>
              {scenario && <Detail label="Test card">{scenario.label}</Detail>}
              <Detail label="Gateway attempts">{p.attempts}</Detail>
              <Detail label="Created">{formatDateTime(p.createdAt)}</Detail>
              <Detail label="Settled">
                {p.processedAt ? formatDateTime(p.processedAt) : '—'}
              </Detail>
              {typeof created?.metadata.requestId === 'string' && (
                <Detail label="Request ID">
                  <Mono
                    value={created.metadata.requestId}
                    label="Copy request ID"
                    short
                  />
                </Detail>
              )}
              {jobId && (
                <Detail label="Job ID">
                  <Mono value={jobId} label="Copy job ID" short />
                </Detail>
              )}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  return <PaymentDetail id={id} />;
}
