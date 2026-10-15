import { Result } from './result';

describe('Result', () => {
  it('carries a value on success', () => {
    const result = Result.ok(42);
    expect(result.isSuccess).toBe(true);
    expect(result.isFailure).toBe(false);
    expect(result.getValue()).toBe(42);
    expect(() => result.errorValue()).toThrow(/successful Result/);
  });

  it('supports a value-less success', () => {
    const result = Result.ok();
    expect(result.isSuccess).toBe(true);
    expect(result.getValue()).toBeUndefined();
  });

  it('carries a typed error on failure', () => {
    const result = Result.fail<number, { reason: string }>({ reason: 'nope' });
    expect(result.isFailure).toBe(true);
    expect(result.errorValue()).toEqual({ reason: 'nope' });
    expect(() => result.getValue()).toThrow(/failed Result/);
  });

  it('is immutable', () => {
    expect(Object.isFrozen(Result.ok(1))).toBe(true);
  });

  it('combine returns the first failure, or ok', () => {
    expect(Result.combine([Result.ok(1), Result.ok('a')]).isSuccess).toBe(true);
    const combined = Result.combine([
      Result.ok(1),
      Result.fail('first'),
      Result.fail('second'),
    ]);
    expect(combined.errorValue()).toBe('first');
  });
});
