# Payment Simulation: design system

The rules that keep new screens consistent. The tokens live in one file:
[`apps/web/src/app/globals.css`](apps/web/src/app/globals.css). The status and failure-reason
vocabulary lives in [`apps/web/src/lib/vocabulary.ts`](apps/web/src/lib/vocabulary.ts).

## Direction

- **Brand: fuchsia `#B8269F`** (dark `#C13AA8`). It is the one hue no status or data series
  uses. Measured against every data hue it is at least 17 ΔE apart in normal vision and 9 under
  colour-blindness simulation, so the primary action can never be mistaken for a payment state.
- **Surfaces:** white panels with soft offset shadows on a faintly mauve page (`#F5F4F7`). There
  are no borders between content. Dark mode has its own plum-black steps (page `#111014`, panel
  `#1B1A1F`, sunken `#29272E`); it is not an inversion.
- **Type:** Mona Sans for everything, with tabular figures for amounts, rates and counts.
  JetBrains Mono is used only for real code-like data: IDs, JSON, request IDs.
- **Signature visual:** the live pipeline. The state machine is drawn as a track, each state shows
  its count, and as events stream in a dot in the destination status's colour travels the edge
  the payment took. Retried attempts circle the loop above Processing.

## Reference study

These were captured from seesaw.website's Fintech and Developer Tools picks: Stripe, Linear,
Mercury, Spade, Raindrop, Fun and PostHog, at 1440 and 390 wide. What makes them good:

- **Type:** big, tight display sizes. Stripe and Fun set headlines around 56–64px with negative
  tracking. Body text is 14–16px; secondary text is the same size in a lighter ink, not smaller.
- **Big numbers:** Mercury sets a balance at about 3× body size, with small superscript cents and
  a quiet label beside it. One headline figure per view.
- **Spacing:** generous outer margins with tight internal groups. Cards sit on a tinted page, not
  on white.
- **Corners and shadows:** 12–20px radii. Soft shadows separate surfaces; hairlines appear only
  inside tables.
- **Colour:** used sparingly. One accent for the primary action (Stripe's blurple button, Linear's
  near-monochrome UI with a single status yellow). Status is an icon plus a word, as in Linear's
  "In Progress".

We borrowed their level of craft, never their layouts.

## Tokens

| Group    | Tokens                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces | `--page`, `--panel`, `--panel-2` (inset), `--sunken` (controls, tracks), `--hairline` (table rows only), `--scrim`                              |
| Ink      | `--ink` (primary), `--ink-2` (secondary), `--ink-3` (muted; at least 4.5:1 on panel and page in both modes)                                     |
| Brand    | `--brand`, `--brand-press`, `--brand-ink` (brand-coloured text: active nav, links), `--brand-wash` (selection, active background), `--on-brand` |
| Status   | `--status-{pending,processing,succeeded,failed,cancelled,refunded}`                                                                             |
| Reasons  | `--reason-{declined,insufficient,processing,timeout,other}`                                                                                     |
| Charts   | `--grid` (hairline gridlines), `--axis` (baseline, edges)                                                                                       |
| Shape    | `--radius-panel` 20px, `--radius-control` 12px. Sheets and the palette use 24–28px.                                                             |
| Shadow   | `--shadow-1` (panels), `--shadow-2` (floating), `--shadow-brand` (primary button, hero)                                                         |
| Motion   | `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`                                                                                                    |

The Tailwind names mirror the tokens (`bg-panel`, `text-ink-2`, `bg-brand-wash`, `shadow-panel`,
`rounded-panel`). The theme is chosen with `<html data-theme="light|dark">`; with no attribute
it follows the OS (Auto). An inline boot script applies the saved choice before first paint.

## Status vocabulary

Each status has one word, one icon and one colour, used identically in the pipeline, badges,
tables, timelines, charts and the palette. A status always appears as **icon + word**: the icon
wears the colour, the word stays in ink.

| Status     | Icon            | Light     | Dark      | Meaning                                 |
| ---------- | --------------- | --------- | --------- | --------------------------------------- |
| Pending    | Clock           | `#6B7489` | `#8790A6` | Accepted, queued                        |
| Processing | Spinning loader | `#2A78D6` | `#3987E5` | Charging, retrying                      |
| Succeeded  | Check           | `#0CA30C` | `#0CA30C` | Approved, captured                      |
| Failed     | Cross           | `#D03B3B` | `#E66767` | Declined, or retries ran out            |
| Cancelled  | Ban             | `#8A8780` | `#8F8C85` | Stopped by the client before processing |
| Refunded   | Undo            | `#6250D6` | `#9085E9` | Captured, then returned                 |

**Failure reasons** have their own categorical hues, always shown in this fixed order (it is the
validated adjacency):

| Reason                            | Icon        | Light     | Dark      |
| --------------------------------- | ----------- | --------- | --------- |
| Declined                          | ShieldX     | `#EB6834` | `#D95926` |
| Insufficient funds                | Wallet      | `#1BAF7A` | `#199E70` |
| Processing error                  | ServerCrash | `#EDA100` | `#C98500` |
| Gateway timeout                   | TimerOff    | `#E87BA4` | `#D55181` |
| Expired card (folds into "other") | CalendarX   | `#8A8780` | `#8F8C85` |

**Test-card scenarios** wear the term for the outcome they produce. The success cards wear
Succeeded, the flaky card wears Processing error, the timeout card wears Gateway timeout, and a
random card is neutral.

**Validation.** Both sets were checked with the dataviz palette validator against `--panel` in
each mode. They pass the adjacent-pair checks: CVD ΔE at least 8 and normal-vision ΔE at least 15.
In light mode, aqua, magenta and yellow sit below 3:1 contrast, so every bar using them carries a
visible label. Colours are never re-ordered or recomputed per chart.

