import type { Metadata } from 'next';
import { LoadSimulator } from '@/components/load-simulator';

export const metadata: Metadata = { title: 'Simulator' };

export default function SimulatorPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-ink">
          Simulator
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Put the service under load: the worker&apos;s concurrency limit, retries with
          backoff and the rate limit, all visible as they happen.
        </p>
      </header>
      <LoadSimulator />
    </div>
  );
}
