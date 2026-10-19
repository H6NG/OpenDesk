# Final Report — dev branch stretch features (Phases 11-15)

This is the dev-branch continuation of "Front Desk," building on top of the
frozen main-branch submission (Phases 0-10, documented in PROGRESS.md and
FINAL_REPORT.md). All work described here lives on the `dev` branch; `main`,
SPEC.md, PROGRESS.md, FINAL_REPORT.md, and DONE were never touched.

Every phase in SPEC_DEV.md (11 through 15) is complete. See PROGRESS_DEV.md
for the full phase-by-phase log, including every design decision and scope
cut, with reasoning. Nothing was left "explicitly out of scope" from
SPEC_DEV.md's own out-of-scope list (real payments, multi-location
businesses, a standalone customer portal) — none of the five phases touched
any of those.

## Full `npm test` output (84/84 passing)

```
> front-desk@0.1.0 test
> tsx --test test/*.test.ts

TAP version 13
# Subtest: computeAnalytics
    # Subtest: aggregates bookings-by-hour, revenue-by-day, source split, and the no-show proxy on a known fixture
    ok 1 - aggregates bookings-by-hour, revenue-by-day, source split, and the no-show proxy on a known fixture
    # Subtest: returns a zero no-show rate when there's no past confirmed/cancelled sample
    ok 2 - returns a zero no-show rate when there's no past confirmed/cancelled sample
    1..2
ok 1 - computeAnalytics
# Subtest: findAvailability
    # Subtest: respects lead time and business hours
    ok 1 - respects lead time and business hours
    # Subtest: excludes busy intervals with buffer applied
    ok 2 - excludes busy intervals with buffer applied
    # Subtest: ignores expired holds
    ok 3 - ignores expired holds
    # Subtest: sorts exact-time requests by distance
    ok 4 - sorts exact-time requests by distance
    # Subtest: does not cap a single-day search at 2 slots
    ok 5 - does not cap a single-day search at 2 slots
    # Subtest: caps multi-day searches at 2 per day with 30-minute spacing
    ok 6 - caps multi-day searches at 2 per day with 30-minute spacing
    # Subtest: isOpenDuringWindow is false for a fully closed day
    ok 7 - isOpenDuringWindow is false for a fully closed day
    1..7
ok 2 - findAvailability
# Subtest: onboardBusiness
    # Subtest: forces save_business, strips $schema, and sets temperature 0
    ok 1 - forces save_business, strips $schema, and sets temperature 0
    # Subtest: converts output correctly: an acrylic set only bookable with Tran
    ok 2 - converts output correctly: an acrylic set only bookable with Tran
    # Subtest: the new business is immediately bookable
    ok 3 - the new business is immediately bookable
    # Subtest: rejects invalid output with a clear error
    ok 4 - rejects invalid output with a clear error
    # Subtest: rejects output where a service has no staff who can perform it
    ok 5 - rejects output where a service has no staff who can perform it
    1..5
ok 3 - onboardBusiness
# Subtest: dailyBriefing
    # Subtest: stays within 90 words and mentions the business
    ok 1 - stays within 90 words and mentions the business
    1..1
ok 4 - dailyBriefing
# Subtest: e2e: none mode
    # Subtest: full flow: find -> details -> availability -> hold -> confirm
    ok 1 - full flow: find -> details -> availability -> hold -> confirm
    # Subtest: prevents double-booking the same slot and staff
    ok 2 - prevents double-booking the same slot and staff
    # Subtest: confirm_appointment is idempotent
    ok 3 - confirm_appointment is idempotent
    # Subtest: reschedules an appointment by its 4-character code
    ok 4 - reschedules an appointment by its 4-character code
    # Subtest: says the business is closed on a fully-closed day
    ok 5 - says the business is closed on a fully-closed day
    # Subtest: offers alternatives and the waitlist when fully booked, then auto-offers the freed slot on cancel
    ok 6 - offers alternatives and the waitlist when fully booked, then auto-offers the freed slot on cancel
    # Subtest: returns a recoverable error for an unknown business
    ok 7 - returns a recoverable error for an unknown business
    # Subtest: GET /health reports protocol 2025-11-25
    ok 8 - GET /health reports protocol 2025-11-25
    # Subtest: GET /api/state returns dashboard state for the business
    ok 9 - GET /api/state returns dashboard state for the business
    # Subtest: GET /api/analytics returns aggregated metrics for the business
    ok 10 - GET /api/analytics returns aggregated metrics for the business
    # Subtest: GET /mcp returns 405 with Allow: POST
    ok 11 - GET /mcp returns 405 with Allow: POST
    # Subtest: Phase 11: manual booking
        # Subtest: POST /api/appointments creates a confirmed walk-in appointment and logs an activity event
        ok 1 - POST /api/appointments creates a confirmed walk-in appointment and logs an activity event
        # Subtest: rejects a double-booked slot for the same staff member
        ok 2 - rejects a double-booked slot for the same staff member
        1..2
    ok 12 - Phase 11: manual booking
    # Subtest: Phase 13: recurring appointments
        # Subtest: books a weekly series via hold+confirm, speech mentions it, and list_my_appointments groups the series
        ok 1 - books a weekly series via hold+confirm, speech mentions it, and list_my_appointments groups the series
        1..1
    ok 13 - Phase 13: recurring appointments
    1..13
ok 5 - e2e: none mode
# Subtest: e2e: oauth mode
    # Subtest: part 1b: two linked customers
        # Subtest: A books the only slot, B waitlists, A cancels, B gets offered and confirms, A cannot cancel B's booking
        ok 1 - A books the only slot, B waitlists, A cancels, B gets offered and confirms, A cannot cancel B's booking
        1..1
    ok 1 - part 1b: two linked customers
    # Subtest: Phase 11: manual booking visible to linked customer
        # Subtest: a manual booking with a matching phone shows up in that customer's list_my_appointments
        ok 1 - a manual booking with a matching phone shows up in that customer's list_my_appointments
        1..1
    ok 2 - Phase 11: manual booking visible to linked customer
    # Subtest: part 2: oauth protocol
        # Subtest: 401 with no WWW-Authenticate header when unauthenticated
        ok 1 - 401 with no WWW-Authenticate header when unauthenticated
        # Subtest: protected resource metadata is correct
        ok 2 - protected resource metadata is correct
        # Subtest: authorization server metadata includes S256
        ok 3 - authorization server metadata includes S256
        # Subtest: rejects a wrong resource parameter at /oauth/authorize
        ok 4 - rejects a wrong resource parameter at /oauth/authorize
        # Subtest: rejects plain PKCE
        ok 5 - rejects plain PKCE
        # Subtest: rejects an unregistered redirect_uri without redirecting to it
        ok 6 - rejects an unregistered redirect_uri without redirecting to it
        # Subtest: a wrong code_verifier gives invalid_grant
        ok 7 - a wrong code_verifier gives invalid_grant
        # Subtest: happy path issues tokens and a query-string token gives 401
        ok 8 - happy path issues tokens and a query-string token gives 401
        # Subtest: an authenticated booking is attributed to the linked customer
        ok 9 - an authenticated booking is attributed to the linked customer
        # Subtest: refresh rotation rejects the old refresh token
        ok 10 - refresh rotation rejects the old refresh token
        1..10
    ok 3 - part 2: oauth protocol
    1..3
ok 6 - e2e: oauth mode
# Subtest: e2e: Spanish locale (Phase 15)
    # Subtest: finds, holds, confirms, lists, and cancels entirely in Spanish
    ok 1 - finds, holds, confirms, lists, and cancels entirely in Spanish
    # Subtest: reports a closed day in Spanish
    ok 2 - reports a closed day in Spanish
    1..2
ok 7 - e2e: Spanish locale (Phase 15)
# Subtest: recurring appointments: hold + confirm
    # Subtest: books a 4-occurrence weekly series atomically, every Monday
    ok 1 - books a 4-occurrence weekly series atomically, every Monday
    # Subtest: rejects the whole series if any occurrence conflicts, booking none of it
    ok 2 - rejects the whole series if any occurrence conflicts, booking none of it
    1..2
ok 8 - recurring appointments: hold + confirm
# Subtest: recurring appointments: cancel / reschedule scope
    # Subtest: cancel scope:'series' cancels the target and future occurrences but leaves past ones alone
    ok 1 - cancel scope:'series' cancels the target and future occurrences but leaves past ones alone
    # Subtest: reschedule scope:'series' shifts future occurrences by the same delta
    ok 2 - reschedule scope:'series' shifts future occurrences by the same delta
    # Subtest: reschedule scope:'this' (default) leaves siblings untouched
    ok 3 - reschedule scope:'this' (default) leaves siblings untouched
    1..3
ok 9 - recurring appointments: cancel / reschedule scope
# Subtest: recurring appointments: manual booking
    # Subtest: createManualAppointment with recurrence books every occurrence as confirmed directly
    ok 1 - createManualAppointment with recurrence books every occurrence as confirmed directly
    1..1
ok 10 - recurring appointments: manual booking
# Subtest: sweepReminders: hold expiry
    # Subtest: fires exactly one reminder once a hold has used 80% of its 5-minute TTL
    ok 1 - fires exactly one reminder once a hold has used 80% of its 5-minute TTL
    # Subtest: does not remind an already-expired hold
    ok 2 - does not remind an already-expired hold
    # Subtest: does not remind an already-confirmed hold
    ok 3 - does not remind an already-confirmed hold
    1..3
ok 11 - sweepReminders: hold expiry
# Subtest: sweepReminders: upcoming appointment
    # Subtest: fires once ~2 hours before start and not again on a second sweep
    ok 1 - fires once ~2 hours before start and not again on a second sweep
    # Subtest: logs a reminder_sent activity event
    ok 2 - logs a reminder_sent activity event
    1..2
ok 12 - sweepReminders: upcoming appointment
# Subtest: parseSpokenWindow
    # Subtest: "thursday after work" -> 10-22, band [1020,1260]
    ok 1 - "thursday after work" -> 10-22, band [1020,1260]
    # Subtest: "tomorrow morning" -> 10-19, [480,720]
    ok 2 - "tomorrow morning" -> 10-19, [480,720]
    # Subtest: "this weekend" -> 10-18 only
    ok 3 - "this weekend" -> 10-18 only
    # Subtest: "next weekend" -> 10-24..10-25
    ok 4 - "next weekend" -> 10-24..10-25
    # Subtest: "next week" -> 10-19..10-25
    ok 5 - "next week" -> 10-19..10-25
    # Subtest: "after 3 on friday" -> 10-23, [900,1440]
    ok 6 - "after 3 on friday" -> 10-23, [900,1440]
    # Subtest: "before noon tomorrow" -> [0,720]
    ok 7 - "before noon tomorrow" -> [0,720]
    # Subtest: "between 2 and 4 on wednesday" -> [840,960]
    ok 8 - "between 2 and 4 on wednesday" -> [840,960]
    # Subtest: "thursday at 5:30pm" -> exact Thu 17:30
    ok 9 - "thursday at 5:30pm" -> exact Thu 17:30
    # Subtest: "lunchtime on tuesday" -> [690,810]
    ok 10 - "lunchtime on tuesday" -> [690,810]
    # Subtest: "october 30"
    ok 11 - "october 30"
    # Subtest: "8am" -> rolls to 10-19
    ok 12 - "8am" -> rolls to 10-19
    1..12
ok 13 - parseSpokenWindow
# Subtest: parseSpokenWindow: Spanish equivalents resolve to the same windows
    # Subtest: "el jueves después del trabajo" -> 10-22, band [1020,1260]
    ok 1 - "el jueves después del trabajo" -> 10-22, band [1020,1260]
    # Subtest: "mañana por la mañana" -> 10-19, [480,720]
    ok 2 - "mañana por la mañana" -> 10-19, [480,720]
    # Subtest: "este fin de semana" -> 10-18 only
    ok 3 - "este fin de semana" -> 10-18 only
    # Subtest: "el próximo fin de semana" -> 10-24..10-25
    ok 4 - "el próximo fin de semana" -> 10-24..10-25
    # Subtest: "la próxima semana" -> 10-19..10-25
    ok 5 - "la próxima semana" -> 10-19..10-25
    # Subtest: "después de las 3 el viernes" -> 10-23, [900,1440]
    ok 6 - "después de las 3 el viernes" -> 10-23, [900,1440]
    # Subtest: "antes del mediodía mañana" -> [0,720]
    ok 7 - "antes del mediodía mañana" -> [0,720]
    # Subtest: "entre las 2 y las 4 el miércoles" -> [840,960]
    ok 8 - "entre las 2 y las 4 el miércoles" -> [840,960]
    # Subtest: "el jueves a las 5:30pm" -> exact Thu 17:30
    ok 9 - "el jueves a las 5:30pm" -> exact Thu 17:30
    # Subtest: "a la hora de comer el martes" -> [690,810]
    ok 10 - "a la hora de comer el martes" -> [690,810]
    # Subtest: "30 de octubre"
    ok 11 - "30 de octubre"
    # Subtest: "8am" -> rolls to 10-19 (digits parse the same in both locales)
    ok 12 - "8am" -> rolls to 10-19 (digits parse the same in both locales)
    1..12
ok 14 - parseSpokenWindow: Spanish equivalents resolve to the same windows
# Subtest: speakDateTime
    # Subtest: formats tomorrow
    ok 1 - formats tomorrow
    # Subtest: formats a weekday within the week
    ok 2 - formats a weekday within the week
    # Subtest: formats a date far enough out to need the full form
    ok 3 - formats a date far enough out to need the full form
    # Subtest: formats tomorrow in Spanish
    ok 4 - formats tomorrow in Spanish
    # Subtest: formats a weekday within the week in Spanish
    ok 5 - formats a weekday within the week in Spanish
    # Subtest: formats a date far enough out to need the full form in Spanish
    ok 6 - formats a date far enough out to need the full form in Spanish
    1..6
ok 15 - speakDateTime
1..15
# tests 84
# suites 20
# pass 84
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 6071.888167
```

