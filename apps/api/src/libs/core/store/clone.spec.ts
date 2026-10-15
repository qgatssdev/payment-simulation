import { cloneRecord } from './clone';

class Entity {
  id = 'e1';
  when = new Date('2026-10-15T00:00:00Z');
  nested = { list: [1, { deep: true }] };
  describe(): string {
    return this.id;
  }
}

describe('cloneRecord', () => {
  it('deep-copies plain data, keeping Dates as Dates of this realm', () => {
    const original = { a: 1, b: 'x', c: null, d: [new Date(0), { e: false }] };
    const copy = cloneRecord(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.d).not.toBe(original.d);
    expect(copy.d[0]).toBeInstanceOf(Date);
    expect(copy.d[0]).not.toBe(original.d[0]);
  });

  it('turns class instances into plain data', () => {
    const copy = cloneRecord(new Entity());
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(copy).toEqual({
      id: 'e1',
      when: new Date('2026-10-15T00:00:00Z'),
      nested: { list: [1, { deep: true }] },
    });
  });

  it.each([
    ['a function', { f: () => 1 }, 'record.f is a function'],
    ['a Map', { m: new Map() }, 'record.m is a Map'],
    ['a bigint', { n: 1n }, 'record.n is a bigint'],
    ['a nested symbol', { list: [Symbol('s')] }, 'record.list[0] is a symbol'],
  ])('rejects %s with its path', (_label, value, message) => {
    expect(() => cloneRecord(value)).toThrow(message);
  });
});
