import type { ValidationArguments, ValidationOptions } from 'class-validator';
import { registerDecorator } from 'class-validator';
import { isCardExpired, luhnCheck } from '../card';

export function IsLuhnCardNumber(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isLuhnCardNumber',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: 'card number is invalid', ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && luhnCheck(value),
      },
    });
  };
}

/**
 * Applied to `expYear`; reads `expMonth` from the same object. class-validator has no
 * class-level constraints, so a cross-field rule lives on the field that completes it.
 */
export function IsNotExpiredCard(
  monthProperty: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isNotExpiredCard',
      target: target.constructor,
      propertyName: propertyName as string,
      constraints: [monthProperty],
      options: { message: 'card has expired', ...options },
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [monthKey] = args.constraints as [string];
          const month = (args.object as Record<string, unknown>)[monthKey];
          // Type/range errors on either field are reported by their own decorators.
          if (!Number.isInteger(value) || !Number.isInteger(month)) return true;
          return !isCardExpired(month as number, value as number);
        },
      },
    });
  };
}
