import {
  ErrorCode,
  HEADERS,
  PAYMENT_TRANSITIONS,
  PaymentEventType,
  TEST_CARDS,
} from '@payment-sim/shared';
import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ResponseObject,
  SchemaObject,
} from 'openapi3-ts/oas31';
import { requestSchemas, responseSchemas } from './schemas';

/** The contract version (semver); bumped when the documented API changes. */
export const API_VERSION = '1.0.0';

const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const responseRef = (name: string) => ({ $ref: `#/components/responses/${name}` });

const json = (schema: SchemaObject, example?: unknown) => ({
  'application/json': { schema, ...(example === undefined ? {} : { example }) },
});

const nextYear = new Date().getUTCFullYear() + 1;

function errorResponse(
  description: string,
  code: ErrorCode,
  message: string,
  details?: unknown,
) {
  return {
    description,
    content: json(ref('Error'), {
      success: false,
      message,
      error: { code, ...(details === undefined ? {} : { details }) },
      requestId: '3f2b6c1e-8d4a-4b7f-9c2e-1a5d6e7f8a9b',
    }),
  };
}

const header = (description: string, schema: SchemaObject = { type: 'string' }) => ({
  description,
  schema,
});

/** Query parameters derived from the query DTO's generated schema: one source of truth. */
function queryParameters(schema: SchemaObject): ParameterObject[] {
  return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
    name,
    in: 'query' as const,
    required: (schema.required ?? []).includes(name),
    schema: property,
    description: (property as SchemaObject).description,
  }));
}

const paymentIdParam: ParameterObject = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const resumeParameters: ParameterObject[] = [
  {
    name: 'Last-Event-ID',
    in: 'header',
    required: false,
    description:
      'Sent automatically by EventSource on reconnect: replay events after this id.',
    schema: { type: 'string', pattern: '^\\d+$' },
  },
  {
    name: 'lastEventId',
    in: 'query',
    required: false,
    description:
      'Same as Last-Event-ID, for a first connection (EventSource cannot set headers).',
    schema: { type: 'integer', minimum: 0 },
  },
];

const streamDescription = `
Server-Sent Events (\`text/event-stream\`). Each frame's \`id\` is the event sequence and its
\`data\` is a **PaymentStreamMessage** (the event plus the payment's state after it).

| event | meaning |
|---|---|
| \`${PaymentEventType.CREATED}\` | payment accepted |
| \`${PaymentEventType.STATUS_CHANGED}\` | lifecycle transition |
| \`${PaymentEventType.ATTEMPT_FAILED}\` | a retryable gateway attempt failed; a retry is scheduled |
| \`snapshot\` | (per-payment stream, fresh connections only) current payment, no id |
| \`resync\` | live delivery had a gap; refetch current state |

Comment lines (\`: ping\`) are heartbeats. Reconnecting with \`Last-Event-ID\` replays what was missed.`;

function description(): string {
  const transitions = PAYMENT_TRANSITIONS.map(
    (t) => `| ${t.from} | ${t.to} | ${t.actor} |`,
  ).join('\n');
  const cards = TEST_CARDS.map(
    (c) => `| \`${c.number}\` | ${c.brand} | ${c.label} | ${c.description} |`,
  ).join('\n');

  return `
Simulated payment processing. Payments are accepted synchronously (\`202\`) and processed
asynchronously by a worker that charges a simulated gateway, retrying transient failures with
exponential backoff. Every change is recorded as an audit event and pushed to live streams.

### Lifecycle
| from | to | who |
|---|---|---|
${transitions}

Clients may only **cancel** (while PENDING) or **refund** (once SUCCEEDED).

### Idempotency
\`POST /payments\` requires an \`${HEADERS.IDEMPOTENCY_KEY}\` header. Repeating a request with the
same key returns the original response with \`${HEADERS.IDEMPOTENT_REPLAYED}: true\` and creates
nothing; reusing the key for a different request is \`422\`. Keys expire after 24 hours.

### Concurrency
Every payment has a \`version\`, returned as its \`ETag\`. Send it back as \`${HEADERS.IF_MATCH}\` on
\`PATCH\` to update only if nothing changed since you read it (\`412\` otherwise).

### Errors
Every error has the same shape: \`{ success: false, message, error: { code, details? }, requestId }\`.
Branch on \`error.code\`, not on the message. \`requestId\` matches the \`${HEADERS.REQUEST_ID}\` header
and the server logs.

### Test cards
Any future expiry and any 3-digit CVC. Other valid card numbers succeed, decline, or fail
transiently at random.

| number | brand | behaviour | detail |
|---|---|---|---|
${cards}
`.trim();
}

