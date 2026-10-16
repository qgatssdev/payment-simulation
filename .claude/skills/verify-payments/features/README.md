# Payment simulation verification map

The maintained source for verifying what users of the payment simulation see. Read this index, then use the matching feature file as the recipe. Each feature has canned journeys in `journeys/` that `scripts/browse.mjs` runs as-is.

## Baseline preconditions

- An instance launched by `scripts/launch.sh` in this shell (`$API_URL`, `$WEB_URL`, `$EVIDENCE_DIR` exported), and `scripts/doctor.sh` passing.
- Starts empty; journeys create what they inspect. Payments from earlier journeys in the same run stay visible, so assertions target the payment a journey created (its `paymentId`, or a description containing `${runId}`).
- Never drive an instance this run did not launch.

## Driving conventions

- UI through `node scripts/browse.mjs <journey> <steps.json>`; API through curl against `$API_URL`.
- Locate by role and accessible name or by label (see the handles in `SKILL.md`), never by CSS or position.
- Prefer waiting for an observable state (`expect`, `expectText`, `expectCount`) over `wait`.
- Every POST carries an `Idempotency-Key` containing `$RUN_ID`.

## Proof and skip reporting

- A UI proof is the journey's `transcript.txt` (all PASS), its ARIA snapshots and screenshot, and `browser-problems.txt` reading `none`.
- A state change is confirmed through a second view: `GET $API_URL/api/v1/payments/<id>` and `/events`.
- An API proof is the saved request headers and response body.
- Record the feature ID and entry point with each artefact; a skipped entry point is reported as skipped, not as verified through another path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph on the user-visible behaviour, then exactly four H2s in order: `Sub-features` (short IDs), `How to get to it (user POV)` (every entry point), `Driving it with browse.mjs and curl` (starts with `Preconditions:`, then labelled bullets pairing an action with an exact command and an observable result), and `Gotchas`.

## Features

- [Create a payment](./create-payment.md) covers the form, test cards, client-side validation with the API's rules, and the API create call.
- [Payment lifecycle](./payment-lifecycle.md) covers asynchronous processing seen live: success, declines, retries with backoff, timeouts, the timeline and the lifecycle diagram.
- [Cancel and refund](./status-actions.md) covers client status changes, the state machine's limits, and If-Match concurrency control.
- [Idempotent creation](./idempotency.md) covers replays, key reuse, and concurrent duplicates.
- [Dashboard](./dashboard.md) covers statistics, the status chart, the live table with filters and pagination, and the load simulator.
