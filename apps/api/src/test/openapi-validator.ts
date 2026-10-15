import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type {
  OpenAPIObject,
  ReferenceObject,
  ResponseObject,
  SchemaObject,
} from 'openapi3-ts/oas31';

/**
 * Validates values against schemas inside an OpenAPI 3.1 document (whose schema dialect is
 * JSON Schema 2020-12). Used by the tests to hold examples and real responses to the docs.
 */
export class OpenApiValidator {
  private readonly ajv: Ajv2020;

  constructor(private readonly document: OpenAPIObject) {
    // strict: false tolerates OpenAPI-only annotations such as `example`.
    this.ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(this.ajv);
    this.ajv.addSchema({ $id: 'spec', components: document.components }, 'spec');
  }

  /** Returns validation error messages; empty when the value conforms. */
  validate(schema: SchemaObject | ReferenceObject, value: unknown): string[] {
    const target =
      '$ref' in schema && typeof schema.$ref === 'string'
        ? { $ref: `spec${schema.$ref}` }
        : { ...schema, $id: undefined };
    const validate = this.ajv.compile(target);
    if (validate(value)) return [];
    return (validate.errors ?? []).map(
      (e) => `${e.instancePath || '(root)'} ${e.message ?? ''}`,
    );
  }

  /** The documented response for an operation and status, with component $refs resolved. */
  response(
    method: string,
    pathTemplate: string,
    status: number,
  ): ResponseObject | undefined {
    const operation = (
      this.document.paths?.[pathTemplate] as Record<string, unknown> | undefined
    )?.[method.toLowerCase()] as
      { responses?: Record<string, ResponseObject | ReferenceObject> } | undefined;
    const response = operation?.responses?.[String(status)];
    if (!response) return undefined;
    if ('$ref' in response) {
      const name = response.$ref.split('/').pop() ?? '';
      return this.document.components?.responses?.[name] as ResponseObject | undefined;
    }
    return response;
  }

  /** Every (method, path, status) the document promises a JSON body for. */
  documentedJsonResponses(): string[] {
    const keys: string[] = [];
    for (const [path, item] of Object.entries(this.document.paths ?? {})) {
      for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
        const responses =
          (operation as { responses?: Record<string, unknown> }).responses ?? {};
        for (const status of Object.keys(responses)) {
          if (
            this.response(method, path, Number(status))?.content?.['application/json']
          ) {
            keys.push(`${method.toUpperCase()} ${path} ${status}`);
          }
        }
      }
    }
    return keys.sort();
  }
}
