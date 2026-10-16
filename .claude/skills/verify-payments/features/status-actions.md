# Cancel and refund

On a payment's page the user can cancel a payment that is still PENDING or refund one that SUCCEEDED, optionally with a reason. The buttons are enabled only when the shared state machine allows the change; each request carries the version the user saw (`If-Match`), so a payment that changed meanwhile is refused rather than overwritten.

## Sub-features

- `act-refund` refunds a succeeded payment with a reason; the timeline records it.
- `act-cancel` cancels a pending payment.
- `act-disabled` unavailable actions are disabled with an explanation.
- `act-illegal` the API refuses transitions the state machine forbids (409).
- `act-stale` a stale `If-Match` version is refused (412).

## How to get to it (user POV)

- The `Actions` card on `/payments/<id>`: `Cancel payment`, `Refund payment`, `Reason (optional)`.
- `PATCH $API_URL/api/v1/payments/<id>/status` with `{"status":"CANCELLED"|"REFUNDED","reason":"..."}` and optionally `If-Match: "<version>"`.

## Driving it with browse.mjs and curl

Preconditions:

- `scripts/doctor.sh` passes.

- **Refund from the UI.** Create with `Success (ending 4242)`, wait for `Status: SUCCEEDED`, enter a reason, choose `Refund payment`. Run `node .claude/skills/verify-payments/scripts/browse.mjs refund .claude/skills/verify-payments/features/journeys/refund.json`. `Status: REFUNDED`, the timeline shows `Succeeded → Refunded` with the reason, and `Refund payment` is now disabled.
- **Cancel from the UI** (needs its own run with the worker off, see Gotchas). Launch with `eval "$(API_ENV="WORKER_ENABLED=false" .claude/skills/verify-payments/scripts/launch.sh cancel)"`, then run `node .claude/skills/verify-payments/scripts/browse.mjs cancel .claude/skills/verify-payments/features/journeys/cancel.json`. The payment shows `Status: PENDING` with `Cancel payment` enabled; after cancelling with a reason it shows `Status: CANCELLED`, the timeline records the reason, and both buttons are disabled. Second view: `GET $API_URL/api/v1/payments/<id>/events` lists `created` then `PENDING → CANCELLED`.
- **Disabled actions.** On any FAILED payment (lifecycle `lifecycle-declined` journey) both buttons are disabled and the page shows `Only pending payments can be cancelled.` and `Only succeeded payments can be refunded.`.
- **Illegal transition.** Run `curl -s -X PATCH -H 'Content-Type: application/json' -d '{"status":"REFUNDED"}' "$API_URL/api/v1/payments/<failed-id>/status"`. Status `409`, `error.code` `INVALID_STATE_TRANSITION`, `details` `{"from":"FAILED","to":"REFUNDED","allowed":[]}`.
- **Stale version.** Run `curl -s -X PATCH -H 'Content-Type: application/json' -H 'If-Match: "1"' -d '{"status":"REFUNDED"}' "$API_URL/api/v1/payments/<succeeded-id>/status"`. Status `412`, `error.code` `PRECONDITION_FAILED`, `details` with `expectedVersion` 1 and the real `currentVersion` (3 for a freshly succeeded payment).
- **System-only status.** `PATCH` with `{"status":"SUCCEEDED"}`. Status `400`, `VALIDATION_ERROR` on `status`.

## Gotchas

- Cancelling needs a PENDING payment, but the worker is woken the moment a payment commits and claims it within milliseconds; even `POST` then `PATCH` in one shell line gets `409 INVALID_STATE_TRANSITION` (verified). Drive cancel only in a run launched with `API_ENV="WORKER_ENABLED=false"`, where payments stay PENDING. Lifecycle, refund and dashboard journeys need a normal run.
- The UI sends the version it last displayed; if live updates moved the payment on, the API answers 412 and the page shows the latest state with an explanatory toast.
- The status badge changes immediately (optimistic) and rolls back if the API refuses; wait for `Status: REFUNDED`, which follows the confirmed response.
