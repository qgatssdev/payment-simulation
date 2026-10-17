@AGENTS.md

# Payment Simulation web

Next.js (App Router) + TypeScript, Tailwind with the hand-built kit in `components/ui`, TanStack
Query for server state, react-hook-form validated by the shared class-validator DTOs, sonner.
Same layout as prior-auth and expense-tracker. The design rules are in the root `DESIGN.md`.

```
pnpm dev         # from the repo root: API on :4000, dashboard on :3000
pnpm --filter @payment-sim/web typecheck
pnpm --filter @payment-sim/web test
```

## Layout

- `src/app/(main-app)` is the app shell (sidebar, top bar, bottom tabs) and its pages. Each
  `page.tsx` is thin (metadata + `<XView />`); its pieces live in a sibling `components/` folder.
- `src/services/<domain>/` has one folder per API area: `<domain>.route.ts` (URLs), `index.ts`
  (calls through `apiHandler`), `queries.ts` / `mutation.ts` (TanStack Query hooks, keys and
  cache writers), `types.ts` (request payloads; responses come from `@payment-sim/shared`).
  `services/api` holds `apiHandler` and `ApiError`.
- `src/providers` is the live event stream (`live.provider.tsx`); `app/providers.tsx` composes it
  with the query client and toaster.
- `src/common` has feature components used by more than one route (status badges, the payment
  form, the throughput chart). `src/components` has `ui/` (the design-system kit) and `layout/`
  (shell, nav, page header, command palette).
- `src/validations` holds the payment form resolver. `src/utils` holds formatting, vocabulary,
  query params, theme and toasts. `src/hooks` holds reusable hooks. `src/config` holds env values.
- Files are camelCase (`paymentsTable.tsx`); route files keep Next's names (`page.tsx`).

## Rules

- The lifecycle lives in `@payment-sim/shared` (`canTransition`). The UI only offers moves the
  shared state machine allows, and the API still enforces them.
- Form validation uses the same DTOs as the API; never restate those rules by hand.
- Live updates go through the single stream in `providers/live.provider.tsx`, which writes into
  the query cache. Do not open extra app-wide EventSources.
