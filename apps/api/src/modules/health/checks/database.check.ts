import type { DataSource } from 'typeorm';
import type { ReadinessCheck } from '../services/health.service';

export class DatabaseReadinessCheck implements ReadinessCheck {
  readonly name = 'database';

  constructor(private readonly dataSource: DataSource) {}

  async check(): Promise<void> {
    await this.dataSource.query('SELECT 1');
  }
}
