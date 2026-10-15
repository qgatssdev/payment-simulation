import type { PaymentStore } from '../../../infra/store/payment-store';
import type { ReadinessCheck } from '../services/health.service';

/**
 * Ready while the data file is being written successfully. Probing also retries any pending
 * write, so an instance recovers on its own once the disk does (space freed, permissions fixed).
 */
export class StoreReadinessCheck implements ReadinessCheck {
  readonly name = 'storage';

  constructor(private readonly store: PaymentStore) {}

  async check(): Promise<void> {
    if (this.store.persistent) await this.store.flush();
  }
}
