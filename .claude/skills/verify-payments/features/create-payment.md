# Create a payment

A user enters an amount, currency, customer email and card on the New payment page (or POSTs to the API), the browser validates it with the same class-validator rules the API enforces, and on success the payment is accepted (202) and the user lands on its live payment page.

## Sub-features

- `create-form` creates a payment from the New payment form and opens its page.
- `create-test-cards` fills the card number from the test-card picker; each card has a known outcome.
- `create-validation` blocks invalid input in the browser with field-level messages, sending nothing.
- `create-api` creates a payment with `POST /api/v1/payments`.

## How to get to it (user POV)

- Choose `New payment` in the header or the dashboard.
- Open `$WEB_URL/payments/new` directly.
- `POST $API_URL/api/v1/payments` with an `Idempotency-Key` header.

## Driving it with browse.mjs and curl

Preconditions:

- `scripts/doctor.sh` passes.

- **Form to live page.** Pick `Success (ending 4242)`, set amount `1234.56`, submit. Run `node .claude/skills/verify-payments/scripts/browse.mjs create-payment .claude/skills/verify-payments/features/journeys/create-payment.json`. The URL becomes `/payments/<uuid>`, the heading shows `₦1,234.56`, and the region `Status: SUCCEEDED` appears within ~1 s.
- **Validation.** Enter card `4242424242424241` and amount `10.555`, submit. Run `node .claude/skills/verify-payments/scripts/browse.mjs create-payment-invalid .claude/skills/verify-payments/features/journeys/create-payment-invalid.json`. The messages `card number is invalid` and `Enter an amount above zero with at most 2 decimals` appear and the URL stays `/payments/new`.
- **Second view.** Read the saved id with `node -pe "require('./artifacts/verify/$RUN_ID/create-payment/vars.json').paymentId"`, then `curl -s "$API_URL/api/v1/payments/<id>"`. The body has `"amount":123456`, `"currency":"NGN"`, `"status":"SUCCEEDED"`, `"paymentMethod":{"brand":"visa","last4":"4242",...}` and no card number.
- **API create.** Run `curl -s -D - -H 'Content-Type: application/json' -H "Idempotency-Key: verify-$RUN_ID-create" -d '{"amount":5000,"currency":"USD","customerEmail":"verify@example.com","card":{"number":"4242424242424242","expMonth":12,"expYear":2030,"cvc":"123"}}' "$API_URL/api/v1/payments"`. Status `202`, headers `Location: /api/v1/payments/<id>` and `ETag: "1"`, body `"status":"PENDING"`.
- **API validation.** Repeat with `"amount":-5` and a new key. Status `400`, `error.code` `VALIDATION_ERROR`, `error.details[]` naming `amount`.

## Gotchas

- Amounts are typed in major units in the form but sent as integer minor units (`1234.56` NGN is `123456`); JPY has no decimals.
- The test-card radios' accessible names include the last four digits (`Success (ending 4242)`); `Success` alone also matches the Mastercard success card.
- Expiry must be in the future; the form defaults to December next year.
- A POST without `Idempotency-Key` is `400 IDEMPOTENCY_KEY_REQUIRED`, not a validation error on the body.
- After submit, the Next.js router aborts its own `?_rsc=` fetch for the new page and still navigates in-document (the page is a client component); `browse.mjs` excludes that abort. Any other failed request is a real problem.
