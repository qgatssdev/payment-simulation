import type { Metadata } from 'next';
import { CreatePaymentForm } from '@/components/create-payment-form';

export const metadata: Metadata = { title: 'New payment' };

export default function NewPaymentPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-ink">
          New payment
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Validated here with the same rules the API enforces, then accepted for
          processing in the background.
        </p>
      </header>
      <CreatePaymentForm />
    </div>
  );
}
