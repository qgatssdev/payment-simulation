# Overview, payments list and simulator

The overview answers "how are payments doing?" for a time window (`15m`, `1h`, `24h`, `7d`, kept in the URL as `?range=`): approval rate as the hero figure, approved volume, payments per minute, time to final state and payments rescued by retry; the live pipeline (the state machine with each state's count, payments animating between states as events stream in); outcomes over time; live activity; and why payments failed. The payments page lists everything newest first with search and filters in the URL. The simulator fires a run of concurrent payments and follows each one live to a summary.

## Sub-features

- `dash-headline` hero approval rate and the four headline tiles reflect `GET /stats/insights` for the chosen range.
- `dash-pipeline` the pipeline shows `GET /stats` counts per state and moves with the stream (`Live updates: Live`).
- `dash-failures` why payments failed, what retries rescued, attempts per payment.
- `dash-simulate` `Run simulation` sends N payments (at once or spread), tracks them to a `Summary`, and lists rejected requests (rate limits) separately.
- `dash-list` payments list: `Load more`, `Status` and `Currency` filters, search by id, email or description (accent-insensitive), all reflected in the URL.
- `dash-palette` ⌘K opens a palette that searches payments and runs commands.

## How to get to it (user POV)

- Overview: `$WEB_URL/` (sidebar `Overview`). Payments: `$WEB_URL/payments`. Simulator: `$WEB_URL/simulator`. Phone: the bottom tab bar.
- `GET $API_URL/api/v1/stats/insights?range=1h`, `GET $API_URL/api/v1/stats`, `GET $API_URL/api/v1/payments?q=&status=&currency=&limit=&cursor=`, and the global stream `GET $API_URL/api/v1/stream`.

## Driving it with browse.mjs and curl

Preconditions:

- `scripts/doctor.sh` passes.

- **Simulate, list, filter, overview.** Run `node .claude/skills/verify-payments/scripts/browse.mjs dashboard .claude/skills/verify-payments/features/journeys/dashboard.json`. On `/simulator` the status `25 of 25 sent · 25 accepted · …` appears and the heading turns `Run complete` with a `Summary`; on `/payments` at least 15, then (after `Load more`) 25 `Open payment Load test …` links show; `Status` `FAILED` puts `status=FAILED` in the URL and leaves only failed rows (`04-filtered-failed.aria.txt`); `/` shows the `Overview` heading, the pipeline node `Succeeded: N payments now…` and `Why payments failed`.
- **Insights, second view.** Run `curl -s "$API_URL/api/v1/stats/insights?range=15m"`. `totals.created` is at least 25; `buckets` has 30 entries whose `created` sum equals `totals.created`; `failures.byCode` lists the decline, insufficient-funds and timeout failures of the run.
- **Search, second view.** Run `curl -s "$API_URL/api/v1/payments?q=load%20test&limit=100"`. Every item's description contains `Load test`; `q=koko` would match `Kòkó` (accents are ignored).
- **Stats.** Run `curl -s "$API_URL/api/v1/stats"`. `countsByStatus` sums to `total`.

## Gotchas

- The simulator's `Every scenario` mix includes `4111111111111111`, whose outcome is random; exact success counts vary.
- The API allows 60 writes a minute per client (`RATE_LIMIT_WRITE_MAX`): a 100-payment run shows `RATE_LIMITED (429)` under `Rejected requests`. That is the rate limit working, not a failure of the journey.
- Payments created in the same millisecond are ordered by id; assert on counts, not on which `Load test #` lands on which page.
- The simulator tags each run's descriptions with `run xxxx`; `See these payments` opens `/payments?q=run xxxx`.
- Lists and insights refresh at most once a second after a burst; rows already on screen, pipeline counts and the activity feed update immediately.
- Charts are `aria-hidden` with screen-reader tables (`Payment outcomes per …`); the pipeline nodes are `role="img"` named `<Status>: <n> payments now. …`.
