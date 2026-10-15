import type { RequestLocation, ValidationIssue } from '@payment-sim/shared';
import type { ClassConstructor } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import type { ValidationError as ClassValidatorError } from 'class-validator';
import { validate } from 'class-validator';
import { Result } from './result';

/**
 * Turn untrusted input into a validated DTO instance. Adapted from the nest-template's Guard,
 * which surfaced only the first error; this reports every issue with its full dot path so a
 * client can fix a form in one round trip.
 */
export const Guard = {
  async validate<T extends object>(
    cls: ClassConstructor<T>,
    input: unknown,
    location: RequestLocation,
  ): Promise<Result<T, ValidationIssue[]>> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return Result.fail([
        { location, field: '', messages: [`${location} must be a JSON object`] },
      ]);
    }
    const instance = plainToInstance(cls, input);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    });
    return errors.length === 0
      ? Result.ok(instance)
      : Result.fail(flattenErrors(errors, location));
  },
};

export function flattenErrors(
  errors: ClassValidatorError[],
  location: RequestLocation,
  parent = '',
): ValidationIssue[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own: ValidationIssue[] = error.constraints
      ? [{ location, field, messages: Object.values(error.constraints) }]
      : [];
    return [...own, ...flattenErrors(error.children ?? [], location, field)];
  });
}
