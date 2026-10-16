import 'reflect-metadata';
import {
  CardBrand,
  INSIGHT_RANGES,
  ErrorCode,
  PaymentEventType,
  PaymentFailureCode,
  PAYMENT_STATUSES,
  SUPPORTED_CURRENCIES,
} from '@payment-sim/shared';
import { defaultMetadataStorage } from 'class-transformer/cjs/storage';
import { ValidationTypes } from 'class-validator';
import type { SchemaObject } from 'openapi3-ts/oas31';
import { validationMetadatasToSchemas } from 'class-validator-jsonschema';

export type { SchemaObject };

const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });

/** Descriptions for the shared package's custom validators, which have no JSON Schema form. */
const CUSTOM_VALIDATORS: Record<string, string> = {
  isLuhnCardNumber: 'Must pass the Luhn checksum.',
  isNotExpiredCard: 'Together with expMonth, must not be in the past.',
};

/** Where the API is more lenient than the canonical form the schemas describe. */
const NORMALISATION_NOTES: Record<string, Record<string, string>> = {
  CreatePaymentDto: {
    amount: 'Integer amount in the currency’s minor unit (kobo, cents).',
    currency: 'ISO 4217 code. Case-insensitive on input.',
    customerEmail: 'Trimmed and lower-cased before storage.',
  },
  CardDto: {
    number: 'Spaces and dashes are stripped before validation. Never stored or returned.',
    cvc: 'Used for tokenisation only. Never stored or returned.',
  },
  ListPaymentsQueryDto: {
    cursor: 'Opaque value from pagination.nextCursor of the previous page.',
    limit: 'Page size, default 20.',
    q: 'A payment id or its start, or text in the customer email or description (case-insensitive).',
  },
  InsightsQueryDto: {
    range:
      'Window ending now: 15m (30 s buckets), 1h (2 min), 24h (1 h) or 7d (6 h). Default 1h.',
  },
};

/**
 * Request schemas generated from the class-validator DTOs the API validates with, so the
 * documented constraints are the enforced ones. Unknown properties are rejected at runtime
 * (forbidNonWhitelisted), so the schemas say so too.
 */
export function requestSchemas(): Record<string, SchemaObject> {
  const generated = validationMetadatasToSchemas({
    refPointerPrefix: '#/components/schemas/',
    classTransformerMetadataStorage: defaultMetadataStorage,
    additionalConverters: {
      [ValidationTypes.CUSTOM_VALIDATION]: (meta) => {
        const note = meta.name ? CUSTOM_VALIDATORS[meta.name] : undefined;
        return note ? { description: note } : {};
      },
    },
  }) as Record<string, SchemaObject>;

  for (const [name, schema] of Object.entries(generated)) {
    schema.additionalProperties = false;
    for (const [prop, note] of Object.entries(NORMALISATION_NOTES[name] ?? {})) {
      const property = schema.properties?.[prop] as SchemaObject | undefined;
      if (property) {
        property.description = [note, property.description].filter(Boolean).join(' ');
      }
    }
  }
  return generated;
}

const isoDateTime: SchemaObject = { type: 'string', format: 'date-time' };
const nullable = (schema: SchemaObject): SchemaObject => ({
  anyOf: [schema, { type: 'null' }],
});

/**
 * Response shapes, mirroring the interfaces in packages/shared/src/contracts.ts. They are
 * interfaces (no runtime metadata), so these are written by hand; docs.int-spec.ts validates
 * real responses against them so they cannot drift unnoticed.
 */
