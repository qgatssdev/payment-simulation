import type { PgListener } from '../../realtime/pg-listener';
import type { ReadinessCheck } from '../services/health.service';

/** Reported on /ready but non-critical: without it, live updates stop while REST still works. */
export class RealtimeReadinessCheck implements ReadinessCheck {
  readonly name = 'realtime';
  readonly critical = false;

  constructor(private readonly listener: PgListener) {}

  check(): Promise<void> {
    return this.listener.connected
      ? Promise.resolve()
      : Promise.reject(new Error('realtime listener is not connected'));
  }
}
