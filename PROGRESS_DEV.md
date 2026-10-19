# Progress (dev branch stretch features)

Continuing "Front Desk" from the frozen main-branch submission (Phases 0-10 in
PROGRESS.md). This file tracks the dev-branch stretch work from SPEC_DEV.md.
Never edits SPEC.md/PROGRESS.md/FINAL_REPORT.md/DONE — those stay frozen.

## Phase plan

- [x] Phase 11: Manual / walk-in booking from the dashboard
- [x] Phase 12: Reminder notifications
- [x] Phase 13: Recurring appointments
- [x] Phase 14: Dashboard analytics
- [x] Phase 15: Spanish voice support (lower priority, last)
- [x] Phase 16: French voice support (user-requested addition, after SPEC_DEV.md)
- [x] Phase 17: closed-day alternatives fix + stock-tracked item catalog/orders (user-requested addition, after SPEC_DEV.md)
- [x] Phase 18: group bookings (user-requested addition, after SPEC_DEV.md)
- [x] Phase 19: staff time off (user-requested addition, after SPEC_DEV.md)
- [x] Phase 20: order-ready notifications + real pluggable SMS delivery (user-requested addition, after SPEC_DEV.md)

## Explicitly out of scope (per SPEC_DEV.md — not attempted)

- Real payment/deposit collection.
- Multi-location businesses.
- A standalone customer-facing portal with its own auth.

None of the original five phases above touch any of these. Deposits for
no-show-prone bookings came up again when prioritizing further additions
after Phase 17 (the analytics no-show-rate proxy makes it a natural next
step), and was deferred again for the same reason: collecting real payment
info needs a live PCI/compliance conversation with the project owner, not
something to default into autonomously.

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

