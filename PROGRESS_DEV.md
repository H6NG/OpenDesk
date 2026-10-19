# Progress (dev branch stretch features)

Continuing "Front Desk" from the frozen main-branch submission (Phases 0-10 in
PROGRESS.md). This file tracks the dev-branch stretch work from SPEC_DEV.md.
Never edits SPEC.md/PROGRESS.md/FINAL_REPORT.md/DONE — those stay frozen.

## Phase plan

- [x] Phase 11: Manual / walk-in booking from the dashboard
- [ ] Phase 12: Reminder notifications
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

Phase 12: reminder notifications (`src/reminders.ts`, `NotificationSink`,
interval sweep in `server.ts`, `reminder_sent` activity events).
