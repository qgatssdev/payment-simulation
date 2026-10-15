export interface BackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Exponential backoff with full jitter: a uniformly random delay in [0, min(max, base·2^(n-1))].
 * The randomness spreads retries out, so a gateway outage that fails many payments at once
 * is not followed by all of them retrying in lockstep.
 */
export function backoffDelay(
  attempt: number,
  { baseDelayMs, maxDelayMs }: BackoffPolicy,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(random() * ceiling);
}
