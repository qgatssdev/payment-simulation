import type { ValueTransformer } from 'typeorm';

/**
 * node-postgres returns BIGINT as a string, since it can exceed 2^53. Payment amounts are capped
 * far below that (MAX_PAYMENT_AMOUNT), so they are safe as numbers. Refuse anything unsafe
 * loudly rather than silently losing precision on money.
 */
export const bigintTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null): number | null => {
    if (value === null) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new RangeError(`BIGINT value ${value} is outside the safe integer range`);
    }
    return parsed;
  },
};
