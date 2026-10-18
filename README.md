# Payment Simulation

A payment processing service you can watch working. An Express API accepts payments, a background
worker runs them through a simulated card gateway (with latency, declines, timeouts and retries),
and a Next.js dashboard shows every payment move through its lifecycle in real time over
Server-Sent Events.

It is built to be poked at: idempotent creates, optimistic locking with ETags, a strict state
machine, rate limits and exponential backoff are all visible in the API and the UI.

```
apps/
  api/        Express 5 service: REST + SSE, payment worker, JSON file persistence
  web/        Next.js dashboard: overview, payments, payment detail, load simulator
packages/
  shared/     Contracts used by both: state machine, DTOs and validation, error codes, test cards
```

## Setup

### Requirements

- Node.js 24 or newer (see `.nvmrc`)
- pnpm 9 (`corepack enable` picks up the version pinned in `package.json`)

You don't need a database or any other services. The API stores everything in one JSON file.

### Install and run

```bash
pnpm install          # also builds packages/shared (postinstall)
pnpm dev              # API on http://localhost:4000, dashboard on http://localhost:3000
```

`pnpm dev` runs the shared package in watch mode alongside both apps. Open
<http://localhost:3000> for the dashboard and <http://localhost:4000/docs> for the API docs.

### Configuration

Both apps run with no configuration. To change anything, copy the examples:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

The API validates every value at boot and refuses to start on a bad one. These are the settings
you're most likely to change:

| Variable                                                | Default                 | Notes                                                             |
| ------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `PORT`                                                  | `4000`                  |                                                                   |
| `CORS_ORIGINS`                                          | `http://localhost:3000` | Comma-separated list of dashboard origins allowed to call the API |
| `DATA_FILE`                                             | `./data/payments.json`  | Leave empty to keep data in memory only. One API process per file |
| `TRUST_PROXY`                                           | `0`                     | Set to `1` behind a platform load balancer                        |
| `WORKER_ENABLED`                                        | `true`                  | Set to `false` to run an API-only process                         |
| `GATEWAY_DECLINE_RATE` / `GATEWAY_TRANSIENT_ERROR_RATE` | `0.1` / `0.15`          | Random behaviour for cards that aren't [test cards](#test-cards)  |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WRITE_MAX`               | `300` / `60`            | Requests per `RATE_LIMIT_WINDOW_MS` (60 s) per client             |
| `NEXT_PUBLIC_API_URL` (web)                             | `http://localhost:4000` | Where the browser reaches the API. Baked in at build time         |

`apps/api/.env.example` documents the full list, including worker, retry, gateway latency and SSE
settings.

### Demo data

