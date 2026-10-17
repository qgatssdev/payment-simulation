import type { PaymentEventView, PaymentView } from '@payment-sim/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import type { usePaymentRequest } from '@/services/payments/queries';
import { Mono } from './detailsCard';
import { JsonInspector } from './jsonInspector';

/** What the client sent, what it got back, and the payment as it is now. */
export default function RequestCard({
  payment: p,
  events,
  origin,
}: {
  payment: PaymentView;
  events: PaymentEventView[] | undefined;
  // Loaded by the view alongside the payment, so it is not a second round trip later.
  origin: ReturnType<typeof usePaymentRequest>;
}) {
  const o = origin.data;

  return (
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
            ...(events
              ? [
                  {
                    id: 'events',
                    label: 'Events',
                    summary: `${events.length} audit events`,
                    value: events,
                  },
                ]
              : []),
          ]}
        />
      )}
    </Card>
  );
}