## Layout

- **Laptop:** a fixed 248px sidebar. From top: the mark, **New payment** (the brand button), the
  ⌘K search trigger, then the nav (Overview, Payments, Simulator, API docs). Live status and the
  theme switch sit at the bottom. Content uses a 12-column grid with a max width of 1320px and
  20px gaps.
- **Phone:** a sticky header (mark, live status, search, theme toggle) and a frosted bottom tab
  bar with **New payment** raised in the middle. Tables become one-line lists. The payment page
  moves Actions to the top.
- Panels never nest. Inside a panel, separate with space, `--panel-2` insets or table hairlines.

## Numbers and money

- Money comes from minor units, with the currency's own symbol and digits: `₦2,500.00`, `£975.14`,
  `¥1,500` (`formatMoney`). Headline tiles shorten it: `₦2.1M` (`formatMoneyCompact`).
- One hero number per screen, using the `hero-number` utility: 56px, −0.035em tracking, tabular.
  It is the approval rate on the overview and the amount on the payment page.
- Headline rates and averages are whole units (`87%`). Durations use `formatMs`: `840 ms`, `1.6 s`,
  `28 s`, `4 min`.
- Live numbers tick to their new value (`NumberTicker`, 450ms ease-out) rather than jumping.

## Charts

- One y-axis. For outcomes over time, approvals rise above the baseline and failures and
  cancellations hang below it, at the same scale, so green and red never touch. A neutral
  dashed line traces payments accepted.
- Marks are thin, with 4px rounded data ends and square baseline ends. Gridlines are hairlines;
  bars have a 2px surface gap between them.
- A legend appears for 2+ series. Hover gives a tooltip per column. Every chart has an
  equivalent screen-reader table.
- When one bucket is more than 3× the next, the scale fits the rest and that bar is drawn broken,
  labelled with its real value (`sideScale`).
- Live charts keep a fixed column count. Heights transition in place; nothing reflows.

## Motion

Motion is used only where it means something:

- **Press:** `pressable` scales to 0.97 over 160ms.
- **Sheets:** slide in from the right on a laptop and up from the bottom on a phone, in 320ms.
- **Pipeline:** a dot travels the edge in 900ms with an ease-out curve, and the node it reaches
  pulses.
- **Arrivals:** a new row or event gets a brief brand wash (`animate-arrive`, 1.2s), never a
  page-wide flash.

`prefers-reduced-motion` turns all of it off. The pipeline then only pulses the node.

## Components

| Component                                    | Where                                      | Notes                                                                             |
| -------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `Button`, `buttonClasses`                    | `components/ui/button.tsx`                 | `primary` (brand, one per view), `secondary`, `danger`, `ghost`; `sm`, `md`, `lg` |
| `Card`, `CardHeader`                         | `components/ui/card.tsx`                   | A panel with a title and an optional description and actions                      |
| `TextField`, `SelectField`, `controlClasses` | `components/ui/field.tsx`                  | Label, hint and error wired with `aria-describedby`                               |
| `Segmented`                                  | `components/ui/segmented.tsx`              | A radio group: ranges, run sizes, theme                                           |
| `Sheet`                                      | `components/ui/sheet.tsx`                  | Modal; Escape and the scrim close it; focus returns                               |
| `CopyButton`                                 | `components/ui/copy-button.tsx`            | Accessible name "Copy payment ID"; announces "copied"                             |
| `NumberTicker`                               | `components/ui/number-ticker.tsx`          | Tabular, eased, respects reduced motion                                           |
| `EmptyState`, `ErrorState`                   | `components/ui/states.tsx`                 | Says why, and the way forward; errors show the code and request id                |
| `StatusBadge`, `ReasonBadge`, `TermDot`      | `components/status-badge.tsx`              | The vocabulary in UI form                                                         |
| `LiveIndicator`, `StreamBanner`              | `components/shell/`                        | Stream status; the "Live updates paused" banner after 2.5s down                   |
| `Pipeline`                                   | `components/overview/pipeline.tsx`         | The signature view; dots drawn imperatively by a `DotEngine`                      |
| `ThroughputChart`                            | `components/overview/throughput-chart.tsx` | Mirrored outcomes chart, also used by the simulator                               |
| `AttemptTimeline`                            | `components/payments/attempt-timeline.tsx` | Attempts and backoff to scale, plus a table                                       |
| `JsonInspector`                              | `components/payments/json-inspector.tsx`   | Tabs, monochrome JSON, copy                                                       |
| `CommandPalette`                             | `components/shell/command-palette.tsx`     | ⌘K: a combobox with a listbox                                                     |

## Copy

- Use the product's own words: payment, attempt, retry, decline, refund. Buttons name their
  action: "Refund payment", "Run simulation", "Clear filters".
- Errors say what happened and what to do, then the code: "This payment changed since you
  loaded it (412). The latest version is now shown. Check it, then refund again if it still
  applies. PRECONDITION_FAILED · 412 · request …".
- Empty states say why the screen is empty and offer the next step.

## Do

- Reach for a token, never a hex value, in a component.
- Show status as icon + word, from `vocabulary.ts`.
- Keep the brand colour for the primary action, active nav, selection and the hero surface.
- Give every chart a legend (2+ series), a tooltip and a table for assistive tech.
- Keep filters and ranges in the URL.

## Don't

- Small labels above headings, gradient text, thick coloured borders down one side of a card,
  cards inside cards, emoji as icons, or neon glows.
- Coloured text for data: values and labels stay in ink, and the mark carries the colour.
- Re-ordering or re-picking reason hues per chart, or a second y-axis.
- Monospace as decoration.
- A full card number, anywhere.