To fill the data file with five days of synthetic traffic, including a flash-sale spike, stop the
API first (the seed script takes the data file's lock) and run:

```bash
pnpm --filter @payment-sim/api seed                         # into ./data/payments.json
pnpm --filter @payment-sim/api seed -- --days 7 --reset     # replace existing data
```

Seeded data is clearly synthetic: customers use `example.com`, cards are the test cards, and every
event carries `synthetic: true`. The same `--seed <n>` always produces the same data.

## Using it

### The payment lifecycle

```
PENDING ──system──▶ PROCESSING ──system──▶ SUCCEEDED ──client──▶ REFUNDED
   │                     │
   └──client──▶ CANCELLED └──system──▶ FAILED
```

Creating a payment returns `202 Accepted` with the payment in `PENDING`. The worker picks it up,
moves it to `PROCESSING` and calls the gateway. A retryable failure (processing error or timeout)
is retried with exponential backoff and full jitter, up to 4 attempts in total. Each failed
attempt is recorded as an event. Clients can make only two moves: cancel a `PENDING` payment, or
refund a `SUCCEEDED` one. `packages/shared/src/state-machine.ts` defines the lifecycle, and the API
and the UI both use it.

### Test cards

Any future expiry date and any 3-digit CVC work.

| Card number           | Outcome                                                       |
| --------------------- | ------------------------------------------------------------- |
| `4242 4242 4242 4242` | Approved on the first attempt                                 |
| `5555 5555 5555 4444` | Approved on the first attempt (Mastercard)                    |
| `4000 0000 0000 0002` | Declined, `card_declined`. Not retried                        |
| `4000 0000 0000 9995` | Declined, `insufficient_funds`. Not retried                   |
| `4000 0000 0000 0119` | Fails twice with a retryable error, then succeeds             |
| `4000 0000 0000 0077` | Every attempt times out. Fails with `gateway_timeout` after 4 |

Any other valid (Luhn-checked) card number declines or fails transiently at the configured random
rates. The API stores only the card brand, last four digits and expiry, never the full number or
CVC.

### Dashboard

| Page        | What it's for                                                                        |
| ----------- | ------------------------------------------------------------------------------------ |
| Overview    | Approval rate, live pipeline, outcomes over time and failure analysis by time range  |
| Payments    | Searchable, filterable list that updates live                                        |
| Payment     | Status, every gateway attempt drawn to scale, event timeline, refund/cancel actions  |
| Simulator   | Fire a burst of payments with a chosen card mix and watch the outcomes               |
| New payment | Create a single payment (also opens from any screen; `⌘K` opens the command palette) |

## API

Base URL: `http://localhost:4000/api/v1`. The OpenAPI document is served at `/docs/openapi.json`,
with Swagger UI at `/docs`.

### Endpoints

| Method  | Path                    | Description                                                              |
| ------- | ----------------------- | ------------------------------------------------------------------------ |
| `POST`  | `/payments`             | Create a payment. Requires `Idempotency-Key`. Returns `202`              |
| `GET`   | `/payments`             | List payments, newest first, cursor-paginated                            |
| `GET`   | `/payments/:id`         | Get one payment. Sends an `ETag` with its version                        |
| `PATCH` | `/payments/:id/status`  | Cancel or refund. Honours `If-Match`                                     |
| `GET`   | `/payments/:id/events`  | The payment's audit trail                                                |
| `GET`   | `/payments/:id/request` | The masked original request and the stored response that replays receive |
| `GET`   | `/stats`                | Counts and totals by status                                              |
| `GET`   | `/stats/insights`       | Insights for `?range=15m\|1h\|24h\|7d` (default `1h`)                    |
| `GET`   | `/stream`               | SSE stream of every payment event                                        |
| `GET`   | `/payments/:id/stream`  | SSE stream for one payment, starting with a `snapshot`                   |

Health probes sit at the root, outside the rate limiter: `GET /health` (liveness) and `GET /ready`
(readiness, `503` until the store is usable).

### Create a payment

```bash
curl -i http://localhost:4000/api/v1/payments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-1001' \
  -d '{
    "amount": 250000,
    "currency": "NGN",
    "card": { "number": "4242424242424242", "expMonth": 12, "expYear": 2030, "cvc": "123" },
    "customerEmail": "ada@example.com",
    "description": "Order #1001"
  }'
```

- `amount` is an integer in the currency's minor unit (kobo, cents). For example, `250000` NGN
  is ₦2,500.00.
- `currency` must be one of `NGN`, `USD`, `EUR`, `GBP`, `KES`, `GHS`, `ZAR` or `JPY`.
- `card.holderName` and `description` are optional.

**Idempotency.** `Idempotency-Key` is required: 1 to 255 printable ASCII characters, no spaces.
Sending the same key with the same body within 24 hours returns the original response, with
`Idempotent-Replayed: true`, and doesn't create a second payment. Reusing a key with a different
body returns `422 IDEMPOTENCY_KEY_REUSED`.

### Change a payment's status

```bash
curl -i -X PATCH http://localhost:4000/api/v1/payments/<id>/status \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "3"' \
  -d '{ "status": "REFUNDED", "reason": "Item returned" }'
```

`status` must be `CANCELLED` or `REFUNDED`, and the move has to be allowed from the payment's
current status (otherwise `409 INVALID_STATE_TRANSITION`). `If-Match` is optional. When you send
it, the API rejects the change with `412 PRECONDITION_FAILED` if the payment has moved past the
version you last read. That stops a stale screen from overwriting a newer change.

### List payments

`GET /payments` accepts:

| Query         | Description                                                                   |
| ------------- | ----------------------------------------------------------------------------- |
| `limit`       | 1 to 100, default 20                                                          |
| `cursor`      | `pagination.nextCursor` from the previous page                                |
| `status`      | Filter by status                                                              |
| `currency`    | Filter by currency                                                            |
| `from` / `to` | ISO 8601 bounds on `createdAt`                                                |
| `q`           | Search an id prefix, customer email or description (ignores case and accents) |

### Responses and errors

Successful responses look like `{ "success": true, "message": "...", "data": ... }`. Lists add
`pagination: { limit, nextCursor, hasMore }`. Errors always have this shape:

```json
{
  "success": false,
  "message": "Cannot move a FAILED payment to REFUNDED",
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "details": { "from": "FAILED", "to": "REFUNDED", "allowed": [] }
  },
  "requestId": "6f1c…"
}
```

Branch on `error.code`, not on the HTTP status:

| Status | Codes                                                                   |
| ------ | ----------------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR` (with per-field details), `IDEMPOTENCY_KEY_REQUIRED` |
| `404`  | `NOT_FOUND`                                                             |
| `409`  | `INVALID_STATE_TRANSITION`, `CONCURRENT_MODIFICATION` (safe to retry)   |
| `412`  | `PRECONDITION_FAILED` (stale `If-Match`)                                |
| `413`  | `PAYLOAD_TOO_LARGE`                                                     |
| `422`  | `IDEMPOTENCY_KEY_REUSED`                                                |
| `429`  | `RATE_LIMITED` (see `RateLimit` and `Retry-After` headers)              |
| `503`  | `SERVICE_UNAVAILABLE` (with `Retry-After`)                              |
| `500`  | `INTERNAL_ERROR`                                                        |

Every response carries an `X-Request-Id` header. You can send your own, and the API logs it.

### Live updates (SSE)

```bash
curl -N http://localhost:4000/api/v1/stream
```

The stream sends these event types: `payment.created`, `payment.status_changed` and
`payment.attempt_failed`. Each event's `id` is a global, gap-free sequence number. To resume
after a disconnect, send `Last-Event-ID` (`EventSource` does this automatically) or
`?lastEventId=<n>`, and the API replays what you missed, up to `SSE_REPLAY_LIMIT` events. The
per-payment stream starts with a `snapshot` event holding the current payment.

## Testing

```bash
pnpm test         # every package
pnpm typecheck
pnpm lint
pnpm format:check
```

Per package, with coverage:

```bash
pnpm --filter @payment-sim/shared test:cov   # Jest, 100% coverage enforced
pnpm --filter @payment-sim/api test:cov      # Jest, 90% statements/functions/lines, 80% branches
pnpm --filter @payment-sim/web test          # Vitest + Testing Library (jsdom)
```

- **shared** covers the state machine, currency maths, card validation and the DTOs.
- **api** runs unit tests and full-stack tests together in one suite (`*.spec.ts`). The
  full-stack tests boot the real app in-process with supertest, against an in-memory or
  temporary-file store, so they need no external services. They check responses against the
  OpenAPI document and cover idempotency, ETags, state transitions, retries, rate limits and the
  SSE streams.
- **web** covers components and hooks (`*.test.ts(x)`).

CI (`.github/workflows/ci.yml`) runs format, lint, typecheck and build, then all three test suites
with their coverage gates, on every push to `main` and every pull request.

### Manual checks

With `pnpm dev` running, create a payment with each [test card](#test-cards) and watch it on the
dashboard. You should see:

- `…0119` gets two failed attempts with growing backoff gaps, then succeeds.
- `…0077` times out four times, then fails.
- Repeating the `curl` create above with the same `Idempotency-Key` returns the same payment with
  `Idempotent-Replayed: true`.
- Refunding a `FAILED` payment returns `409`.

The Simulator page sends a burst of traffic, so you can watch retries and rate limits under load.

## Deploying

Deploy the API and the dashboard as two separate Node services built from the repo root, so the
workspace and `packages/shared` resolve.

| Service | Build                                     | Start                                                     |
| ------- | ----------------------------------------- | --------------------------------------------------------- |
| API     | `pnpm --filter @payment-sim/api... build` | `pnpm --filter @payment-sim/api start`                    |
| Web     | `pnpm --filter @payment-sim/web... build` | `pnpm --filter @payment-sim/web exec next start -p $PORT` |

- The trailing `...` builds `packages/shared` first. Don't rely on `postinstall` for this: a
  platform that restores `node_modules` from its build cache skips it.
- The dashboard needs a Node server, not static hosting, because `/payments/[id]` is rendered on
  request.
- Set `NEXT_PUBLIC_API_URL` on the web service before it builds. On the API, set `CORS_ORIGINS`
  to the dashboard's URL and `TRUST_PROXY=1`.
- Run a single API instance. On a platform with an ephemeral disk, data lasts until the next
  restart unless `DATA_FILE` points at a persistent volume.
