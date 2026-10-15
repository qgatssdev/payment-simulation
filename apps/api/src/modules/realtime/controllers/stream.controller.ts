import type { PaymentStreamMessage } from '@payment-sim/shared';
import { PaymentIdParamDto } from '@payment-sim/shared';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import type { Request } from 'express';
import { Router } from 'express';
import { endpoint } from '../../../libs/common/http/endpoint';
import { ValidationError } from '../../../libs/core/errors';
import type { Logger } from '../../../libs/core/logger/logger';
import { toPaymentView } from '../../payments/mappers/payment.mapper';
import type { PaymentService } from '../../payments/services/payment.service';
import type { RealtimeHub } from '../realtime-hub';
import type { SseRegistry, SseStream } from '../sse';

/** EventSource cannot set headers on its first connection, so the resume point may be a query param. */
class StreamQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lastEventId?: number;
}

export interface StreamControllerDeps {
  payments: PaymentService;
  hub: RealtimeHub;
  registry: SseRegistry;
  logger: Logger;
  /** Most events replayed to one resuming client. */
  replayLimit: number;
}

/** Remembers recently sent sequence numbers to drop duplicates (replay vs live overlap). */
class RecentSequences {
  private readonly seen = new Set<number>();
  constructor(private readonly capacity = 5_000) {}

  firstTime(sequence: number): boolean {
    if (this.seen.has(sequence)) return false;
    this.seen.add(sequence);
    if (this.seen.size > this.capacity) {
      this.seen.delete(this.seen.values().next().value as number);
    }
    return true;
  }
}

export function createStreamController(deps: StreamControllerDeps): Router {
  const router = Router();

  router.get(
    '/payments/:id/stream',
    endpoint(
      { params: PaymentIdParamDto, query: StreamQueryDto },
      async ({ params, query }, req, res) => {
        await deps.payments.get(params.id); // 404 as a normal JSON error, before streaming starts
        const resumeAfter = lastEventId(req, query.lastEventId);
        const stream = deps.registry.open(res);
        await relay(deps, stream, {
          paymentId: params.id,
          catchUp: async (send) => {
            if (resumeAfter === undefined) {
              // Read after subscribing, so nothing can fall between the snapshot and live events.
              send({
                event: 'snapshot',
                data: toPaymentView(await deps.payments.get(params.id)),
              });
              return [];
            }
            return deps.payments.streamBacklog(resumeAfter, deps.replayLimit, params.id);
          },
        });
      },
    ),
  );

  router.get(
    '/stream',
    endpoint({ query: StreamQueryDto }, async ({ query }, req, res) => {
      const resumeAfter = lastEventId(req, query.lastEventId);
      const stream = deps.registry.open(res);
      await relay(deps, stream, {
        catchUp: () =>
          resumeAfter === undefined
            ? Promise.resolve([])
            : deps.payments.streamBacklog(resumeAfter, deps.replayLimit),
      });
    }),
  );

  return router;
}

/** Last-Event-ID (sent by EventSource on reconnect) wins over the query parameter. */
function lastEventId(req: Request, fromQuery: number | undefined): number | undefined {
  const header = req.get('Last-Event-ID');
  if (header === undefined || header === '') return fromQuery;
  if (!/^\d{1,15}$/.test(header)) {
    throw new ValidationError(
      [
        {
          location: 'headers',
          field: 'Last-Event-ID',
          messages: ['Last-Event-ID must be an event id from this stream'],
        },
      ],
      'Invalid Last-Event-ID header',
    );
  }
  return Number(header);
}

/**
 * Subscribe first and buffer, then send the catch-up (snapshot or replay), then flush the
 * buffer and go live. Subscribing before reading closes the window in which an event could
 * commit after the read but before the subscription and be lost; duplicates from the overlap
 * are dropped by sequence.
 */
async function relay(
  deps: StreamControllerDeps,
  stream: SseStream,
  options: {
    paymentId?: string;
    catchUp: (send: SseStream['send']) => Promise<PaymentStreamMessage[]>;
  },
): Promise<void> {
  const sent = new RecentSequences();
  const forward = (message: PaymentStreamMessage) => {
    if (!sent.firstTime(message.event.sequence)) return;
    stream.send({ id: message.event.sequence, event: message.type, data: message });
  };

  let live = false;
  const buffered: PaymentStreamMessage[] = [];
  const unsubscribe = deps.hub.subscribe({
    paymentId: options.paymentId,
    onMessage: (message) => (live ? forward(message) : buffered.push(message)),
  });
  stream.onClose(unsubscribe);

  try {
    for (const message of await options.catchUp((frame) => stream.send(frame)))
      forward(message);
    for (const message of buffered.splice(0)) forward(message);
    live = true;
  } catch (err) {
    deps.logger.error({ err }, 'could not start event stream');
    stream.close();
  }
}
