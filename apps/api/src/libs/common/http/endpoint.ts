import type { RequestLocation, ValidationIssue } from '@payment-sim/shared';
import type { ClassConstructor } from 'class-transformer';
import type { Request, RequestHandler, Response } from 'express';
import { Guard } from '../../core/domain/logic/guard';
import { ValidationError } from '../../core/errors';

export interface EndpointSchemas<B, Q, P> {
  body?: ClassConstructor<B>;
  query?: ClassConstructor<Q>;
  params?: ClassConstructor<P>;
}

export interface EndpointInput<B, Q, P> {
  body: B;
  query: Q;
  params: P;
}

/**
 * Express counterpart of Nest's ValidationPipe + @Body()/@Query()/@Param(): validate every
 * declared part of the request against its DTO, report all issues at once, and hand the
 * handler typed instances. Express 5 forwards the returned promise's rejection to the error
 * middleware, so no asyncHandler wrapper is needed.
 *
 * Validated values are passed as arguments rather than written back to `req`, because
 * Express 5 exposes `req.query` as a read-only getter.
 */
export function endpoint<B = undefined, Q = undefined, P = undefined>(
  schemas: EndpointSchemas<B, Q, P>,
  handler: (input: EndpointInput<B, Q, P>, req: Request, res: Response) => unknown,
): RequestHandler {
  return async (req, res) => {
    const issues: ValidationIssue[] = [];

    async function parse<T extends object>(
      cls: ClassConstructor<T> | undefined,
      raw: unknown,
      location: RequestLocation,
    ): Promise<T | undefined> {
      if (!cls) return undefined;
      const result = await Guard.validate(cls, raw, location);
      if (result.isFailure) {
        issues.push(...result.errorValue());
        return undefined;
      }
      return result.getValue();
    }

    const [body, query, params] = await Promise.all([
      // No JSON content-type leaves req.body undefined; validate as empty so required fields are reported.
      parse(schemas.body as ClassConstructor<object> | undefined, req.body ?? {}, 'body'),
      parse(schemas.query as ClassConstructor<object> | undefined, req.query, 'query'),
      parse(schemas.params as ClassConstructor<object> | undefined, req.params, 'params'),
    ]);

    if (issues.length > 0) throw new ValidationError(issues);

    await handler({ body, query, params } as EndpointInput<B, Q, P>, req, res);
  };
}