- Phase 15: Spanish voice support. `src/types.ts` — new `Locale = "en" | "es"`
  and `Business.locale?: Locale` (defaults to `"en"` everywhere via `??`,
  so every existing business/test/seed keeps working untouched).
  `src/spokenTime.ts` — rewrote `parseSpokenWindow`/`relativeDayLabel`/
  `formatClock`/`speakDateTime` to take a `locale` parameter and dispatch
  through a `RULES: Record<Locale, LocaleRules>` table: Spanish daypart
  phrases ("por la mañana", "a la hora de comer", "después del trabajo",
  ...), Spanish between/after/before regexes ("entre las 2 y las 4",
  "después de las 3", "antes del mediodía"), Spanish weekend/week keywords
  ("este fin de semana", "la próxima semana", ...), Spanish noon/midnight
  normalization ("mediodía"/"medianoche"), and `chrono.es.parse` instead of
  the English `chrono.parse`, exactly as SPEC_DEV.md suggested instead of
  hand-rolling translation. Weekday/month names come from Luxon's built-in
  `es` locale (`dt.setLocale("es").toFormat("cccc")`); "hoy"/"mañana" are
  hand-written since Luxon has no relative-day helper. Spoken time renders
  as "a las 5:30 de la tarde" (not a literal "AM"/"PM" translation, which
  isn't how Spanish speakers say times).
  `src/mcp/speech.ts` — `speakAvailability`/`speakHold`/`speakConfirmation`/
  `speakSeriesSummary` all take a `locale` parameter with full Spanish
  templates (e.g. "Estoy reservando..." / "¿Confirmo la reserva?" for a
  hold, "Listo, tienes..." for a confirmation).
  New `src/i18n.ts` — Spanish/English templates for every other tool's
  success-path speech string: business-details summary, closed/fully-booked
  messages, the list_my_appointments lines (including the series-grouping
  suffix) and overall summary, reschedule/cancel confirmations (including
  series notes), waitlist-joined message.
  `src/mcp/tools.ts` — every tool now resolves `business.locale ?? "en"`
  and threads it through `parseSpokenWindow`/`speech.ts`/`i18n.ts` calls.
  New tests: 15 Spanish cases added to `test/spokenTime.test.ts` (12
  `parseSpokenWindow` phrases, each a literal Spanish translation of an
  existing English `spokenTime.test.ts` case, asserted to resolve to the
  *exact same* `fromDay`/`toDay`/`band`/`exact` window as its English
  counterpart; 3 `speakDateTime` cases for "mañana a las 9:00 de la
  mañana" / "jueves a las 5:30 de la tarde" / "lunes, 2 de noviembre a las
  10:00 de la mañana"). New e2e fixture `buildSpanishLocaleFixture()`
  (`shop-es`, `locale: "es"`) plus a new none-mode e2e suite in
  `test/e2e.test.ts`: a full find→hold→confirm→list→cancel flow driven
  entirely by Spanish phrases over the real MCP protocol, asserting the
  speech text at each step, plus a closed-day-in-Spanish case.
  `npm run build` clean; `npm test` 84/84 (67 prior + 15 spokenTime + 2 e2e).

- Phase 16 (user-requested addition, after SPEC_DEV.md): French voice
  support, on the same foundation Phase 15 built. `src/types.ts` — widened
  `Locale` to `"en" | "es" | "fr"`. `src/spokenTime.ts` — added a French
  entry to the `RULES` table: French daypart phrases ("le matin",
  "après-midi", "après le travail"/"le soir", "tôt le matin", "en fin
  d'après-midi", "à l'heure du déjeuner"), French between/after/before
  regexes ("entre 2 et 4", "après 3", "avant midi"), French weekend/week
  keywords ("ce week-end", "le week-end prochain", "la semaine prochaine"),
  French noon/midnight normalization ("midi"/"minuit"), and
  `chrono.fr.parse`. Found and fixed a real bug while writing this: JS
  regex `\b` can't anchor immediately before an accented letter (`à` isn't
  a `\w` character), so a daypart pattern written with a leading "à " (as a
  natural French phrase would have it) silently never matches — worked
  around by dropping the leading "à " from the pattern itself while keeping
  it in the daypart's displayed name. Added `nextWeekendLabel`/
  `thisWeekendLabel`/`nextWeekLabel`/`thisWeekLabel` fields to the
  `LocaleRules` table (previously inline `locale === "es" ? ... : ...`
  ternaries) since a third locale made the inline form unwieldy; same
  reasoning for switching `relativeDayLabel`'s today/tomorrow words to a
  `Record<Locale, string>` lookup instead of another ternary branch.
  Weekday/month names come from Luxon's built-in `fr` locale. Spoken time
  renders as "à 5:30 de l'après-midi" (not a literal AM/PM translation),
  matching the Spanish precedent.
  `src/mcp/speech.ts` — `speakHold`/`speakConfirmation`/
  `speakSeriesSummary`/`stripPeriod`/`joinWithOr`/`speakSlotsForDay` all
  gained a French branch alongside the existing Spanish one.
  `src/i18n.ts` — every function gained a French template (business
  summary, closed/fully-booked, appointment lines and summary,
  reschedule/cancel confirmations including series notes, waitlist-joined).
  `src/mcp/tools.ts` needed no changes — it was already generic over
  `Locale`, not hardcoded to `"es"`.
  Same two scope cuts as Phase 15, now extended to French for the same
  reasons: `BookingError` failure-path text and `find_businesses` stay
  English-only.
  New tests, mirroring the Phase 15 Spanish suite exactly: 12 French
  `parseSpokenWindow` cases in `test/spokenTime.test.ts` (literal French
  translations of the English cases, asserted to resolve to the same
  window) plus 3 `speakDateTime` cases; new e2e fixture
  `buildFrenchLocaleFixture()` (`shop-fr`, `locale: "fr"`) plus a full
  find→hold→confirm→list→cancel e2e flow in French over the real MCP
  protocol in `test/e2e.test.ts`, plus a closed-day-in-French case.
  `npm run build` clean; `npm test` 101/101 (84 prior + 12 `parseSpokenWindow`
  French cases + 3 `speakDateTime` French cases + 2 e2e).

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
- Phase 15 scope cuts, both chosen because SPEC_DEV.md explicitly flagged
  this phase as lowest priority / best-effort:
  - `BookingError` messages (every tool's *failure*-path text — "I couldn't
    find that business," "that slot just got taken," etc.) stay English
    only. Localizing them would mean threading `locale` through every
    booking.ts function and every error site, several of which fire before
    a business is even resolved (so there's no locale to pick yet). The
    success-path speech — the primary "spoken" experience SPEC_DEV.md is
    actually about — is fully bilingual; only the error/edge-case text
    isn't.
  - `find_businesses` always speaks English: it searches across every
    business in the directory before any single one is chosen, so there's
    no one business's `locale` to key off of yet.
  - `list_my_appointments`' overall framing sentence ("Tienes N citas: ...")
    picks the locale of the customer's *first* upcoming appointment's
    business; a customer with bookings at both an English and a Spanish
    business would get one locale for the summary sentence even though
    each individual appointment line is correctly localized to its own
    business. No single correct answer exists here since the customer
    has no locale of their own in this data model.
  - `Business.locale` has no dashboard UI control (no onboarding-form
    toggle); it's set programmatically (seed data, Bedrock onboarding
    output, or a direct business edit) since SPEC_DEV.md didn't ask for a
    UI, only for the field and the rendering behavior once set.

- Phase 17 (user-requested addition, after SPEC_DEV.md), part A — closed-day
  alternatives fix: `find_availability` previously returned a dead end when
  the business was closed for the *entire* requested window (just "X is
  closed then," no next step), even though the *fully-booked* case right
  below it already searched the next 7 days and offered alternatives. The
  two cases now share that alternative search — computed once, before the
  open/closed branch — so a closed-day response also says "the next time
  they're open is ...". Deliberately still not offering the waitlist for
  the closed case, since the waitlist only makes sense when a slot could
  free up from a cancellation, which can't happen in a window the business
  was never open during. `src/i18n.ts` — `sayBusinessClosed` gained an
  `alternativesSpeech` parameter (English/Spanish/French). Test:
  `test/e2e.test.ts`'s existing closed-day case now asserts the alternative
  is present and mentioned in speech.

  Part B — stock-tracked item catalog and orders, prompted by: "if the user
  asks for business hours [handled above], and if they want to order
  things... check if they have an object in stock, a dish they have... it
  doesn't have to be a restaurant or hotel." The existing data model
  (Business -> Service/Staff -> time-slot Appointment) is for booking a
  *person's time*; this adds a parallel, independent concept for goods: a
  stock-tracked `Product` (name, price, stockQty) that any business can
  optionally carry alongside its services — a barbershop selling pomade, a
  groomer selling shampoo, not just restaurants. `src/types.ts` — new
  `Product`/`Order`/`OrderStatus`, `Business.products?: Product[]` (defaults
  to none via `?? []`), `StoreData.orders`, and two new `ActivityEventType`s
  (`order_placed`/`order_cancelled`). New `src/catalog.ts`, structured like
  `booking.ts`: `requireProduct` (id/exact-name/substring-name lookup, same
  leniency as staff-name lookups), `checkItemAvailability`, `placeOrder`,
  `cancelOrder` (restocks on cancel, idempotent), `listMyOrders`. Deliberate
  design choice: orders have **no hold/confirm step** the way appointments
  do — a hold exists to protect a 5-minute window against a second customer
  racing for the exact same minute, but two customers ordering the last item
  in stock aren't racing for a *time*, they're racing for a *count*, which a
  single synchronous stock-decrement in `placeOrder` already resolves
  correctly (Node's single-threaded request handling means there's no
  interleaving between one order's check-then-decrement and another's).
  `pickup_when` (e.g. "tomorrow morning") is parsed with the existing
  `parseSpokenWindow`/locale machinery for a spoken label, but — unlike an
  appointment's `start` — is **not validated against business hours**: an
  in-stock item has no human-availability constraint the way a service
  appointment does, so pickup time is informational only. New MCP tools:
  `check_item_availability`, `order_item`, `list_my_orders`, `cancel_order`,
  added to `SERVER_INSTRUCTIONS`. `src/mcp/speech.ts` — new
  `speakOrderConfirmation` (spells the code aloud, same pattern as
  `speakConfirmation`). `src/i18n.ts` — seven new catalog speech functions,
  all three locales. Dashboard: `GET /api/state` now also returns the
  business's `products` (already present on the business object, so no
  extra plumbing) and its active `orders`; new `PATCH /api/products/:id`
  lets an owner set a product's stock count directly (an absolute set, not
  a delta — the simplest restock control, since a full create/delete
  product UI wasn't asked for and isn't needed to demo the voice flow).
  New "Products" and "Orders" cards in the dashboard sidebar. Seed data:
  added products to two existing seed businesses (Maple Street Barbers:
  pomade, beard oil; Paws and Suds Grooming: shampoo, and dental chews
  seeded at **zero** stock specifically to demo the out-of-stock path) —
  deliberately not inventing a new restaurant/retail seed business, since
  the point being made ("it doesn't have to be a restaurant") is better
  demonstrated by giving *existing* service businesses a retail add-on than
  by adding a dedicated goods-only business, which would also have hit an
  edge case this data model doesn't support: every Business still requires
  at least one Service/Staff member for the existing booking tools, so a
  goods-only business with empty `services`/`staff` arrays was avoided
  rather than explored, as out of scope for this pass.
  New tests: `test/catalog.test.ts` (9 unit tests covering lookup,
  availability, ordering, stock rejection, cancellation/restocking,
  idempotency, and listing) plus a new "Phase 17: item catalog / orders"
  e2e suite in `test/e2e.test.ts` (2 tests) driving `check_item_availability`
  -> `order_item` -> `list_my_orders` -> `cancel_order` over the real MCP
  protocol, plus the out-of-stock and over-order-rejection cases.
  Manually smoke-tested against a running server (no headless browser in
  this sandbox, same limitation noted for Phase 14): `GET /api/state`
  correctly returns `products`/`orders`, `PATCH /api/products/:id` restocks,
  and a live MCP call through `check_item_availability` -> `order_item` ->
  `list_my_orders` produced the expected speech and stock decrement end to
  end.
  `npm run build` clean; `npm test` 114/114 (101 prior + 1 closed-day
  alternatives assertion folded into an existing test + 9 catalog unit
  tests + 2 catalog e2e tests, net +13).

- Phase 18 (user-requested addition, after SPEC_DEV.md): group bookings.
  User's framing: "a family booking three kids' haircuts, or a group
  massage slot." Two different models were possible — (a) one booking
  action creates N separate linked appointments, usually with different
  staff, at the same time, or (b) a single appointment gets a capacity > 1
  and multiple customers book into it independently. Asked the user; (a)
  was chosen as the better fit, and it also reuses the exact "validate
  every member before mutating anything, so the whole thing books
  atomically or not at all" shape Phase 13's recurrence already
  established — just across *staff* instead of across *dates*. (b) would
  have meant redesigning the whole availability/double-booking engine
  around per-slot capacity instead of 1-per-slot, a much bigger change, so
  it was correctly ruled out rather than attempted.
  `src/types.ts` — new `PartySpec` (`{ count, names? }`, `count` between 2
  and 8) and `Appointment.groupId`/`pendingParty`, mirroring
  `seriesId`/`pendingRecurrence` exactly. `src/booking.ts` —
  `holdAppointment` rejects combining `recurrence` and `party` in the same
  request (the two axes — same staff across different *dates* vs.
  different staff at the same *date* — don't compose meaningfully in one
  booking); validates the party size against *every* eligible staff member
  businesswide, not the `staffHint`-narrowed candidate list (a real bug
  caught while writing `test/group.test.ts`: passing `staff: "Sam"` for the
  primary attendee was incorrectly shrinking the whole group's eligibility
  check to "how many staff named Sam are there," i.e. 1, rejecting valid
  group sizes outright). New `findStaffForParty()` finds N distinct free
  staff excluding the primary's, validating all before mutating — same
  atomic shape as `validateOccurrences`. `confirmAppointment` materializes
  the other attendees' appointments only once the whole group is
  confirmed free; an idempotent re-confirm returns the same group via a new
  `groupSiblings()` helper (mirrors `seriesSiblings()`).
  `createManualAppointment` got the same `party` support for phone/walk-in
  group bookings, materializing immediately (no hold step, consistent with
  every other manual-booking behavior). `src/mcp/speech.ts` — new
  `speakGroupSummary` (English/Spanish/French), read back at confirm time
  only, same precedent as `speakSeriesSummary`. `src/i18n.ts` —
  `sayAppointmentLine` gained an `extraKind: "series" | "group"` parameter
  so `list_my_appointments` can say "(plus N more in this group)" instead
  of "...in this series)" for group siblings, since an appointment is
  never in both at once (mutually exclusive by construction). New MCP tool
  input: `party` on `hold_appointment`; new output: `group_codes` on
  `confirm_appointment`; `list_my_appointments` output gained
  `group_id`/`group_count` alongside the existing `series_id`/`series_count`.
  Dashboard's `POST /api/appointments` accepts `party` too, for parity with
  recurrence. New tests: `test/group.test.ts` (6 unit tests against a
  dedicated 3-staff fixture — recurrence's single-staff fixture can't
  exercise a multi-staff group) plus a new "Phase 18: group bookings" e2e
  suite (2 tests). Manually verified against the real randomized demo
  seed: a contended slot correctly rejected the whole group atomically
  (hold left intact) while a different open slot booked cleanly for both
  attendees with two different barbers — confirms the atomic-or-nothing
  behavior holds under realistic, non-deterministic availability, not just
  the controlled unit-test fixture.

- Phase 19 (user-requested addition, after SPEC_DEV.md): staff time off,
  separate from business hours ("Sam is out sick Thursday" without editing
  hours for everyone). `src/types.ts` — new `StaffTimeOff` (businessId,
  staffId, fromIso, toIso, reason) and `StoreData.staffTimeOff`. The key
  design choice: fold time-off blocks directly into
  `availability.ts`'s `buildBusyIndex()` as plain busy intervals (no
  buffer, unlike appointments) rather than adding a separate "is this
  staff member off" check layered on top. This means every existing
  caller of `findAvailability`/`isSlotFree` — the voice booking flow, the
  manual-booking endpoint, recurrence/group validation, reschedule — picks
  up the new constraint automatically, with the actual code change being
  "thread one more array through five call sites," not "add a parallel
  check everywhere this matters." New `src/staffTimeOff.ts` (owner-side,
  not an MCP voice tool): `addStaffTimeOff`, `removeStaffTimeOff`,
  `listStaffTimeOff` (future/ongoing only). New dashboard endpoints:
  `POST /api/staff-time-off`, `DELETE /api/staff-time-off/:id`; `GET
  /api/state` now also returns the business's upcoming time-off blocks.
  New "Staff time off" dashboard card (add form + list with a remove
  button per block). New tests: `test/staffTimeOff.test.ts` (6 tests: CRUD
  plus two tests asserting the availability-engine integration directly —
  a blocked staff member disappears from `findAvailability` and
  `isSlotFree` returns false during their block, while an unblocked staff
  member and the day after the block are both unaffected). Manually
  verified against a live server: adding a time-off block for Sam made
  `find_availability` (filtered to Sam) return zero slots for that day
  while Priya's slots were untouched.

