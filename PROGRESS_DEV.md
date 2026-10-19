# Progress (dev branch stretch features)

Continuing "Front Desk" from the frozen main-branch submission (Phases 0-10 in
PROGRESS.md). This file tracks the dev-branch stretch work from SPEC_DEV.md.
Never edits SPEC.md/PROGRESS.md/FINAL_REPORT.md/DONE — those stay frozen.

## Phase plan

- [x] Phase 11: Manual / walk-in booking from the dashboard
- [x] Phase 12: Reminder notifications
- [x] Phase 13: Recurring appointments
- [x] Phase 14: Dashboard analytics
- [ ] Phase 15: Spanish voice support (lower priority, last)

## Log

- Phase 11: `src/booking.ts` — new `createManualAppointment()`: resolves
  business/service/staff by id (not a fuzzy staffHint like the voice tools),
  checks `fitsBusinessHours` + `isSlotFree` (same double-booking guard as
  `hold_appointment`), creates a `confirmed` appointment directly (no hold
  step), upserts the customer by phone if given (so it links to an existing
  OAuth-linked customer) or creates a phone-less one-off customer otherwise,
  and logs a `booked` activity event tagged with the source. `src/dashboard.ts`
  — new `POST /api/appointments` (businessId, serviceId, staffId,
  customerName, customerPhone?, start, source: 'phone'|'walk-in', notes?),
  400 on validation/BookingError, 201 with the created appointment otherwise.
  `public/dashboard.html` — collapsible "Add appointment" form below the
  timeline (service/staff selects, start-time text input, name/phone inputs,
  phone/walk-in source select); submits to the new endpoint and reloads
  `/api/state` on success. Appointments with `source !== "alexa"` already had
  a visually distinct `.other-source` timeline style from Phase 7, so manual
  bookings are automatically distinguished on the board.
  Tests added to `test/e2e.test.ts` (none-mode block): a walk-in booking
  comes back `confirmed` with no hold and shows up in `/api/state`; booking
  the same staff/slot twice returns 400 "already booked". Oauth-mode test:
  linking a customer by phone via `/oauth/authorize`, then POSTing a manual
  booking with that same phone, makes the booking show up in that customer's
  `list_my_appointments` MCP call (code match) — confirms the phone-based
  customer linking from Phase 5 is reused correctly.
  `npm run build` clean; `npm test` 52/52 (49 original + 3 new).