`npm run build` (`tsc -p tsconfig.json`) also compiles clean with zero errors.

## What was added, phase by phase

- **Phase 11 — Manual/walk-in booking**: `POST /api/appointments` books a
  confirmed appointment directly (no hold step) for a staff member taking a
  phone call or walk-in, reusing the voice-booking double-booking and
  business-hours checks. A dashboard form lets an owner book one from the
  timeline.
- **Phase 12 — Reminder notifications**: a 30-second sweep reminds a
  customer once a hold is 80% through its 5-minute TTL, and once per
  confirmed appointment about 2 hours before it starts, logging a
  `reminder_sent` activity event and calling an injectable notification sink
  (console-only in this sandbox, same pattern as the Bedrock client stub).
- **Phase 13 — Recurring appointments**: `hold_appointment`/
  `confirm_appointment`/the manual-booking endpoint take an optional
  `recurrence: { freq, count }` and book the whole series atomically (all
  or nothing); `cancel_appointment`/`reschedule_appointment` take a
  `scope: "this" | "series"` to act on the whole series at once.
- **Phase 14 — Dashboard analytics**: `GET /api/analytics` aggregates
  bookings-by-hour, revenue-by-day, a voice/phone/walk-in split, and a
  late-cancellation no-show-rate proxy; a new dashboard panel renders all
  of it as three inline-SVG charts plus a stat tile, in the existing visual
  language.
