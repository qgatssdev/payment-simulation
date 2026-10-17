'use client';

import type { ValidationIssue } from '@payment-sim/shared';
import { ErrorCode, SUPPORTED_CURRENCIES, TEST_CARDS } from '@payment-sim/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { Path } from 'react-hook-form';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copyButton';
import { SelectField, TextField } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { ApiError } from '@/services/api';
import { createPayment } from '@/services/payments';
import { notifyError } from '@/utils/notify';
import { scenarioTerm } from '@/utils/vocabulary';
import type { PaymentFormValues } from '@/validations/payment.schema';
import {
  paymentFormResolver,
  toCreatePaymentPayload,
} from '@/validations/payment.schema';

const nextYear = new Date().getUTCFullYear() + 1;

export const DEFAULT_VALUES: PaymentFormValues = {
  amount: '2500.00',
  currency: 'NGN',
  customerEmail: 'ada@example.com',
  description: 'Order #1001',
  card: {
    number: TEST_CARDS[0]?.number ?? '',
    expMonth: '12',
    expYear: String(nextYear),
    cvc: '123',
    holderName: '',
  },
};

/**
 * One idempotency key per logical submission: created on the first attempt, reused when a
 * retry follows a network or server failure (the payment may already exist), and dropped
 * once the outcome is definitive (success, or a validation error that means the next attempt
 * is a different request).
 */