- Phase 12: `src/reminders.ts` — `NotificationSink` interface + `ConsoleNotificationSink`
  (logs via `console.log`, since this sandbox has no SMS/push provider) +
  `setNotificationSink()` for test injection, mirroring `setBedrockClient`.
  `sweepReminders(store, nowMs)` checks every appointment once per sweep:
  (a) a `held`/`holdKind: "customer"` hold past 80% of its TTL (computed
  from `holdExpiresAt - createdAt`, so it stays correct even though
  `HOLD_TTL_MS` is a constant private to `booking.ts`) and not yet expired;
  (b) a `confirmed` appointment with 0 < time-until-start <= 2 hours.
  Idempotency is tracked on the appointment record itself (new optional
  `holdReminderSentAt` / `apptReminderSentAt` fields on `Appointment` in
  `types.ts`, both optional so no existing appointment-construction call site
  needed changes) rather than in a module-level Set, so a server restart
  doesn't cause a double-send. Each firing calls `store.addEvent(...,
  "reminder_sent", ...)` (added `"reminder_sent"` to `ActivityEventType`)
  and the injected sink once. `src/server.ts` runs `sweepReminders` on a
  30-second `setInterval` (`.unref()`'d so it can't keep the process alive
  on its own), started right after the existing `warmUp()` call and cleared
  in the SIGINT/SIGTERM shutdown handler; `createApp()` now also returns the
  interval handle. New `test/reminders.test.ts` (5 tests, unit-level against
  an in-memory `Store` with the randomized seed appointments cleared out):
  a hold fires exactly one reminder once it crosses 80% of its TTL and not
  again on a later sweep; an already-expired or already-confirmed hold never
  fires one; a confirmed appointment fires exactly once inside the 2-hour
  window and not again; firing logs a `reminder_sent` activity event.
  `npm run build` clean; `npm test` 57/57 (52 prior + 5 new). Manually
  smoke-tested booting the real server (`DATA_FILE=:memory:`) and confirmed
  `/health` still responds correctly with the sweep interval running, then
  killed the process.

- Phase 13: recurring appointments. `src/types.ts` — new `RecurrenceFreq`/
  `RecurrenceSpec`, plus `Appointment.seriesId` (shared by every occurrence)
  and `Appointment.pendingRecurrence` (set on a held appointment that
  requested recurrence; materialized into sibling appointments at confirm
  time, then cleared). `src/booking.ts`:
  - `computeOccurrences()` walks weekly/biweekly/monthly from the first
    start (monthly keeps the same day-of-month, which can drift off the
    exact weekday — documented below); `validateOccurrences()` checks every
    occurrence's business-hours fit and double-booking *before* any mutation,
    so a series is rejected atomically (all-or-nothing), matching the
    existing hold/confirm all-or-nothing ethos.
  - `holdAppointment()` takes an optional `recurrence`, stamps a fresh
    `seriesId` + `pendingRecurrence` onto the held appointment, but only
    validates/creates the *first* slot (same as before) — the rest of the
    series isn't materialized until confirm.
  - `confirmAppointment()`, on a still-held appointment with
    `pendingRecurrence` set, validates+creates the remaining `count - 1`
    confirmed siblings in one pass, returning `seriesAppointments` (all
    members, first included) and `seriesFreq`. If any occurrence conflicts,
    it throws before mutating anything — the original hold is left exactly
    as it was (still `"held"`, confirmable again without recurrence, or
    simply expires).
  - `createManualAppointment()` (Phase 11's endpoint) takes the same
    `recurrence` and, since there's no hold step, validates the whole series
    and creates every occurrence as `"confirmed"` directly, atomically.
  - `cancelAppointment()` gained a `scope: "this" | "series"` (default
    `"this"`); `"series"` cancels the target plus every *other* series
    member with `start >= nowMs` (past occurrences, including ones before
    the target, are left alone), offering each freed slot to the waitlist
    same as a normal cancel.
  - `rescheduleAppointment()` gained the same `scope`. SPEC_DEV.md doesn't
    define what "reschedule the whole series" means for a single new
    `new_start` — I chose: compute the delta between the old and new start
    of the *target* occurrence, then apply that same delta to every future
    sibling (so a weekly 2pm series moved to 3pm shifts every future
    occurrence by the same hour). All siblings are validated before any of
    them (or the target) are mutated, so the whole move is atomic.
  `src/mcp/speech.ts` — `speakSeriesSummary(freq, remainingCount)` renders
  "...and 3 more every week after that." `src/mcp/tools.ts`:
  `hold_appointment` takes `recurrence`; `confirm_appointment` appends the
  series summary to speech and returns `series_codes`; `cancel_appointment`
  / `reschedule_appointment` take `scope` and mention the series count in
  speech; `list_my_appointments` groups series members — only the earliest
  occurrence of a series gets a spoken line (with "(plus N more in this
  series)"), but every occurrence is still in the structured `appointments`
  array with `series_id`/`series_count` so a client can enumerate them.
  `src/dashboard.ts` — `POST /api/appointments` (Phase 11) now accepts the
  same `recurrence` shape and returns `seriesAppointments` when present.
  `public/dashboard.html` — added a repeat-frequency select + occurrence-
  count input to the add-appointment form (hidden unless a frequency is
  chosen).
  New `test/recurrence.test.ts` (6 unit tests against a minimal in-memory
  fixture business): a 4-occurrence weekly series books atomically; a
  conflicting occurrence rejects the *whole* series (hold stays `"held"`,
  no partial series created); `cancel scope:"series"` leaves past
  occurrences alone but cancels the target and future ones;
  `reschedule scope:"series"` shifts future siblings by the same delta;
  `reschedule scope:"this"` (default) leaves siblings untouched; manual
  booking with recurrence creates every occurrence confirmed directly.
  New e2e test in `test/e2e.test.ts` (none-mode): a weekly series booked via
  `hold_appointment`/`confirm_appointment` over MCP produces the
  "...2 more every week after that" speech and `list_my_appointments`
  groups the 3 occurrences under one `series_id` with the "(plus 2 more in
  this series)" speech line.
  `npm run build` clean; `npm test` 64/64 (57 prior + 1 unit-test-file worth
  of 6 + 1 e2e).

- Phase 14: dashboard analytics. Loaded the `dataviz` skill first per
  SPEC_DEV.md. New `src/analytics.ts` — pure `computeAnalytics(store,
  businessId, nowMs, days)`, no new infrastructure, just aggregation over
  `store.data.appointments`: `bookingsByHour` (24 buckets, excludes
  cancelled/expired), `revenueByDay` (confirmed-only, zero-filled for every
  day in the window so the chart never has gaps), `sourceSplit` (counts by
  `alexa`/`phone`/`walk-in`, excludes cancelled/expired), and a no-show-rate
  proxy (see ambiguity below). The window looks *backward* from `nowMs`
  (`nowBiz.minus({days}).startOf("day")` through `nowBiz`) since revenue and
  no-show rate are inherently historical, unlike `/api/state`'s
  forward-looking window. `src/dashboard.ts` — new `GET /api/analytics?
  business=&days=` (default 30, capped at 90), 404 on an unknown business.
  `public/dashboard.html` — new "Analytics" card directly below the
  briefing panel: a no-show-rate stat tile, a bookings-by-hour bar chart, a
  revenue-by-day bar chart, and a bookings-by-channel breakdown (3
  horizontal bars, each directly labeled with its channel name and count,
  not just color — see palette note below). All three charts are plain
  inline SVG/HTML built the same way the existing timeline renders
  (template-string functions, no chart library), reusing the dashboard's
  existing `--voice`/`--hold`/`--offer` CSS variables so light/dark mode
  keep working for free. Ran `scripts/validate_palette.js` from the dataviz
  skill against this trio: CVD separation and contrast both pass in light
  and dark, but `--voice` fails the chroma floor (reads a little
  desaturated) and both modes have at least one color outside the ideal
  lightness band. SPEC_DEV.md explicitly mandates reusing this exact
  established palette rather than swapping it for a fresh one, so I kept it
  and relied on the validator's own allowance: "CVD in the 6-8 floor band
  is legal ONLY with secondary encoding" — every chart segment here is
  directly labeled with text (hour/day labels, channel name + count), never
  color-alone. New `test/analytics.test.ts` (2 tests) hand-computes the
  exact expected numbers on a 7-appointment fixture (confirmed, cancelled
  late, cancelled with full notice, held, expired, and one appointment
  outside the window) and asserts every bucket and the no-show
  rate/sample-size exactly; a second test covers the zero-sample case.
  New e2e test in `test/e2e.test.ts` (none-mode) hits the live
  `GET /api/analytics` endpoint and checks the response shape. Manually
  smoke-tested against a live server: POSTed a manual walk-in appointment
  dated slightly in the past (relative to a later `FRONTDESK_NOW`) and
  confirmed `/api/analytics` picked it up correctly in `bookingsByHour`,
  `sourceSplit`, and `revenueByDay`. Also checked the dashboard script's
  syntax is valid (`node --check`) but could not visually render the chart
  in an actual browser — no headless browser (Chromium/Puppeteer/Playwright)
  is available in this sandbox; this is a sandbox limitation, not a design
  choice, same category as the no-Docker/no-AWS gaps noted in the original
  FINAL_REPORT.md.
  `npm run build` clean; `npm test` 67/67 (64 prior + 2 unit + 1 e2e).

## Known issues / ambiguities

- Manual bookings skip the `leadTimeMin` check that voice bookings enforce
  (`meetsLeadTime`), since a staff member taking a phone call or walk-in can
  reasonably book "right now" even if the automated lead-time policy exists
  to stop a voice agent from booking something the business can't prep for
  in time. `fitsBusinessHours` and the double-booking check are still
  enforced (SPEC_DEV.md only explicitly requires reusing the double-booking
  check, but skipping the hours check too seemed likely to produce nonsense
  bookings outside shifts).
- A manual booking without a `customerPhone` creates a fresh phone-less
  `Customer` row each time (never dedups), since there's no reliable key to
  match on. This mirrors how the "Guest" customer is handled elsewhere in
  the codebase.
- Monthly recurrence (`freq: "monthly"`) keeps the same day-of-month via
  Luxon's `.plus({ months: 1 })`, which can land on a different weekday
  than the first occurrence (e.g. the 15th rolls from a Thursday to a
  Saturday to a Sunday...). SPEC_DEV.md says occurrences repeat on "the
  same weekday/time", which is only naturally true for weekly/biweekly;
  for monthly I chose same-day-of-month over same-weekday since "monthly
  on the 3rd Tuesday" is a much more elaborate rule than this spec asked
  for, and most real recurring-monthly bookings (e.g. a monthly massage)
  are described by the customer as "the 15th of every month," not "the
  3rd Tuesday."
- Reschedule with `scope: "series"` shifts every future sibling by the same
  time delta as the target occurrence's move (see Phase 13 log entry above
  for the reasoning); SPEC_DEV.md doesn't spell out the intended semantics
  for "reschedule the whole series" given only one new `new_start`.
- No-show rate proxy (Phase 14): SPEC_DEV.md's sentence describing this
  metric is truncated mid-thought ("confirmed appointments whose `end` has
  passed with no corresponding... treat 'cancelled after notice window' as
  proxy"). I implemented it as: of every past appointment that was ever
  confirmed or cancelled, what fraction were cancelled *inside* the
  business's `cancelNoticeHours` window (a late cancellation, using
  `updatedAt` as the cancellation timestamp since a cancelled appointment
  is never mutated again) — on the theory that a last-minute cancellation
  is operationally the closest thing this system has to a no-show, since
  the business had no time to refill the slot either way.
- The randomized demo seed (`seed.ts`) only ever creates *future* bookings
  (the next 14 days from boot), so a freshly-booted demo server's analytics
  panel will show all zeros until either real time passes past some of
  those bookings or new bookings are made for a time at/before "now" (as
  the manual smoke test above did). This is expected, not a bug — there's
  no history to report yet.

## Next step

Phase 15 (lower priority, last): Spanish voice support (`locale` field on
Business, Spanish spokenTime/speech, chrono.es).
