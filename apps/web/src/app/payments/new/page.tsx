import type { Metadata } from 'next';
import { CreatePaymentForm } from '@/components/create-payment-form';

export const metadata: Metadata = { title: 'New payment' };

export default function NewPaymentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">New payment</h1>
        <p className="mt-1 text-sm text-ink-2">
          Validated here with the same rules the API enforces, then accepted for
          asynchronous processing.
        </p>
      </div>
      <CreatePaymentForm />
    </div>
  );
}
