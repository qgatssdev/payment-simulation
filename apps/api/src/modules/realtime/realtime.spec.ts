import { EventEmitter } from 'node:events';
import type { PaymentStreamMessage } from '@payment-sim/shared';
import type { Response } from 'express';
import { ServiceUnavailableError } from '../../libs/core/errors';
import { captureLogger } from '../../test/helpers';
import { RealtimeHub } from './realtime-hub';
import { SseRegistry } from './sse';

const message = (paymentId: string, sequence = 1) =>
  ({
    type: 'payment.created',
    payment: { id: paymentId },
    event: { sequence },
  }) as unknown as PaymentStreamMessage;

describe('RealtimeHub', () => {
  it('delivers to matching and catch-all subscribers only', () => {
    const hub = new RealtimeHub(captureLogger().logger);
    const forA = jest.fn();
    const forB = jest.fn();
    const all = jest.fn();
    hub.subscribe({ paymentId: 'a', onMessage: forA, onResync: jest.fn() });
    hub.subscribe({ paymentId: 'b', onMessage: forB, onResync: jest.fn() });
    hub.subscribe({ onMessage: all, onResync: jest.fn() });

    hub.publish(message('a'));
    expect(forA).toHaveBeenCalledTimes(1);
    expect(forB).not.toHaveBeenCalled();
    expect(all).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new RealtimeHub(captureLogger().logger);
    const onMessage = jest.fn();
    const unsubscribe = hub.subscribe({ onMessage, onResync: jest.fn() });
    unsubscribe();
    hub.publish(message('a'));
    expect(onMessage).not.toHaveBeenCalled();
    expect(hub.size).toBe(0);
  });

  it('isolates a throwing subscriber from the rest', () => {
    const { logger, lines } = captureLogger();
    const hub = new RealtimeHub(logger);
    const healthy = jest.fn();
    hub.subscribe({
      onMessage: () => {
        throw new Error('broken socket');
      },
      onResync: jest.fn(),
    });
    hub.subscribe({ onMessage: healthy, onResync: jest.fn() });

    hub.publish(message('a'));
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(lines().some((l) => l.msg === 'realtime subscriber threw')).toBe(true);
  });

  it('broadcasts resync to everyone', () => {
    const hub = new RealtimeHub(captureLogger().logger);
    const a = jest.fn();
    const b = jest.fn();
    hub.subscribe({ paymentId: 'x', onMessage: jest.fn(), onResync: a });
    hub.subscribe({ onMessage: jest.fn(), onResync: b });
    hub.resync();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

/** Just enough of an Express response to observe what an SSE stream writes. */
function fakeResponse() {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const written: string[] = [];
  Object.assign(res, {
    statusCode: 0,
    headers: {},
    ended: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    set(headers: Record<string, string>) {
      Object.assign(res.headers as object, headers);
      return res;
    },
    flushHeaders: jest.fn(),
    write(chunk: string) {
      written.push(chunk);
      return true;
    },
    end() {
      res.ended = true;
      res.emit('close');
    },
  });
  return { res: res as unknown as Response, raw: res, written };
}

describe('SSE streams', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('writes the event-stream headers, a retry hint, and well-formed frames', () => {
    const { res, raw, written } = fakeResponse();
    const stream = new SseRegistry(10, 15_000).open(res);
    stream.send({ id: 42, event: 'payment.created', data: { a: 1 } });
    stream.send({ event: 'snapshot', data: 'x' });

    expect(raw.statusCode).toBe(200);
    expect(raw.headers).toMatchObject({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    });
    expect(written).toEqual([
      'retry: 3000\n\n',
      'id: 42\nevent: payment.created\ndata: {"a":1}\n\n',
      'event: snapshot\ndata: "x"\n\n',
    ]);
  });

  it('sends heartbeat comments until the client goes away', () => {
    const { res, raw, written } = fakeResponse();
    new SseRegistry(10, 1_000).open(res);
    jest.advanceTimersByTime(2_500);
    expect(written.filter((w) => w === ': ping\n\n')).toHaveLength(2);

    raw.emit('close');
    jest.advanceTimersByTime(5_000);
    expect(written.filter((w) => w === ': ping\n\n')).toHaveLength(2);
  });

  it('caps concurrent streams and frees a slot when one closes', () => {
    const registry = new SseRegistry(1, 15_000);
    const first = fakeResponse();
    registry.open(first.res);
    expect(() => registry.open(fakeResponse().res)).toThrow(ServiceUnavailableError);

    first.raw.emit('close');
    expect(registry.size).toBe(0);
    expect(() => registry.open(fakeResponse().res)).not.toThrow();
  });

  it('closeAll ends every open stream and runs their close handlers', () => {
    const registry = new SseRegistry(10, 15_000);
    const a = fakeResponse();
    const b = fakeResponse();
    const onClose = jest.fn();
    registry.open(a.res).onClose(onClose);
    registry.open(b.res);

    registry.closeAll();
    expect(a.raw.ended).toBe(true);
    expect(b.raw.ended).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });
});