- **Phase 15 — Spanish voice support**: setting `Business.locale = "es"`
  makes every tool's spoken-time parsing (via `chrono.es`) and
  success-path speech render entirely in Spanish.

See PROGRESS_DEV.md's Log section for the full design rationale, every
ambiguity encountered, and exactly how each was resolved.

## How to exercise each feature manually

Start the server first (demo mode, no real credentials needed):

```
npm run build && node dist/server.js
# or for a live-reloading dev run: npx tsx src/server.ts
```

Open `http://localhost:3000/` for the dashboard, or point an MCP client at
`http://localhost:3000/mcp` (AUTH_MODE defaults to `none`, so no OAuth step
is required for manual testing).

### Phase 11 — Manual/walk-in booking

- **Dashboard**: open `/`, pick a business, click **"+ Add"** under the
  timeline, fill in service/staff/start time/customer name, choose "Phone"
  or "Walk-in," and click **"Book it."** The appointment appears on the
  timeline immediately with the existing "other-source" (non-teal) styling,
  and an activity-feed entry fires.
- **API directly**:
  ```
  curl -X POST http://localhost:3000/api/appointments \
    -H 'content-type: application/json' \
    -d '{"businessId":"maple-street-barbers","serviceId":"mens-cut","staffId":"sam","customerName":"Jane Doe","start":"2026-10-20T14:00:00-07:00","source":"phone"}'
  ```
  Booking the same staff/slot twice returns `400` with "That slot is already
  booked for that staff member."

