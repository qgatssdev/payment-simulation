import request from 'supertest';
import type { DataSource } from 'typeorm';
import { createTestDataSource } from '../../test/database';
import { buildTestApp } from '../../test/helpers';
import { DatabaseReadinessCheck } from './checks/database.check';

describe('readiness against a real database', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  it('is ready while the database answers', async () => {
    const app = buildTestApp({ checks: [new DatabaseReadinessCheck(dataSource)] });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.checks.database.status).toBe('up');
  });

  it('turns not-ready when the connection is gone, while liveness stays green', async () => {
    const app = buildTestApp({ checks: [new DatabaseReadinessCheck(dataSource)] });
    await dataSource.destroy();

    expect((await request(app).get('/ready')).status).toBe(503);
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
