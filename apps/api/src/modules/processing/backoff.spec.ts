import { backoffDelay } from './backoff';

const policy = { baseDelayMs: 1000, maxDelayMs: 30_000 };

describe('backoffDelay', () => {
  it.each([
    [1, 1000],
    [2, 2000],
    [3, 4000],
    [5, 16_000],
    [6, 30_000],
    [20, 30_000],
  ])('attempt %i has a ceiling of %i ms', (attempt, ceiling) => {
    expect(backoffDelay(attempt, policy, () => 0.999999)).toBe(ceiling);
  });

  it('jitters uniformly below the ceiling', () => {
    expect(backoffDelay(3, policy, () => 0)).toBe(0);
    expect(backoffDelay(3, policy, () => 0.5)).toBe(2000);
  });

  it('treats attempt 0 like attempt 1 and handles a zero base', () => {
    expect(backoffDelay(0, policy, () => 0.999999)).toBe(1000);
    expect(backoffDelay(4, { baseDelayMs: 0, maxDelayMs: 0 })).toBe(0);
  });
});
