import type { PaymentEventView, PaymentView } from '@payment-sim/shared';
import { PaymentEventType, TEST_CARDS } from '@payment-sim/shared';
import type { ReactNode } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copyButton';
import { formatDateTime } from '@/utils/format';

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

// An id in mono with a copy button; `short` shows the first 8 characters.
export function Mono({
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

export default function DetailsCard({
  payment: p,
  events,
}: {
  payment: PaymentView;
  events: PaymentEventView[] | undefined;
}) {
  const created = events?.find((e) => e.type === PaymentEventType.CREATED);
  const jobId = events?.find((e) => typeof e.metadata.jobId === 'string')?.metadata
    .jobId as string | undefined;
  const scenario = TEST_CARDS.find(
    (c) => c.number.endsWith(p.paymentMethod.last4) && c.brand === p.paymentMethod.brand,
  );

  return (
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
            {String(p.paymentMethod.expMonth).padStart(2, '0')}/{p.paymentMethod.expYear}
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
            <Mono value={created.metadata.requestId} label="Copy request ID" short />
          </Detail>
        )}
        {jobId && (
          <Detail label="Job ID">
            <Mono value={jobId} label="Copy job ID" short />
          </Detail>
        )}
      </dl>
    </Card>
  );
}
