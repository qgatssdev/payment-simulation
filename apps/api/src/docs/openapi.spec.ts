import SwaggerParser from '@apidevtools/swagger-parser';
import { TEST_CARDS } from '@payment-sim/shared';
import type { OpenAPIObject, OperationObject, SchemaObject } from 'openapi3-ts/oas31';
import request from 'supertest';
import { buildTestApp } from '../test/helpers';
import { API_VERSION, buildOpenApiDocument } from './openapi';
import { OpenApiValidator } from '../test/openapi-validator';

const document = buildOpenApiDocument(API_VERSION);
const operations = Object.values(document.paths ?? {}).flatMap((item) =>
  Object.values(item as Record<string, OperationObject>),
);

describe('OpenAPI document', () => {
  it('is a valid OpenAPI 3.1 document with every $ref resolvable', async () => {
    // The parser dereferences in place; give it a copy.
    await expect(
      SwaggerParser.validate(structuredClone(document) as never),
    ).resolves.toBeDefined();
  });

  it('gives every operation a unique id, a tag and a summary', () => {
    const ids = operations.map((op) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const op of operations) {
      expect(op.tags?.length).toBeGreaterThan(0);
      expect(op.summary).toBeTruthy();
    }
  });

  it('every request example validates against its own schema', () => {
    const validator = new OpenApiValidator(document);
    let checked = 0;
    for (const op of operations) {
      const body = op.requestBody as
        | {
            content: Record<
              string,
              { schema: SchemaObject; examples?: Record<string, { value: unknown }> }
            >;
          }
        | undefined;
      for (const media of Object.values(body?.content ?? {})) {
        for (const [name, example] of Object.entries(media.examples ?? {})) {
          expect({
            name,
            errors: validator.validate(media.schema, example.value),
          }).toEqual({
            name,
            errors: [],
          });
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it('documents request constraints from the DTOs, including custom validators', () => {
    const schemas = document.components?.schemas as Record<string, SchemaObject>;
    const create = schemas.CreatePaymentDto as SchemaObject;
    const card = schemas.CardDto as SchemaObject;

    expect(create.additionalProperties).toBe(false);
    expect(create.required?.sort()).toEqual([
      'amount',
      'card',
      'currency',
      'customerEmail',
    ]);
    expect(card.properties?.number).toMatchObject({
      pattern: '^\\d{12,19}$',
      description: expect.stringContaining('Luhn') as unknown,
    });
    expect(card.properties?.expYear).toMatchObject({
      description: expect.stringContaining('not be in the past') as unknown,
    });
  });

  it('derives list query parameters from ListPaymentsQueryDto', () => {
    const list = (document.paths?.['/api/v1/payments'] as { get: OperationObject }).get;
    const names = (list.parameters as Array<{ name: string }>).map((p) => p.name).sort();
    expect(names).toEqual(['currency', 'cursor', 'from', 'limit', 'q', 'status', 'to']);
  });

  it('lists every test card in the description', () => {
    for (const card of TEST_CARDS) {
      expect(document.info.description).toContain(card.number);
    }
  });
});

describe('docs endpoints', () => {
  const app = buildTestApp();

  it('serves the raw document', async () => {
    const res = await request(app).get('/docs/openapi.json');
    expect(res.status).toBe(200);
    expect((res.body as OpenAPIObject).openapi).toBe('3.1.0');
  });

  it('serves Swagger UI whose assets load under the API’s CSP', async () => {
    const page = await request(app).get('/docs/');
    expect(page.status).toBe(200);
    expect(page.text).toContain('swagger-ui');
    const csp = page.headers['content-security-policy'] as string;
    expect(csp).toContain("script-src 'self'");
    // No inline scripts: everything the page runs comes from same-origin files.
    expect(page.text).not.toMatch(/<script>(?!\s*<\/script>)/);

    const scripts = [...page.text.matchAll(/<script src="\.\/([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(scripts).toEqual(
      expect.arrayContaining(['swagger-ui-bundle.js', 'swagger-ui-init.js']),
    );
    for (const script of scripts) {
      const res = await request(app).get(`/docs/${script}`);
      expect({ script, status: res.status }).toEqual({ script, status: 200 });
    }
  });
});
