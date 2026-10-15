/**
 * Deep copy of the data the store holds: primitives, Dates, arrays and plain objects. Class
 * instances are copied to plain objects (own enumerable properties), so entities can be put
 * directly and come back as data. Anything that would not survive the JSON file — functions,
 * symbols, Maps, Sets, bigints — is rejected here, at write time, rather than lost on reload.
 *
 * Not structuredClone: that is a host function, so it builds objects in the main realm, and
 * `instanceof Date` then fails inside VM contexts such as Jest's test environment.
 */
export function cloneRecord<T>(value: T, path = 'record'): T {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'object':
      break;
    default:
      throw new TypeError(`${path} is a ${typeof value}, which cannot be stored as JSON`);
  }

  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) {
    return value.map((item: unknown, i) => cloneRecord(item, `${path}[${i}]`)) as T;
  }
  if (value instanceof Map || value instanceof Set) {
    throw new TypeError(
      `${path} is a ${value.constructor.name}, which cannot be stored as JSON`,
    );
  }

  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = cloneRecord(item, `${path}.${key}`);
  }
  return copy as T;
}
