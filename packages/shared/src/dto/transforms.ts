/**
 * class-transformer @Transform helpers. Non-string input is passed through untouched so the
 * validators report the type error instead of the transform throwing.
 */
export const mapString =
  (fn: (value: string) => string) =>
  ({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? fn(value) : value;

export const trimString = mapString((s) => s.trim());
export const upperString = mapString((s) => s.trim().toUpperCase());
export const lowerString = mapString((s) => s.trim().toLowerCase());
