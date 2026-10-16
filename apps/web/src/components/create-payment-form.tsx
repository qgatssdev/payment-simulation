'use client';

import type { ValidationIssue } from '@payment-sim/shared';
import { ErrorCode, SUPPORTED_CURRENCIES, TEST_CARDS } from '@payment-sim/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { Path } from 'react-hook-form';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { notifyError } from '@/lib/notify';
import type { PaymentFormValues } from '@/lib/payment-form';
import { paymentFormResolver, toCreatePaymentBody } from '@/lib/payment-form';
import { Button } from './ui/button';
import { Card, CardHeader } from './ui/card';
import { SelectField, TextField } from './ui/field';

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
}: {
  onCreated?: (paymentId: string) => void;
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
      const { payment, replayed } = await api.createPayment(
        toCreatePaymentBody(values),
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

  return (
    <form
      onSubmit={(e) => void handleSubmit(submit)(e)}
      noValidate
      aria-label="Create payment"
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Payment" description="Amounts are entered in major units." />
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
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
            <TextField
              label="Customer email"
              type="email"
              autoComplete="email"
              className="sm:col-span-2"
              error={errors.customerEmail?.message}
              {...register('customerEmail')}
            />
            <TextField
              label="Description"
              className="sm:col-span-2"
              hint="Optional, shown on the dashboard"
              error={errors.description?.message}
              {...register('description')}
            />
          </div>

          <h3 className="mt-6 mb-3 text-sm font-semibold text-ink">Card</h3>
          <div className="grid gap-4 sm:grid-cols-4">
            <TextField
              label="Card number"
              inputMode="numeric"
              autoComplete="cc-number"
              className="sm:col-span-4"
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
              error={errors.card?.holderName?.message}
              {...register('card.holderName')}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? 'Creating…' : 'Create payment'}
            </Button>
            {key && (
              <p className="text-xs text-ink-3">
                Idempotency key <code className="font-mono text-ink-2">{key}</code>
                <span className="block">
                  Reused automatically if you retry this submission.
                </span>
              </p>
            )}
          </div>
        </Card>

        <Card aria-labelledby="test-cards-heading">
          <CardHeader
            id="test-cards-heading"
            title="Test cards"
            description="Each one makes the simulated gateway behave a known way."
          />
          <div role="radiogroup" aria-label="Test card" className="space-y-2">
            {TEST_CARDS.map((card) => {
              const checked = selectedCard === card.number;
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
                    'w-full rounded-lg border p-3 text-left transition',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                    checked
                      ? 'border-accent bg-accent/5'
                      : 'border-line hover:bg-surface-2',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{card.label}</span>
                    <span className="font-mono text-xs text-ink-3">
                      ···· {card.number.slice(-4)}
                    </span>
                  </span>
                  <span
                    id={`test-card-${card.number}`}
                    className="mt-0.5 block text-xs text-ink-2"
                  >
                    {card.description}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      </div>
    </form>
  );
}
