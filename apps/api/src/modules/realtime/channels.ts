/** Postgres NOTIFY channels shared by every API instance. */
export const CHANNELS = {
  /** Payload: a PaymentStreamMessage as JSON. */
  PAYMENT_EVENTS: 'payment_events',
  /** No payload: a job became due somewhere; workers should look now rather than at next poll. */
  JOBS_ENQUEUED: 'jobs_enqueued',
} as const;

/** NOTIFY payloads must stay below 8000 bytes; stream messages are bounded well under that. */
export const MAX_NOTIFY_PAYLOAD_BYTES = 7_900;
