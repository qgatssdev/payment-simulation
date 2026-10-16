# Payment lifecycle

After creation a payment is processed in the background: the worker moves it to PROCESSING, charges the simulated gateway, retries retryable failures with backoff, and settles it as SUCCEEDED or FAILED. The payment page shows this live (no reload): the status badge, every gateway attempt drawn to scale with the backoff between retries, the lifecycle path, the timeline of audit events, and a JSON inspector with the original request (card masked), the stored response replays receive, the current resource and the events.

## Sub-features

- `life-success` PENDING → PROCESSING → SUCCEEDED for a good card.
- `life-decline` a decline or insufficient funds fails at once, with the reason shown, no retry.
- `life-retry` the flaky card fails twice with retryable errors, then succeeds; each failed attempt is in the timeline.
- `life-timeout` the timeout card exhausts its attempts and fails with `gateway_timeout`.
- `life-live` updates arrive over SSE without reloading; reconnecting resumes from `Last-Event-ID`.
- `life-attempts` the `Gateway attempts` panel lists each attempt (`#1`, `#2`, …) with when it started, how long it took, and its result; events carry `startedAt` and `durationMs`.
- `life-inspect` the `Request` / `Response` / `Current` / `Events` tabs show the creating request with the card number masked (`•••• •••• •••• 4242`), its idempotency key and replay count.

## How to get to it (user POV)

- Create a payment; the app opens its page at `/payments/<id>`.
- Choose a payment's `Open payment …` link on `/payments`, a row in `Live activity` on the overview, or search for it with ⌘K.
- `GET $API_URL/api/v1/payments/<id>/request` for the creating request and its idempotency record.
- `GET $API_URL/api/v1/payments/<id>/events` for the timeline; `GET $API_URL/api/v1/payments/<id>/stream` for the live stream.

## Driving it with browse.mjs and curl

Preconditions:

- `scripts/doctor.sh` passes (launch sets short gateway latencies; the timings below depend on them).

- **Retries, live.** Create with `Flaky gateway (ending 0119)` and stay on the page. Run `node .claude/skills/verify-payments/scripts/browse.mjs lifecycle-flaky .claude/skills/verify-payments/features/journeys/lifecycle-flaky.json`. `Live updates: Live` shows, then `Gateway attempt 1 failed`, `Gateway attempt 2 failed`, then `Status: SUCCEEDED` and `Processing → Succeeded`, within ~5 s and without a reload.
- **Decline.** Create with `Insufficient funds (ending 9995)`. Run `node .claude/skills/verify-payments/scripts/browse.mjs lifecycle-declined .claude/skills/verify-payments/features/journeys/lifecycle-declined.json`. `Status: FAILED`, the text `The card has insufficient funds`, and both `Cancel payment` and `Refund payment` disabled.
- **Timeline, second view.** Run `curl -s "$API_URL/api/v1/payments/<id>/events"`. Events are ordered by `sequence`; the flaky payment shows `payment.created`, `payment.status_changed` (to PROCESSING), two `payment.attempt_failed` (metadata `attempt` 1 and 2, `code` `processing_error`), and `payment.status_changed` to SUCCEEDED with an `authorizationCode`.
- **Attempts and request, second view.** Run `curl -s "$API_URL/api/v1/payments/<id>/request"`. `request.body.card.number` is `•••• •••• •••• 0119` (never the full number), `idempotencyKey` is the key the form sent, and `response.status` is `202`. In `/events`, each `payment.attempt_failed` carries `startedAt`, `durationMs` and `retryAt`.
- **Timeout.** Create via the API with card `4000000000000077` (see create-payment), wait ~10 s, then `curl -s "$API_URL/api/v1/payments/<id>"`. `"status":"FAILED"`, `"failureCode":"gateway_timeout"`, `"attempts":4`, and the message ends `gave up after 4 attempts`.
- **Stream resume.** Run `curl -sN --max-time 2 -H 'Last-Event-ID: 0' "$API_URL/api/v1/payments/<id>/stream"`. It replays the payment's events as `id: <sequence>` / `event: payment.*` frames, oldest first, with no `snapshot` frame.

## Gotchas

- Without `Last-Event-ID` the per-payment stream starts with an unnumbered `snapshot` frame; with it, a replay instead.
- `curl` on a stream always ends by timeout; judge by the frames received, not its exit code.
- The detail page's status badge is the `Status: <STATUS>` region; the badge text alone also appears in the dashboard table.
- A crash consumes an attempt: after a forced restart a timeline can skip an attempt number. That is intended, not a lost event.
