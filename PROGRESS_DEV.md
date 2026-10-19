# Progress (dev branch stretch features)

Continuing "Front Desk" from the frozen main-branch submission (Phases 0-10 in
PROGRESS.md). This file tracks the dev-branch stretch work from SPEC_DEV.md.
Never edits SPEC.md/PROGRESS.md/FINAL_REPORT.md/DONE — those stay frozen.

## Phase plan

- [x] Phase 11: Manual / walk-in booking from the dashboard
- [x] Phase 12: Reminder notifications
- [ ] Phase 13: Recurring appointments
- [ ] Phase 14: Dashboard analytics
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

## Next step

Phase 13: recurring appointments (`recurrence` input on hold/confirm/manual
booking, shared `seriesId`, `scope: 'this'|'series'` on cancel/reschedule).
