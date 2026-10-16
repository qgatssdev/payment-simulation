# Payment Simulation: product

## Who uses it

Engineers and technical reviewers. They are judging a payment service: does it accept payments
safely, process them reliably in the background, and tell the truth about what happened? They
use it mostly on a laptop, sometimes on a phone. They arrive curious and sceptical, and they poke
at the edges: retries, duplicates, races, failures.

## The job it is hired for

**"Show me, live, that this payment system behaves correctly, and why each payment ended the way it did."**

Every screen starts from the question the user arrives with:

| Screen      | The question                        | What answers it first                                   |
| ----------- | ----------------------------------- | ------------------------------------------------------- |
| Overview    | How are payments doing right now?   | Approval rate (the hero figure), then the live pipeline |
| Payments    | Where is that payment?              | Search box, then newest-first rows that change live     |
| Payment     | What happened to this one, and why? | Amount and status, then every gateway attempt to scale  |
| Simulator   | What happens under load?            | Live counters while it runs, then a summary             |
| New payment | Will this card succeed?             | Test cards labelled with the outcome they produce       |

## What success looks like

- A reviewer understands the lifecycle in seconds by watching payments move through the pipeline.
- Any failure can be explained from the payment page alone: reason, attempts, backoff, request,
  response, request id.
- Retries, idempotency, optimistic locking and rate limits are visible, never hidden.
- Nothing ever shows a full card number, and nothing silently overwrites a change.

## Principles

1. **Show the system working.** Live by default: events stream in and move the numbers, the
   pipeline and the rows. A stale view says so.
2. **One answer first.** Every screen leads with the single number or visual that answers its
   question; detail follows.
3. **Explain failure in the product's words.** Say what went wrong and how to fix it, with the
   API's error code and request id: "This payment changed since you loaded it (412)."
4. **The API is the truth.** The UI never offers what the state machine forbids, and it never
   bypasses ETag/If-Match, idempotency, or 409, 412 and 422.
5. **Honest numbers.** One axis per chart, whole-unit headlines, an outlier drawn broken rather
   than allowed to flatten everything else, and synthetic data labelled as synthetic.

## Beyond the original screens

- Insights by time range (15m, 1h, 24h, 7d) from a new `GET /stats/insights` endpoint:
  approval rate, approved volume, payments per minute, time to final state, retries rescued.
- The live pipeline (the signature view).
- Outcomes over time: approvals above the line, failures below it.
- Failure analysis: reasons, what retries rescued, and attempts per payment.
- Gateway attempts drawn to scale, with backoff gaps. Each attempt's start and duration is now
  recorded on its event.
- A request/response inspector from a new `GET /payments/:id/request` endpoint: the masked
  original request, the stored 202 response that replays receive, and the replay count.
- Search: `?q=` on `GET /payments`, matching an id prefix, email or description, ignoring case
  and accents.
- A ⌘K command palette, filters kept in the URL, and copy buttons on IDs.
- A new-payment sheet that opens from any screen.
- A simulator with spread and card mix options, live outcomes, rejected requests and a summary.
- Light, Dark and Auto themes, designed separately.
- A seed script that writes several days of synthetic, believable activity.
