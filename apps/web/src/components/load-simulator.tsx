'use client';

import type { Currency } from '@payment-sim/shared';
import { TEST_CARDS } from '@payment-sim/shared';
import { Gauge } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from './ui/button';
import { Card, CardHeader } from './ui/card';
import { SelectField } from './ui/field';

/** Card mix: every scenario, plus an ordinary card that gets the gateway's random behaviour. */
const CARDS = [...TEST_CARDS.map((c) => c.number), '4111111111111111'];
const CURRENCIES: Currency[] = ['NGN', 'USD', 'EUR', 'GBP'];
const nextYear = new Date().getUTCFullYear() + 1;

interface Run {
  total: number;
  accepted: number;
  failed: number;
  durationMs?: number;
}

/**
 * Fires N payments at once to show the system under concurrency: the worker's parallelism
 * limit, retries with backoff, and the dashboard updating live from the event stream.
 */
export function LoadSimulator() {
  const [count, setCount] = useState(25);
  const [run, setRun] = useState<Run | null>(null);
  const running = run !== null && run.durationMs === undefined;

  async function start() {
    const startedAt = performance.now();
    setRun({ total: count, accepted: 0, failed: 0 });
    await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        try {
          await api.createPayment(
            {
              amount: 1_000 + Math.floor(Math.random() * 500_000),
              currency: CURRENCIES[i % CURRENCIES.length] as Currency,
              customerEmail: `load-${i + 1}@example.com`,
              description: `Load test #${i + 1}`,
              card: {
                number: CARDS[i % CARDS.length] as string,
                expMonth: 12,
                expYear: nextYear,
                cvc: '123',
              },
            },
            crypto.randomUUID(),
          );
          setRun((r) => r && { ...r, accepted: r.accepted + 1 });
        } catch {
          setRun((r) => r && { ...r, failed: r.failed + 1 });
        }
      }),
    );
    setRun((r) => r && { ...r, durationMs: Math.round(performance.now() - startedAt) });
  }

  return (
    <Card aria-labelledby="simulator-heading">
      <CardHeader
        id="simulator-heading"
        title="Load simulator"
        description="Send a burst of concurrent payments across every test-card scenario and watch them settle."
      />
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          label="Payments"
          className="w-28"
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          disabled={running}
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectField>
        <Button onClick={() => void start()} disabled={running}>
          <Gauge className="size-4" aria-hidden />
          {running ? 'Sending…' : 'Run simulation'}
        </Button>
      </div>
      {run && (
        <p role="status" className="mt-3 text-sm text-ink-2">
          {run.accepted + run.failed} of {run.total} sent · {run.accepted} accepted
          {run.failed > 0 && (
            <span className="text-critical-ink"> · {run.failed} failed</span>
          )}
          {run.durationMs !== undefined && ` · ${run.durationMs} ms`}
        </p>
      )}
    </Card>
  );
}
