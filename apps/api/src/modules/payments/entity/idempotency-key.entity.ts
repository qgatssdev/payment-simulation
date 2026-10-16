/**
 * Claimed as the first write of the transaction that creates the payment, and completed with
 * the response before it commits. Transactions are serialized, so a concurrent request with the
 * same key waits for the first to finish, then replays its stored response; if the first rolls
 * back, its claim disappears with it. A committed key therefore always has a response.
 */
export interface IdempotencyKey {
  key: string;
  /** SHA-256 of the normalised request: the same key with a different request is a client bug. */
  requestHash: string;
  responseStatus: number | null;
  responseBody: object | null;
  paymentId: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** How many repeated requests were answered with the stored response (absent: none yet). */
  replayCount?: number;
  lastReplayedAt?: Date | null;
}