export function CreatePaymentForm({
  onCreated,
  compact = false,
}: {
  onCreated?: (paymentId: string) => void;
  /** Single column without panels, for the new-payment sheet. */
  compact?: boolean;
}) {
  const router = useRouter();
  const keyRef = useRef<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  const form = useForm<PaymentFormValues>({
    resolver: paymentFormResolver,
    defaultValues: DEFAULT_VALUES,
  });
  const { register, handleSubmit, setValue, setError, formState, control } = form;
  const errors = formState.errors;
  const selectedCard = useWatch({ control, name: 'card.number' }).replace(/[\s-]/g, '');

  async function submit(values: PaymentFormValues) {
    keyRef.current ??= crypto.randomUUID();
    setKey(keyRef.current);
    try {
      const { payment, replayed } = await createPayment(
        toCreatePaymentPayload(values),
        keyRef.current,
      );
      keyRef.current = null;
      toast.success(
        replayed ? 'Already created: showing the original' : 'Payment accepted',
        {
          description: 'Processing has started; the page updates live.',
        },
      );
      if (onCreated) onCreated(payment.id);
      else router.push(`/payments/${payment.id}`);
    } catch (error) {
      if (error instanceof ApiError && !error.retryable) keyRef.current = null;
      if (error instanceof ApiError && error.code === ErrorCode.VALIDATION_ERROR) {
        for (const issue of (error.details ?? []) as ValidationIssue[]) {
          if (issue.location === 'body' && issue.field) {
            setError(issue.field as Path<PaymentFormValues>, {
              message: issue.messages[0],
            });
          }
        }
      }
      notifyError(
        error,
        error instanceof ApiError && error.retryable
          ? 'Not sure it went through: retrying is safe'
          : 'Payment was not created',
      );
    }
  }

  const picker = (
    <div
      role="radiogroup"
      aria-label="Test card"
      className={cn(
        'grid gap-2',
        compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-1',
      )}
    >
      {TEST_CARDS.map((card) => {
        const checked = selectedCard === card.number;
        const term = scenarioTerm(card);
        const Icon = term.icon;
        return (
          <button
            key={card.number}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${card.label} (ending ${card.number.slice(-4)})`}
            aria-describedby={`test-card-${card.number}`}
            onClick={() =>
              setValue('card.number', card.number, {
                shouldValidate: formState.isSubmitted,
              })
            }
            className={cn(
              'pressable flex w-full gap-3 rounded-2xl p-3 text-left',
              checked
                ? 'bg-brand-wash shadow-[inset_0_0_0_1.5px_var(--brand)]'
                : 'bg-panel-2 hover:bg-sunken',
            )}
          >
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full"
              style={{
                background: `color-mix(in oklab, ${term.color} 15%, transparent)`,
              }}
            >
              <Icon className="size-4" style={{ color: term.color }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-semibold text-ink">
                  {card.label}
                </span>
                <span className="shrink-0 text-xs text-ink-3 tabular-nums">
                  •••• {card.number.slice(-4)}
                </span>
              </span>
              <span
                id={`test-card-${card.number}`}
                className={cn(
                  'mt-0.5 block text-xs text-ink-2',
                  compact && 'line-clamp-2',
                )}
              >
                {card.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const fields = (
    <>
      <div className="grid grid-cols-[1fr_112px] gap-3">
        <TextField
          label="Amount"
          inputMode="decimal"
          error={errors.amount?.message}
          {...register('amount')}
        />
        <SelectField
          label="Currency"
          error={errors.currency?.message}
          {...register('currency')}
        >
          {SUPPORTED_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField
        label="Customer email"
        type="email"
        autoComplete="email"
        error={errors.customerEmail?.message}
        {...register('customerEmail')}
      />
      <TextField
        label="Description"
        hint="Optional, shown in lists and search"
        error={errors.description?.message}
        {...register('description')}
      />
    </>
  );

  const cardFields = (
    <div className="grid grid-cols-3 gap-3">
      <TextField
        label="Card number"
        inputMode="numeric"
        autoComplete="cc-number"
        className="col-span-3"
        error={errors.card?.number?.message}
        {...register('card.number')}
      />
      <TextField
        label="Exp. month"
        inputMode="numeric"
        error={errors.card?.expMonth?.message}
        {...register('card.expMonth')}
      />
      <TextField
        label="Exp. year"
        inputMode="numeric"
        error={errors.card?.expYear?.message}
        {...register('card.expYear')}
      />
      <TextField
        label="CVC"
        inputMode="numeric"
        autoComplete="cc-csc"
        error={errors.card?.cvc?.message}
        {...register('card.cvc')}
      />
      <TextField
        label="Name on card"
        autoComplete="cc-name"
        className="col-span-3"
        error={errors.card?.holderName?.message}
        {...register('card.holderName')}
      />
    </div>
  );

  const submitRow = (
    <div className="space-y-3">
      <Button
        type="submit"
        size="lg"
        className="w-full sm:w-auto"
        disabled={formState.isSubmitting}
      >
        {formState.isSubmitting ? 'Creating…' : 'Create payment'}
      </Button>
      {key && (
        <div className="flex items-start gap-2 rounded-2xl bg-panel-2 p-3 text-xs text-ink-2">
          <div className="min-w-0 flex-1">
            <p>
              Idempotency key <code className="font-mono break-all text-ink">{key}</code>
            </p>
            <p className="mt-0.5 text-ink-3">
              Reused automatically if you retry this submission, so it can never be
              charged twice.
            </p>
          </div>
          <CopyButton value={key} label="Copy idempotency key" />
        </div>
      )}
    </div>
  );

  return (
    <form
      onSubmit={(e) => void handleSubmit(submit)(e)}
      noValidate
      aria-label="Create payment"
    >
      {compact ? (
        <div className="space-y-6">
          <section className="space-y-4" aria-label="Payment">
            {fields}
          </section>
          <section aria-labelledby="sheet-cards-heading">
            <h3
              id="sheet-cards-heading"
              className="mb-2.5 text-[13px] font-semibold text-ink"
            >
              Test card
            </h3>
            {picker}
          </section>
          <section aria-label="Card details">{cardFields}</section>
          {submitRow}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <CardHeader
              title="Payment"
              description="Amounts in major units: 2500.50 means ₦2,500.50."
            />
            <div className="space-y-4">{fields}</div>
            <h3 className="mt-7 mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">
              Card
            </h3>
            {cardFields}
            <div className="mt-7">{submitRow}</div>
          </Card>
          <Card aria-labelledby="test-cards-heading" className="lg:col-span-5">
            <CardHeader
              id="test-cards-heading"
              title="Test cards"
              description="Each one makes the simulated gateway behave a known way."
            />
            {picker}
          </Card>
        </div>
      )}
    </form>
  );
}
