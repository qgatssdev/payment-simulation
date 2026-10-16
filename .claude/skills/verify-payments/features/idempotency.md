# Idempotent creation

Creating a payment requires an `Idempotency-Key`. Repeating the same request with the same key returns the original response (marked `Idempotent-Replayed: true`) and creates nothing; the same key with a different request is refused; duplicates sent at the same time still create exactly one payment. The form reuses its key when retrying after a network or server error.

## Sub-features

- `idem-replay` a repeated request replays the stored 202 response.
- `idem-mismatch` a key reused for a different body is `422 IDEMPOTENCY_KEY_REUSED`.
- `idem-race` concurrent duplicates create one payment.
- `idem-required` a POST without the header is `400 IDEMPOTENCY_KEY_REQUIRED`.

## How to get to it (user POV)

- `POST $API_URL/api/v1/payments` with the `Idempotency-Key` header.
- The New payment form, which shows the key it used under `Create payment` after a submit.

## Driving it with browse.mjs and curl

Preconditions:

- `scripts/doctor.sh` passes; `mkdir -p "$EVIDENCE_DIR/api"`.
- `BODY='{"amount":5000,"currency":"USD","customerEmail":"verify@example.com","description":"verify idempotency","card":{"number":"4242424242424242","expMonth":12,"expYear":2030,"cvc":"123"}}'` and `KEY="verify-$RUN_ID-idem"`.

- **First request.** Run `curl -s -D "$EVIDENCE_DIR/api/idem-1.headers" -o "$EVIDENCE_DIR/api/idem-1.json" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d "$BODY" "$API_URL/api/v1/payments"`. Headers show `202 Accepted`, `Location`, `ETag: "1"`, no `Idempotent-Replayed`.
- **Replay.** Repeat into `idem-2.*`. Headers show `202` and `Idempotent-Replayed: true`; `cmp "$EVIDENCE_DIR/api/idem-1.json" "$EVIDENCE_DIR/api/idem-2.json"` reports no difference.
- **Exactly one payment.** Run `curl -s "$API_URL/api/v1/payments?limit=100" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.filter(p=>p.description==="verify idempotency").length'`. Prints `1`.
- **Mismatch.** Repeat with `${BODY/5000/5001}` and the same key. Status `422`, `error.code` `IDEMPOTENCY_KEY_REUSED`.
- **Race.** With a new key, run `for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code} ' -H 'Content-Type: application/json' -H "Idempotency-Key: verify-$RUN_ID-race" -d "${BODY/verify idempotency/verify race}" "$API_URL/api/v1/payments" & done; wait`. Six `202`s; the count query with `"verify race"` prints `1`.

## Gotchas

- The request fingerprint ignores formatting (spacing, case, card spaces) and the CVC, so those differences are not a mismatch.
- Keys expire after 24 hours and are then reusable; within a run they never expire.
- The form only shows its key after the first submit attempt, and starts a new key after a success or a validation error.