### Phase 12 — Reminder notifications

Hard to see live without waiting out a real 5-minute hold or 2-hour
appointment window, so the fastest way to see it fire is `FRONTDESK_NOW`:
start the server with a frozen clock a few minutes before a hold's TTL (or
~2 hours before a confirmed appointment's start), wait just over 30 seconds
for the sweep interval, and watch the dashboard's Activity feed for a
`reminder_sent` entry (and the server's stdout for `[notify] ...` from the
console sink). `test/reminders.test.ts` exercises the exact same logic
deterministically without needing to wait.

### Phase 13 — Recurring appointments

Via an MCP client (or the dashboard's "Add appointment" form, which now has
a repeat-frequency select + occurrence-count field):

1. `hold_appointment` with `{ business_id, service_id, start, staff,
   recurrence: { freq: "weekly", count: 4 } }`.
2. `confirm_appointment` with the returned `hold_id` — the response speech
   reads "...and 3 more every week after that," and `series_codes` lists
   all 4 confirmation codes.
3. `list_my_appointments` groups all 4 under one `series_id` with
   "(plus 3 more in this series)" in the speech.
4. `cancel_appointment` or `reschedule_appointment` with
   `scope: "series"` to act on every future occurrence at once (past
   occurrences are left alone).

### Phase 14 — Dashboard analytics

