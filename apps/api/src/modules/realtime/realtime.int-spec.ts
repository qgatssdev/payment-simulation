import type { Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import type { PaymentStreamMessage, PaymentView } from '@payment-sim/shared';
import { PaymentEventType, PaymentStatus } from '@payment-sim/shared';
import type { Express } from 'express';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import type { Container } from '../../container';
import {
  closeIntegrationApps,
  createIntegrationApp,
  createTestDataSource,
  truncateAll,
} from '../../test/database';
import type { SseConnection, SseEvent } from '../../test/sse-client';
import { listen, openSse, stopServer } from '../../test/sse-client';
import { Payment } from '../payments/entity/payment.entity';
import { LISTENER_APPLICATION_NAME } from './pg-listener';
import { PgNotifyPublisher } from './payment-event.publisher';

const FAST = {
  GATEWAY_MIN_LATENCY_MS: '0',
  GATEWAY_MAX_LATENCY_MS: '0',
  RETRY_BASE_DELAY_MS: '0',
  RETRY_MAX_DELAY_MS: '0',
};

interface Instance {
  app: Express;
  container: Container;
  baseUrl: string;
  server: Server;
}

describe('realtime (LISTEN/NOTIFY + SSE)', () => {
  let dataSource: DataSource;
  let a: Instance;
  const servers: Server[] = [];
  const connections: SseConnection[] = [];
  let keySeq = 0;

  async function instance(env: Record<string, string> = {}): Promise<Instance> {
    const { app, container } = await createIntegrationApp(
      dataSource,
      {},
      { ...FAST, ...env },
    );
    const { baseUrl, server } = await listen(app);
    servers.push(server);
    return { app, container, baseUrl, server };
  }

  async function stream(url: string, headers?: Record<string, string>) {
    const connection = await openSse(url, headers);
    connections.push(connection);
    return connection;
  }

  async function createPayment(
    on: Instance = a,
    card = '4242424242424242',
  ): Promise<string> {
    const res = await request(on.app)
      .post('/api/v1/payments')
      .set('Idempotency-Key', `rt-${Date.now()}-${++keySeq}`)
      .send({
        amount: 7_500,
        currency: 'USD',
        customerEmail: 'ada@example.com',
        card: { number: card, expMonth: 12, expYear: 2030, cvc: '123' },
      });
    expect(res.status).toBe(202);
    return res.body.data.id as string;
  }

  async function process(on: Instance = a): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const started = await on.container.worker.tick();
      await on.container.worker.drain();
      if (started === 0) return;
    }
  }

  const message = (e: SseEvent) => e.data as PaymentStreamMessage;
  /** SSE event names are plain strings on the wire. */
  const named = (type: PaymentEventType) => (e: SseEvent) => e.event === String(type);
  const isStatus = (status: PaymentStatus) => (e: SseEvent) =>
    named(PaymentEventType.STATUS_CHANGED)(e) && message(e).payment.status === status;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    a = await instance();
  });

  beforeEach(() => truncateAll(dataSource));

  afterEach(() => {
    connections.splice(0).forEach((c) => c.close());
  });

  afterAll(async () => {
    await Promise.all(servers.map(stopServer));
    await closeIntegrationApps();
    await dataSource.destroy();
  });

  describe('GET /payments/:id/stream', () => {
    it('opens with a snapshot, then pushes each committed transition', async () => {
      const id = await createPayment();
      const sse = await stream(`${a.baseUrl}/api/v1/payments/${id}/stream`);
      expect(sse.status).toBe(200);
      expect(sse.headers['content-type']).toBe('text/event-stream; charset=utf-8');

      const snapshot = await sse.next();
      expect(snapshot.event).toBe('snapshot');
      expect(snapshot.id).toBeUndefined();
      expect(snapshot.data).toMatchObject({ id, status: 'PENDING', version: 1 });

      await process();
      const processing = await sse.next(isStatus(PaymentStatus.PROCESSING));
      const succeeded = await sse.next(isStatus(PaymentStatus.SUCCEEDED));

      expect(Number(succeeded.id)).toBeGreaterThan(Number(processing.id));
      expect(Number(succeeded.id)).toBe(message(succeeded).event.sequence);
      expect(message(succeeded)).toMatchObject({
        type: 'payment.status_changed',
        payment: { id, status: 'SUCCEEDED', attempts: 1 },
        event: { fromStatus: 'PROCESSING', toStatus: 'SUCCEEDED', paymentId: id },
      });
      // Only this payment's events reach this stream.
      await createPayment();
      await sleep(150);
      expect(
        sse.events.every((e) => e.event === 'snapshot' || message(e).payment.id === id),
      ).toBe(true);
    });

    it('replays what a reconnecting client missed, from Last-Event-ID', async () => {
      const id = await createPayment();
      await process();
      const timeline = await request(a.app).get(`/api/v1/payments/${id}/events`);
      const createdSequence = timeline.body.data[0].sequence as number;

      const sse = await stream(`${a.baseUrl}/api/v1/payments/${id}/stream`, {
        'Last-Event-ID': String(createdSequence),
      });
      const replayed = [await sse.next(), await sse.next()];
      expect(replayed.map((e) => message(e).event.toStatus)).toEqual([
        'PROCESSING',
        'SUCCEEDED',
      ]);
      expect(replayed.map((e) => Number(e.id))).toEqual(
        (timeline.body.data as Array<{ sequence: number }>)
          .slice(1)
          .map((e) => e.sequence),
      );
      expect(sse.events.some((e) => e.event === 'snapshot')).toBe(false);
    });

    it('accepts the resume point as ?lastEventId= for a first connection', async () => {
      const id = await createPayment();
      await process();
      const sse = await stream(`${a.baseUrl}/api/v1/payments/${id}/stream?lastEventId=0`);
      expect(message(await sse.next()).type).toBe(PaymentEventType.CREATED);
    });

    it('answers unknown payments and bad resume points with normal JSON errors', async () => {
      const missing = await stream(
        `${a.baseUrl}/api/v1/payments/6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70/stream`,
      );
      await missing.ended;
      expect(missing.status).toBe(404);
      expect(JSON.parse(missing.body())).toMatchObject({ error: { code: 'NOT_FOUND' } });

      const id = await createPayment();
      const bad = await stream(`${a.baseUrl}/api/v1/payments/${id}/stream`, {
        'Last-Event-ID': 'abc',
      });
      await bad.ended;
      expect(bad.status).toBe(400);
    });
  });

  describe('GET /stream', () => {
    it('carries every payment’s events', async () => {
      const sse = await stream(`${a.baseUrl}/api/v1/stream`);
      const [first, second] = [await createPayment(), await createPayment()];
      const created = [await sse.next(), await sse.next()];
      expect(created.map((e) => e.event)).toEqual([
        PaymentEventType.CREATED,
        PaymentEventType.CREATED,
      ]);
      expect(created.map((e) => message(e).payment.id).sort()).toEqual(
        [first, second].sort(),
      );
    });
  });

  describe('delivery guarantees', () => {
    it('never emits events from a rolled-back transaction', async () => {
      const id = await createPayment();
      const sse = await stream(`${a.baseUrl}/api/v1/stream`);
      const publisher = new PgNotifyPublisher();
      const payment = await dataSource.getRepository(Payment).findOneByOrFail({ id });
      const fake = (sequence: number): PaymentStreamMessage => ({
        type: PaymentEventType.STATUS_CHANGED,
        payment: { id: payment.id } as PaymentView,
        event: { sequence } as PaymentStreamMessage['event'],
      });

      await dataSource
        .transaction(async (manager) => {
          await publisher.paymentEvent(manager, fake(999_001));
          throw new Error('roll back');
        })
        .catch(() => undefined);
      await dataSource.transaction((manager) =>
        publisher.paymentEvent(manager, fake(999_002)),
      );

      const delivered = await sse.next();
      expect(Number(delivered.id)).toBe(999_002);
      expect(sse.events.some((e) => Number(e.id) === 999_001)).toBe(false);
    });

    it('fans out across instances: an event committed on A reaches a stream on B', async () => {
      const b = await instance();
      const id = await createPayment(a);
      const sse = await stream(`${b.baseUrl}/api/v1/payments/${id}/stream`);
      await sse.next(); // snapshot
      await process(a);
      expect(message(await sse.next(isStatus(PaymentStatus.SUCCEEDED))).payment.id).toBe(
        id,
      );
    });

    it("wakes another instance's worker immediately when a job is enqueued", async () => {
      const b = await instance({ WORKER_POLL_INTERVAL_MS: '60000' });
      b.container.worker.start();
      try {
        const id = await createPayment(a); // a's worker is not running
        for (let i = 0; i < 100; i++) {
          const { status } = await dataSource
            .getRepository(Payment)
            .findOneByOrFail({ id });
          if (status === PaymentStatus.SUCCEEDED) break;
          await sleep(20);
        }
        expect(
          (await dataSource.getRepository(Payment).findOneByOrFail({ id })).status,
        ).toBe(PaymentStatus.SUCCEEDED);
      } finally {
        await b.container.worker.stop();
      }
    });

    it('reconnects a dropped listener and tells clients to resync', async () => {
      const sse = await stream(`${a.baseUrl}/api/v1/stream`);
      await dataSource.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE application_name = $1 AND pid <> pg_backend_pid()`,
        [LISTENER_APPLICATION_NAME],
      );

      const resync = await sse.next((e) => e.event === 'resync', 5_000);
      expect(resync.data).toMatchObject({ reason: expect.any(String) as unknown });
      expect(a.container.listener.connected).toBe(true);

      const id = await createPayment();
      expect(message(await sse.next(named(PaymentEventType.CREATED))).payment.id).toBe(
        id,
      );
    });
  });

  describe('operations', () => {
    it('keeps idle streams alive with heartbeat comments', async () => {
      const hb = await instance({ SSE_HEARTBEAT_MS: '30' });
      const sse = await stream(`${hb.baseUrl}/api/v1/stream`);
      await sleep(120);
      expect(sse.comments.filter((c) => c === 'ping').length).toBeGreaterThanOrEqual(2);
    });

    it('refuses streams beyond the per-process cap with 503', async () => {
      const capped = await instance({ SSE_MAX_CLIENTS: '1' });
      await stream(`${capped.baseUrl}/api/v1/stream`);
      const refused = await stream(`${capped.baseUrl}/api/v1/stream`);
      await refused.ended;
      expect(refused.status).toBe(503);
      expect(refused.headers['retry-after']).toBe('5');
    });

    it('ends open streams on shutdown so the server can close', async () => {
      const c = await instance();
      const sse = await stream(`${c.baseUrl}/api/v1/stream`);
      expect(c.container.streams.size).toBe(1);
      c.container.closeStreams();
      await sse.ended;
      expect(c.container.streams.size).toBe(0);
    });

    it('reports the listener on /ready without letting it gate readiness', async () => {
      const res = await request(a.app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.data.checks.realtime).toMatchObject({
        status: 'up',
        critical: false,
      });
    });
  });
});
