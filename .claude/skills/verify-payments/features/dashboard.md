# Dashboard

The dashboard summarises all payments (count, success rate, captured volume per currency, p50/p95 processing time), charts payments by status, lists payments newest first with status and currency filters and cursor pagination, and updates live as payments change. Its load simulator fires a burst of concurrent payments across every test-card scenario.

## Sub-features

- `dash-stats` stat tiles and the payments-by-status chart reflect current data.
- `dash-live` the table and stats update without reload (`Live updates: Live`).
- `dash-simulate` `Run simulation` sends N concurrent payments and reports how many were accepted.
- `dash-paginate` `Load more` appends the next page.
- `dash-filter` the `Status` and `Currency` selects filter the table.

## How to get to it (user POV)

- Open `$WEB_URL/` or choose `Dashboard` in the header.
- `GET $API_URL/api/v1/stats`, `GET $API_URL/api/v1/payments?status=&currency=&limit=&cursor=`, and the global stream `GET $API_URL/api/v1/stream`.

## Driving it with browse.mjs and curl

Preconditions:

- `scripts/doctor.sh` passes.

- **Simulate and watch.** Choose `Run simulation` (25 payments). Run `node .claude/skills/verify-payments/scripts/browse.mjs dashboard .claude/skills/verify-payments/features/journeys/dashboard.json`. The status `25 of 25 sent · 25 accepted …` appears, at least 15 `Open payment Load test …` links show without a reload, and after ~12 s the chart and tiles show settled counts.
- **Pagination.** In the same journey, `Load more` raises the `Open payment Load test` link count to at least 25.
- **Filter.** In the same journey, `Status` set to `FAILED` leaves only failed rows (check `04-filtered-failed.aria.txt`: every row's status reads `Failed`).
- **Stats, second view.** Run `curl -s "$API_URL/api/v1/stats"`. `total` matches the payments created this run; `countsByStatus` sums to `total`; `successRate` is `(SUCCEEDED+REFUNDED)/(SUCCEEDED+REFUNDED+FAILED)`.
- **Filtered list, second view.** Run `curl -s "$API_URL/api/v1/payments?status=FAILED&limit=100"`. Every item has `"status":"FAILED"`; failures come from the decline, insufficient-funds and timeout cards plus random failures of card `4111…1111`.

## Gotchas

- The simulator's card mix includes `4111111111111111`, whose outcome is random (configurable decline and transient-error rates); exact success counts vary between runs.
- Payments created in the same millisecond are ordered by id, not by their `Load test #` number; assert on counts, not on which number lands on which page.
- Stats and new rows refresh at most once a second after a burst; rows already on screen update immediately.
- The chart is `aria-hidden` with an equivalent screen-reader table captioned `Payments by status`; read values from that table in snapshots.