Open `/`, scroll the right-hand sidebar past the daily briefing panel to
the new **Analytics** card: a no-show-rate stat tile, a bookings-by-hour
bar chart, a revenue-by-day bar chart, and a bookings-by-channel
breakdown. Or hit the API directly:

```
curl 'http://localhost:3000/api/analytics?business=maple-street-barbers&days=14'
```

Note: the randomized demo seed only creates *future* bookings, so a
freshly-booted server's analytics panel starts at all zeros until some time
passes or a booking is made for "now" or earlier (e.g. via the Phase 11
manual-booking endpoint with a past `start`).

### Phase 15 — Spanish voice support

Set `locale: "es"` on a business (there's no dashboard toggle; edit the
business record directly, or pass it through Bedrock onboarding output).
Then call the MCP tools with Spanish phrases, e.g.:

```
find_availability { business_id, service_id, when: "el martes por la mañana" }
```

Every tool's success-path speech comes back in Spanish — "Estoy
reservando..." for a hold, "Listo, tienes..." for a confirmation,
"Cancelado..." for a cancellation, "Tienes N citas: ..." for a listing.
`test/e2e.test.ts`'s "e2e: Spanish locale (Phase 15)" suite drives this
exact flow end-to-end over the real MCP protocol if you'd rather read code
than set it up by hand.

## Known sandbox limitations (not bugs)

- No headless browser (Chromium/Puppeteer/Playwright) was available in this
  sandbox to visually screenshot the new dashboard charts; the chart
  pipeline was verified by checking the JS syntax (`node --check`) and by
  confirming `GET /api/analytics` returns correct, non-trivial data against
  a live server with real appointments. Same category of gap as the
  original FINAL_REPORT.md's no-Docker/no-AWS-credentials notes.
- No real SMS/push provider exists in this sandbox for Phase 12's
  reminders, so `ConsoleNotificationSink` logs to stdout/the activity feed
  instead — the same pattern the original submission used for Bedrock in
  Phase 6 (implement for real, inject a stub, document the gap).

See PROGRESS_DEV.md for the complete list of every ambiguity and scope
decision made along the way.
