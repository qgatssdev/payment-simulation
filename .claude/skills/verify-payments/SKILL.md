---
name: verify-payments
description: Launch an isolated copy of the payment simulation (Express API + Next.js dashboard, JSON file storage) and prove behaviour the way a user sees it — driving the dashboard in Chrome via Playwright and the REST/SSE API via curl — with evidence saved to artifacts/verify/. Use after changing payments, processing, live updates or the web UI, or when asked to verify, demo or reproduce something end to end.
---

# Verify the payment simulation

Two processes: the **API** (`apps/api`, Express, JSON file persistence, background worker, SSE streams) and the **web dashboard** (`apps/web`, Next.js). Users touch the dashboard first, the REST API second (`/docs` documents it). Every run gets its own ports, data file and evidence directory, so it never touches a developer's `pnpm dev` or their `apps/api/data/`.

All commands run from the repository root. Scripts live in `.claude/skills/verify-payments/scripts/`; the feature map is `features/README.md` — read it before driving anything.

## Launch

```bash
eval "$(.claude/skills/verify-payments/scripts/launch.sh)"        # or: launch.sh <run-id>
```

- Builds `shared`, the API and the web app (the web build bakes in this run's API URL; ~10–15 s), picks two free ports, starts both with `nohup`, and waits until the instance is **usable**: `/ready` is 200 (storage writable), the dashboard renders, and the live stream answers with `retry:`.
- Exports `RUN_ID RUN_DIR EVIDENCE_DIR API_URL WEB_URL API_PORT WEB_PORT API_PID WEB_PID DATA_FILE` into your shell. Keep that shell, or re-load with `source "$RUN_DIR/state.env"`.
- Starts from an empty data file (`$RUN_DIR/payments.json`, created on the first write). No seed data is needed: every journey creates the payments it inspects.
- The gateway runs with short latencies so outcomes arrive quickly: success/decline in ~1 s, the flaky card after two retries in ~3 s, the timeout card fails after ~8 s.
- Extra API settings go in `API_ENV` (space-separated `NAME=value`, applied last). The worker claims a new payment the instant it commits, so a payment is PENDING for only milliseconds; to drive **cancel**, launch a separate run with the worker off: `eval "$(API_ENV="WORKER_ENABLED=false" .claude/skills/verify-payments/scripts/launch.sh cancel)"`. Payments then stay PENDING indefinitely, so lifecycle journeys do not work in that run.
- On failure it prints log tails and the state lines; run Cleanup with that `RUN_DIR`.

Isolation: one run per checkout at a time — `next build` holds a lock and rewrites `apps/web/.next`, so do not launch while someone else is building the web app in this checkout. Different checkouts can run side by side.

## Doctor

```bash
.claude/skills/verify-payments/scripts/doctor.sh
```

Read-only (GET requests and process/port inspection). Checks: both PIDs alive and each owning its recorded port; `/health` ok; `/ready` true; the data file's lock holds this run's API PID (proves the API is using this run's file, not someone else's); the dashboard renders and its bundle points at this run's API URL; the live stream answers. Run it before the first drive and again after anything surprising. Exit code is non-zero on any failure.

## Drive

**UI** — `browse.mjs` runs a JSON list of steps in Chrome (falls back to Playwright's Chromium), locating elements only by ARIA role + accessible name or by label:

```bash
node .claude/skills/verify-payments/scripts/browse.mjs <journey-name> <steps.json>
# e.g. the canned journey for a feature:
node .claude/skills/verify-payments/scripts/browse.mjs create-payment \
  .claude/skills/verify-payments/features/journeys/create-payment.json
```

Step types (full list at the top of `browse.mjs`): `goto`, `click {role,name,exact?}`, `fill {label,value}`, `select {label,value}`, `expect {role,name,timeout?}`, `expectText`, `expectEnabled`, `expectCount {role,name,min}`, `expectUrl`, `saveUrlMatch {var,regex}`, `snapshot`, `screenshot`, `wait`. Strings may use `${runId}` and saved variables such as `${paymentId}`. Write one-off step files to `$RUN_DIR` (scratch), not into the skill.

Stable handles in this app: pages `/` (Overview), `/payments`, `/payments/<id>`, `/payments/new`, `/simulator`; buttons `Create payment` / `Cancel payment` / `Refund payment` / `Run simulation` / `Load more` / `New payment` (opens a sheet from any screen); radios `Success (ending 4242)`, `Declined (ending 0002)`, `Insufficient funds (ending 9995)`, `Flaky gateway (ending 0119)`, `Gateway timeout (ending 0077)`; status regions `Status: <STATUS>` (payment page) and `Live updates: Live|Connecting…|Reconnecting…`; list `Payment timeline`; table `Payments, newest first`; row links `Open payment <description>`; search field `Search payments`; pipeline nodes `<Status>: <n> payments now…` (role img); tabs `Request` / `Response` / `Current` / `Events` on the payment page.

**API** — curl against `$API_URL` (recipes in each feature file). Always send `Idempotency-Key` on POST; use a key containing `$RUN_ID`.

## Evidence

Everything for a run lands in `artifacts/verify/$RUN_ID/` (gitignored):

- `<journey>/transcript.txt` — every step with PASS/FAIL and timing; `<journey>/*.aria.txt` — ARIA snapshots of the states a step names; `<journey>/*.png` — full-page screenshots; `<journey>/vars.json` — ids captured (e.g. `paymentId`); `<journey>/browser-problems.txt` — console errors, page errors, failed requests, HTTP ≥ 400 (must read `none` for a clean proof; aborted `/stream` connections and aborted Next.js `?_rsc=` router fetches are expected and excluded); on failure `failure.png` + `failure.aria.txt`.
- Save curl proofs yourself: `curl -s -D "$EVIDENCE_DIR/api/<name>.headers" -o "$EVIDENCE_DIR/api/<name>.json" ...` (create `$EVIDENCE_DIR/api` first).
- `run.env` (the run's ports and paths) and, after cleanup, `server/` with `api.log`, `web.log`, `build.log` and `payments.final.json` — the data file as the run left it.

Proof standards:

- Drive the real user path: the dashboard and form, or the public API. Never write the data file directly or call internal code to set up a state you are proving.
- Capture the action and the resulting state (a snapshot before and after, or the request and the response), not just the final screen.
- Verify side effects through a second view: after the UI says SUCCEEDED, confirm with `GET $API_URL/api/v1/payments/<id>` and its `/events`; `payments.final.json` shows what was persisted (it must never contain a full card number or CVC).
- The only mock is the payment gateway, which is simulated by design (test cards in `packages/shared/src/test-cards.ts`).
- A journey that fails is reported as failed, with its `failure.*` artefacts. Never edit a journey to make it pass without understanding the failure.

## Cleanup

```bash
.claude/skills/verify-payments/scripts/cleanup.sh
```

Stops only the recorded PIDs, and only while each still owns this run's port (never by process name — Next.js renames itself to `next-server`, and other Next apps may be running). Copies server logs and the final data file into `$EVIDENCE_DIR/server/`, then deletes `$RUN_DIR`. Evidence is never deleted. If something cannot be stopped it says so, keeps `$RUN_DIR`, and exits non-zero; re-run it after fixing. Run it after every run, including failed ones.

## Helpers

| Script               | Invocation                                    | Purpose                         |
| -------------------- | --------------------------------------------- | ------------------------------- |
| `scripts/launch.sh`  | `eval "$(scripts/launch.sh [run-id])"`        | build, start, wait until usable |
| `scripts/doctor.sh`  | `scripts/doctor.sh`                           | read-only health check          |
| `scripts/browse.mjs` | `node scripts/browse.mjs <name> <steps.json>` | drive the UI, record evidence   |
| `scripts/cleanup.sh` | `scripts/cleanup.sh`                          | stop this run, keep evidence    |

Requirements: Node 24, pnpm 9, `pnpm install` done (Playwright is a root dev dependency), Google Chrome or `npx playwright install chromium`.

Keep `features/` honest as the app changes: `/maintain-verification-skill`.