export function responseSchemas(): Record<string, SchemaObject> {
  const strict = (properties: Record<string, SchemaObject>, optional: string[] = []) => ({
    type: 'object' as const,
    additionalProperties: false,
    required: Object.keys(properties).filter((k) => !optional.includes(k)),
    properties,
  });

  const counts: Record<string, SchemaObject> = Object.fromEntries(
    ['created', 'succeeded', 'failed', 'cancelled', 'refunded', 'retries'].map((k) => [
      k,
      { type: 'integer', minimum: 0 },
    ]),
  );

  return {
    PaymentStatus: { type: 'string', enum: [...PAYMENT_STATUSES] },
    PaymentMethod: strict({
      brand: { type: 'string', enum: Object.values(CardBrand) },
      last4: { type: 'string', pattern: '^\\d{4}$' },
      expMonth: { type: 'integer', minimum: 1, maximum: 12 },
      expYear: { type: 'integer' },
    }),
    Payment: strict({
      id: { type: 'string', format: 'uuid' },
      amount: { type: 'integer', minimum: 1, description: 'Minor units.' },
      currency: { type: 'string', enum: [...SUPPORTED_CURRENCIES] },
      status: ref('PaymentStatus'),
      paymentMethod: ref('PaymentMethod'),
      customerEmail: { type: 'string', format: 'email' },
      description: nullable({ type: 'string' }),
      failureCode: nullable({ type: 'string', enum: Object.values(PaymentFailureCode) }),
      failureMessage: nullable({ type: 'string' }),
      attempts: {
        type: 'integer',
        minimum: 0,
        description: 'Gateway attempts made so far.',
      },
      version: {
        type: 'integer',
        minimum: 1,
        description: 'Incremented on every change; also returned as the ETag.',
      },
      createdAt: isoDateTime,
      updatedAt: isoDateTime,
      processedAt: nullable({
        ...isoDateTime,
        description: 'When processing ended (SUCCEEDED or FAILED).',
      }),
    }),
    PaymentEvent: strict({
      id: { type: 'string', format: 'uuid' },
      sequence: {
        type: 'integer',
        minimum: 1,
        description: 'Strictly increasing across all events; the SSE event id.',
      },
      paymentId: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: Object.values(PaymentEventType) },
      fromStatus: nullable(ref('PaymentStatus')),
      toStatus: nullable(ref('PaymentStatus')),
      reason: nullable({ type: 'string' }),
      metadata: {
        type: 'object',
        description:
          'Context such as actor, attempt, authorizationCode, requestId or jobId.',
      },
      createdAt: isoDateTime,
    }),
    PaymentStreamMessage: strict({
      type: { type: 'string', enum: Object.values(PaymentEventType) },
      payment: ref('Payment'),
      event: ref('PaymentEvent'),
    }),
    Stats: strict({
      countsByStatus: {
        type: 'object',
        additionalProperties: false,
        required: [...PAYMENT_STATUSES],
        properties: Object.fromEntries(
          PAYMENT_STATUSES.map((s) => [s, { type: 'integer', minimum: 0 }]),
        ),
      },
      total: { type: 'integer', minimum: 0 },
      successRate: nullable({ type: 'number', minimum: 0, maximum: 1 }),
      volumeByCurrency: {
        type: 'object',
        description: 'Captured volume (currently SUCCEEDED) in minor units per currency.',
        propertyNames: { enum: [...SUPPORTED_CURRENCIES] },
        additionalProperties: { type: 'integer', minimum: 0 },
      },
      processingTimeMs: strict({
        p50: nullable({ type: 'integer' }),
        p95: nullable({ type: 'integer' }),
      }),
    }),
    Insights: strict({
      range: { type: 'string', enum: [...INSIGHT_RANGES] },
      from: isoDateTime,
      to: isoDateTime,
      bucketMs: { type: 'integer', minimum: 1 },
      buckets: {
        type: 'array',
        description: 'Activity per bucket, counted from audit events, oldest first.',
        items: strict({
          start: isoDateTime,
          ...counts,
        }),
      },
      totals: strict({
        ...counts,
        approvalRate: nullable({ type: 'number', minimum: 0, maximum: 1 }),
        approvedVolumeByCurrency: {
          type: 'object',
          description: 'Minor units approved in the window per currency.',
          propertyNames: { enum: [...SUPPORTED_CURRENCIES] },
          additionalProperties: { type: 'integer', minimum: 0 },
        },
        ratePerMinute: {
          type: 'number',
          minimum: 0,
          description: 'Payments accepted per minute over the last five minutes.',
        },
        inFlight: {
          type: 'integer',
          minimum: 0,
          description: 'PENDING or PROCESSING now.',
        },
      }),
      latencyMs: strict({
        p50: nullable({ type: 'integer' }),
        p95: nullable({ type: 'integer' }),
      }),
      failures: strict({
        byCode: { type: 'array', items: ref('CodeCount') },
        retriesByCode: { type: 'array', items: ref('CodeCount') },
        attempts: {
          type: 'array',
          items: strict({
            attempts: { type: 'integer', minimum: 0 },
            succeeded: { type: 'integer', minimum: 0 },
            failed: { type: 'integer', minimum: 0 },
          }),
        },
        firstAttemptSuccess: { type: 'integer', minimum: 0 },
        recoveredByRetry: { type: 'integer', minimum: 0 },
        failedAfterRetries: { type: 'integer', minimum: 0 },
      }),
    }),
    CodeCount: strict({
      code: { type: 'string', enum: Object.values(PaymentFailureCode) },
      count: { type: 'integer', minimum: 0 },
    }),
    PaymentRequest: strict({
      idempotencyKey: nullable({ type: 'string' }),
      replayCount: { type: 'integer', minimum: 0 },
      lastReplayedAt: nullable(isoDateTime),
      keyExpiresAt: nullable(isoDateTime),
      request: strict({
        method: { const: 'POST' },
        path: { type: 'string' },
        body: {
          type: 'object',
          description: 'The body as received, card number and CVC masked.',
        },
      }),
      response: nullable(
        strict({
          status: { type: 'integer' },
          body: { description: 'The stored response every replay receives.' },
        }),
      ),
    }),
    CursorPagination: strict({
      limit: { type: 'integer' },
      nextCursor: nullable({ type: 'string' }),
      hasMore: { type: 'boolean' },
    }),
    ValidationIssue: strict({
      location: { type: 'string', enum: ['body', 'query', 'params', 'headers'] },
      field: {
        type: 'string',
        description: 'Dot path within the location; empty for the whole.',
      },
      messages: { type: 'array', items: { type: 'string' } },
    }),
    Error: strict({
      success: { const: false },
      message: { type: 'string' },
      error: strict(
        {
          code: { type: 'string', enum: Object.values(ErrorCode) },
          details: {
            anyOf: [{ type: 'array', items: ref('ValidationIssue') }, { type: 'object' }],
          },
        },
        ['details'],
      ),
      requestId: { type: 'string' },
    }),
    PaymentResponse: envelope(ref('Payment')),
    PaymentPageResponse: {
      ...envelope({ type: 'array', items: ref('Payment') }),
      required: ['success', 'message', 'data', 'pagination'],
      properties: {
        ...envelope({ type: 'array', items: ref('Payment') }).properties,
        pagination: ref('CursorPagination'),
      },
    },
    PaymentEventsResponse: envelope({ type: 'array', items: ref('PaymentEvent') }),
    StatsResponse: envelope(ref('Stats')),
    InsightsResponse: envelope(ref('Insights')),
    PaymentRequestResponse: envelope(ref('PaymentRequest')),
    Liveness: envelope(
      strict({
        status: { const: 'ok' },
        uptimeSeconds: { type: 'integer' },
        version: { type: 'string' },
      }),
    ),
    Readiness: {
      type: 'object',
      additionalProperties: false,
      required: ['success', 'message', 'data'],
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: strict({
          ready: { type: 'boolean' },
          checks: {
            type: 'object',
            additionalProperties: strict({
              status: { type: 'string', enum: ['up', 'down'] },
              critical: { type: 'boolean' },
              latencyMs: { type: 'integer' },
            }),
          },
        }),
      },
    },
  };
}

function envelope(
  data: SchemaObject,
): SchemaObject & { properties: Record<string, SchemaObject> } {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'message', 'data'],
    properties: { success: { const: true }, message: { type: 'string' }, data },
  };
}