- Phase 20 (user-requested addition, after SPEC_DEV.md): order-ready
  notifications plus real, pluggable SMS delivery — two closely-linked
  items from the same prioritization request. User's framing for the
  first: "`Order` already has a `'ready'` status in the type, but nothing
  in the code seems to actually drive placed -> ready, and there's no
  customer notification when it happens" — correct; this was a real gap,
  not a design choice. `src/reminders.ts` — generalized
  `NotificationSink`'s context from `{ kind, appointmentId }` to a shared
  `NotificationContext` carrying `customerPhone`/`customerName` too (needed
  so a real SMS sink has a destination without re-querying the Store), and
  widened `ReminderKind` to `NotificationKind = ReminderKind |
  "order_ready"`; exported a `notify()` helper so `catalog.ts` can fire
  through the same installed sink without reaching into the module's
  private `sink` variable. New `src/catalog.ts` functions:
  `markOrderReady` (placed -> ready, fires the notification, logs a new
  `order_ready` activity event) and `markOrderPickedUp` (ready/placed ->
  picked_up, no notification — nobody needs telling they just picked up
  their own order). Both are owner-side actions (new
  `PATCH /api/orders/:id`), not MCP voice tools, since the business decides
  when an item is ready, not the customer.
  For real SMS delivery: new `src/sms.ts` with a minimal Twilio REST API
  client over the built-in `fetch` (no SDK dependency added for one
  endpoint) — `setSmsClient()` for test injection, same pattern as
  `setBedrockClient`; `sendSms()` throws a clear, documented error when
  `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER` aren't all
  set, matching SPEC_DEV.md's original hard requirement for third-party
  credentials ("implement it for real, inject a stub client for tests, and
  let the real call fail with a clean, documented error when no
  credentials are present"). `SmsNotificationSink` wraps this as a
  `NotificationSink`: sends via `sendSms` when the customer has a phone on
  file, otherwise logs instead of throwing — a notification is a side
  effect of a flow that already succeeded (a booking, a reminder, an order
  going ready), so a notification failure (missing phone, Twilio down,
  bad credentials) must never take that flow down with it, hence
  catch-and-log rather than propagate. `src/config.ts`/`.env.example` —
  new `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`, all
  optional. `src/server.ts` — installs `SmsNotificationSink` at boot only
  when all three are configured; otherwise the existing
  `ConsoleNotificationSink` default stays in place, so Phase 12's
  reminders and Phase 20's order-ready notifications share one
  configuration switch. Dashboard: new "Mark ready"/"Mark picked up"
  buttons on the Orders card. New tests: `test/sms.test.ts` (7 tests:
  `smsConfigured`, `sendSms`'s configured/unconfigured/failure paths
  against an injected stub — never a real network call — and
  `SmsNotificationSink`'s has-phone/no-phone/send-fails branches, asserting
  it logs rather than throwing on failure); `test/catalog.test.ts` gained a
  `markOrderReady / markOrderPickedUp` suite (3 tests: notifies on ready,
  rejects marking ready an order that isn't placed, picked-up sends no
  further notification). Manually verified against a live server with no
  Twilio credentials configured (the sandbox has none): marking an order
  ready produced `[notify] Your order for 1 Matte Pomade at Maple Street
  Barbers is ready for pickup.` on stdout, confirming the fallback path
  works end-to-end even though the live-Twilio path itself couldn't be
  exercised here (see FINAL_REPORT_DEV.md's known-limitations section).

  `npm run build` clean; `npm test` 139/139 (114 prior + 6 group unit + 2
  group e2e + 6 staff-time-off + 7 sms + 3 markOrderReady/markOrderPickedUp,
  net +25).

## Next step

None — every phase in SPEC_DEV.md (11-15) is complete, plus the
user-requested Phases 16-20 (French voice support; closed-day alternatives
fix + item catalog/orders; group bookings; staff time off; order-ready
notifications + real pluggable SMS delivery). Deposits/prepayment for
no-show-prone bookings was proposed and deferred again (needs a real
PCI/compliance conversation, not an autonomous decision). `npm test`
passes in full (139/139). See FINAL_REPORT_DEV.md for the full test output
and manual how-to-exercise notes for each feature, and DONE_DEV.