export function buildOpenApiDocument(version: string): OpenAPIObject {
  const requests = requestSchemas();
  const listQuery = requests.ListPaymentsQueryDto ?? {};

  const createPayment: OperationObject = {
    tags: ['Payments'],
    operationId: 'createPayment',
    summary: 'Create a payment',
    description:
      'Accepts the payment for asynchronous processing and returns it as PENDING.',
    parameters: [
      {
        name: HEADERS.IDEMPOTENCY_KEY,
        in: 'header',
        required: true,
        description:
          'Unique per logical payment; reuse it when retrying the same request.',
        schema: {
          type: 'string',
          minLength: 1,
          maxLength: 255,
          pattern: '^[\\x21-\\x7E]+$',
        },
        example: 'order-1001',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: ref('CreatePaymentDto'),
          examples: Object.fromEntries(
            TEST_CARDS.slice(0, 6).map((card) => [
              card.label.toLowerCase().replace(/[^a-z]+/g, '-'),
              {
                summary: `${card.label}: ${card.description}`,
                value: {
                  amount: 250_000,
                  currency: 'NGN',
                  customerEmail: 'ada@example.com',
                  description: 'Order #1001',
                  card: {
                    number: card.number,
                    expMonth: 12,
                    expYear: nextYear,
                    cvc: '123',
                  },
                },
              },
            ]),
          ),
        },
      },
    },
    responses: {
      '202': {
        description:
          'Accepted for processing (or replayed for a repeated idempotency key).',
        headers: {
          Location: header('URL of the new payment.'),
          ETag: header('The payment version, e.g. "1".'),
          [HEADERS.IDEMPOTENT_REPLAYED]: header(
            'Present ("true") when this is a replay.',
          ),
        },
        content: json(ref('PaymentResponse')),
      },
      '400': responseRef('ValidationFailed'),
      '413': responseRef('PayloadTooLarge'),
      '422': errorResponse(
        'Idempotency key reused for a different request.',
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'Idempotency-Key "order-1001" was already used for a different request',
      ),
      '429': responseRef('RateLimited'),
      '503': responseRef('Unavailable'),
    },
  };

  const responses: Record<string, ResponseObject> = {
    ValidationFailed: errorResponse(
      'The request (body, query, path or headers) failed validation.',
      ErrorCode.VALIDATION_ERROR,
      'Request validation failed',
      [{ location: 'body', field: 'card.number', messages: ['card number is invalid'] }],
    ),
    NotFound: errorResponse(
      'No such payment.',
      ErrorCode.NOT_FOUND,
      'Payment 6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70 not found',
    ),
    PayloadTooLarge: errorResponse(
      'Request body over the size limit.',
      ErrorCode.PAYLOAD_TOO_LARGE,
      'Request body exceeds the 16384 byte limit',
    ),
    RateLimited: errorResponse(
      'Too many requests; see the RateLimit headers.',
      ErrorCode.RATE_LIMITED,
      'Too many requests, please slow down',
    ),
    Unavailable: errorResponse(
      'A dependency is temporarily unavailable; retry after Retry-After seconds.',
      ErrorCode.SERVICE_UNAVAILABLE,
      'Service temporarily unavailable, please retry',
    ),
  };

  const streamResponse = (summary: string): Record<string, ResponseObject> => ({
    '200': {
      description: summary,
      content: {
        'text/event-stream': {
          schema: {
            type: 'string',
            description: 'Frames carrying PaymentStreamMessage JSON.',
          },
          example:
            'retry: 3000\n\nid: 27\nevent: payment.status_changed\ndata: {"type":"payment.status_changed","payment":{…},"event":{…}}\n\n: ping\n\n',
        },
      },
    },
  });

  return {
    openapi: '3.1.0',
    info: {
      title: 'Payment Processing Simulation API',
      version,
      description: description(),
    },
    tags: [
      { name: 'Payments', description: 'Create, read and change payments.' },
      { name: 'Live updates', description: 'Server-Sent Events.' },
      { name: 'Operations', description: 'Health and readiness probes.' },
    ],
    paths: {
      '/api/v1/payments': {
        post: createPayment,
        get: {
          tags: ['Payments'],
          operationId: 'listPayments',
          summary: 'List payments',
          description: 'Newest first. Follow `pagination.nextCursor` for the next page.',
          parameters: queryParameters(listQuery),
          responses: {
            '200': {
              description: 'A page of payments.',
              content: json(ref('PaymentPageResponse')),
            },
            '400': responseRef('ValidationFailed'),
            '429': responseRef('RateLimited'),
          },
        },
      },
      '/api/v1/payments/{id}': {
        get: {
          tags: ['Payments'],
          operationId: 'getPayment',
          summary: 'Get a payment',
          parameters: [
            paymentIdParam,
            {
              name: 'If-None-Match',
              in: 'header',
              required: false,
              description: 'An ETag you hold; 304 if the payment has not changed.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'The payment.',
              headers: { ETag: header('The payment version.') },
              content: json(ref('PaymentResponse')),
            },
            '304': { description: 'Unchanged since the ETag you sent.' },
            '400': responseRef('ValidationFailed'),
            '404': responseRef('NotFound'),
          },
        },
      },
      '/api/v1/payments/{id}/status': {
        patch: {
          tags: ['Payments'],
          operationId: 'updatePaymentStatus',
          summary: 'Cancel or refund a payment',
          parameters: [
            paymentIdParam,
            {
              name: HEADERS.IF_MATCH,
              in: 'header',
              required: false,
              description:
                'Apply only if the payment is still at this version (its ETag).',
              schema: { type: 'string', example: '"1"' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref('UpdatePaymentStatusDto'),
                examples: {
                  cancel: {
                    value: { status: 'CANCELLED', reason: 'Customer changed their mind' },
                  },
                  refund: { value: { status: 'REFUNDED', reason: 'Item returned' } },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'The updated payment.',
              headers: { ETag: header('The new version.') },
              content: json(ref('PaymentResponse')),
            },
            '400': responseRef('ValidationFailed'),
            '404': responseRef('NotFound'),
            '409': errorResponse(
              'Not allowed from the current status (INVALID_STATE_TRANSITION), or lost repeated races with other writers (CONCURRENT_MODIFICATION, safe to retry).',
              ErrorCode.INVALID_STATE_TRANSITION,
              'Cannot move a FAILED payment to REFUNDED',
              { from: 'FAILED', to: 'REFUNDED', allowed: [] },
            ),
            '412': errorResponse(
              'If-Match did not match the current version.',
              ErrorCode.PRECONDITION_FAILED,
              'If-Match expected version 1 but the payment is at version 3',
              { expectedVersion: 1, currentVersion: 3 },
            ),
          },
        },
      },
      '/api/v1/payments/{id}/events': {
        get: {
          tags: ['Payments'],
          operationId: 'listPaymentEvents',
          summary: 'Get a payment’s audit timeline',
          parameters: [paymentIdParam],
          responses: {
            '200': {
              description: 'Events, oldest first.',
              content: json(ref('PaymentEventsResponse')),
            },
            '400': responseRef('ValidationFailed'),
            '404': responseRef('NotFound'),
          },
        },
      },
      '/api/v1/stats': {
        get: {
          tags: ['Payments'],
          operationId: 'getStats',
          summary: 'Aggregate statistics',
          responses: {
            '200': {
              description: 'Counts, success rate, volume, timings.',
              content: json(ref('StatsResponse')),
            },
          },
        },
      },
      '/api/v1/payments/{id}/stream': {
        get: {
          tags: ['Live updates'],
          operationId: 'streamPayment',
          summary: 'Live updates for one payment',
          description: `${streamDescription}\n\nFresh connections start with a \`snapshot\`.`,
          parameters: [paymentIdParam, ...resumeParameters],
          responses: {
            ...streamResponse('Event stream for this payment.'),
            '400': responseRef('ValidationFailed'),
            '404': responseRef('NotFound'),
            '503': responseRef('Unavailable'),
          },
        },
      },
      '/api/v1/stream': {
        get: {
          tags: ['Live updates'],
          operationId: 'streamAll',
          summary: 'Live updates for all payments',
          description: streamDescription,
          parameters: resumeParameters,
          responses: {
            ...streamResponse('Event stream for every payment.'),
            '400': responseRef('ValidationFailed'),
            '503': responseRef('Unavailable'),
          },
        },
      },
      '/health': {
        get: {
          tags: ['Operations'],
          operationId: 'liveness',
          summary: 'Liveness',
          description: 'The process is up. Never touches dependencies.',
          responses: { '200': { description: 'Alive.', content: json(ref('Liveness')) } },
        },
      },
      '/ready': {
        get: {
          tags: ['Operations'],
          operationId: 'readiness',
          summary: 'Readiness',
          description:
            'Critical dependencies (database) answer. Realtime is reported but non-critical.',
          responses: {
            '200': { description: 'Ready.', content: json(ref('Readiness')) },
            '503': { description: 'Not ready.', content: json(ref('Readiness')) },
          },
        },
      },
    },
    components: {
      schemas: { ...requests, ...responseSchemas() },
      responses,
    },
  };
}
