Continue building "Front Desk" on the `dev` branch. The hackathon submission on
`main` is already complete and frozen (SPEC.md, PROGRESS.md, FINAL_REPORT.md,
DONE all describe that finished state — do not edit those files, do not touch
`main`). This spec adds optional stretch features on top of it. Work in
phases, run the tests after each phase, and don't stop until every phase is
either done or explicitly blocked with a documented reason.

## Hard requirements
- Stay on the `dev` branch. Never check out or merge into `main`. Never force-push.
- All 49 existing tests must keep passing throughout. Every new capability
  needs new tests of its own (unit and/or e2e, following the existing
  `test/*.test.ts` conventions and `test/e2e-helpers.ts` pattern).
- Keep the existing hard constraints from SPEC.md intact: `/mcp` stays
  stateless (new McpServer+transport per request), no network/LLM calls
  inside MCP tool handlers, every MCP round trip under 500ms.
- Match existing code conventions: TypeScript ESM/NodeNext, zod schemas,
  `now()`/`isoUtc()` helpers for anything time-dependent (never `new Date()`
  or system-zone-dependent Luxon calls directly), activity events logged via
  the existing Store event log.
- If a feature needs a real third-party credential this sandbox won't have
  (e.g. a Stripe key, an SMS provider key), wire it exactly like Bedrock was
  handled in Phase 6 of the original build: implement it for real, inject a
  stub client for tests, and let the real call fail with a clean, documented
  error when no credentials are present. Don't block other phases on it.

## Phase plan (continue numbering from the original Phase 0-10 in PROGRESS.md;
start a new file PROGRESS_DEV.md for this work instead of editing PROGRESS.md)

### Phase 11: Manual / walk-in booking from the dashboard
The `Appointment.source` field already supports `'phone' | 'walk-in'` but
there's no UI or API to create one directly (owners can currently only see
bookings, not add them).
- New API: `POST /api/appointments` (businessId, serviceId, staffId,
  customerName, customerPhone?, start ISO, source: 'phone'|'walk-in', notes?)
  — creates a *confirmed* appointment directly (no hold step, since there's a
  human taking the call/walk-in, not a 5-minute voice hold). Reuses the same
  double-booking check as `hold_appointment`/`confirm_appointment`.
- Dashboard: a small "add appointment" form/button on the timeline (pick
  staff/service/time, name, phone, source). On success, it appears on the
  timeline and fires the same SSE activity event as a voice booking, visually
  distinguished by `source`.
- Tests: double-booking rejected, appears in `list_my_appointments` if the
  phone matches a linked customer, activity event logged.

### Phase 12: Reminder notifications
No channel currently nudges a customer before a hold expires or before an
upcoming appointment.
- Add a `reminders.ts` module: a `NotificationSink` interface with a
  `ConsoleNotificationSink` (logs to the activity event log — this sandbox has
  no SMS/push provider) and `setNotificationSink()` for test injection, same
  pattern as `setBedrockClient`.
- Two triggers: (a) a hold at ~80% of its 5-minute TTL with no confirm yet;
  (b) an appointment ~2 hours before `start`. Checked by a lightweight
  interval-based sweep (reuse the existing warm-up/interval pattern in
  server.ts, not a new dependency).
- Each firing logs an activity event (`reminder_sent`) and calls the sink
  once per hold/appointment (idempotent — never double-send).
- Tests: a hold near expiry triggers exactly one reminder; an already-expired
  or already-confirmed hold does not; an appointment reminder fires once and
  not again on a second sweep.

### Phase 13: Recurring appointments
- Add optional `recurrence?: { freq: 'weekly'|'biweekly'|'monthly', count: number }`
  to the booking input on `hold_appointment`/`confirm_appointment` (and the
  Phase 11 manual-booking endpoint). Confirming creates the first appointment
  plus `count - 1` future ones at the same weekday/time/staff/service,
  linked by a shared `seriesId`.
- `cancel_appointment` and `reschedule_appointment` act on a single instance
  by default; add a `scope: 'this' | 'series'` input (default `'this'`) to
  cancel/reschedule the whole series when requested.
- Speech: confirm reads back "...and 3 more every week after that" style
  summaries; errors say plainly if any occurrence in the series would
  conflict (reject the whole series rather than partially booking it).
- Tests: a 4-occurrence weekly series books all 4 atomically or none if one
  conflicts; cancelling with `scope: 'series'` cancels all future occurrences
  but not past ones; `list_my_appointments` groups series members.

### Phase 14: Dashboard analytics
Builds on the existing activity-event log and Store state; no new
infrastructure. Load the `dataviz` skill before writing any chart code here.
- New `GET /api/analytics?business=&days=` returning: bookings-by-hour
  histogram, revenue-by-day series, no-show rate (confirmed appointments
  whose `end` has passed with no corresponding... treat "cancelled after
  notice window" as proxy if there's no explicit no-show status), and
  voice-vs-phone-vs-walk-in split.
- Dashboard: a small analytics panel (2-3 charts) below the existing daily
  briefing panel, same paper/dark-mode visual language as the rest of the
  dashboard (#eef2f0 / #1b2a41 / teal / amber / violet).
- Tests: the aggregation math on a fixture with known bookings.

### Phase 15 (lower priority, do last if time remains): Spanish voice support
- A `locale` field on Business (`'en' | 'es'`, default `'en'`). When set,
  `spokenTime.ts` dayparts/phrases and every tool's `speech` string render in
  Spanish. chrono-node has a Spanish parser (`chrono.es`) — use it instead of
  hand-rolling date-phrase translation.
- Tests: the existing spokenTime.test.ts phrases have Spanish equivalents
  that resolve to the same windows.

## Explicitly out of scope for this spec (do not attempt without asking first)
- Real payment/deposit collection (Stripe or otherwise) — collecting real
  card data needs a live compliance/PCI conversation with the project owner,
  not an autonomous decision.
- Multi-location businesses — would change the core Business/Service/Staff
  data model in a way that could break the frozen main-branch submission's
  assumptions; needs a design discussion first.
- A standalone customer-facing portal with its own auth — overlaps with the
  OAuth account-linking design in a way that needs a product decision
  (reuse the same bearer tokens? new session cookie? magic link?) rather
  than being invented autonomously.

## Tests
`npm test` must pass in full after every phase (existing 49 plus every new
test added). Follow the existing `test/*.test.ts` + `test/e2e-helpers.ts`
conventions exactly.

## When done
When every phase above is either complete or documented as blocked, write
FINAL_REPORT_DEV.md (full `npm test` output, a summary of what was added,
and how to exercise each new feature manually), then create an empty file
named DONE_DEV. Do not touch DONE, FINAL_REPORT.md, PROGRESS.md, or SPEC.md —
those belong to the frozen main-branch submission.

Do not ask questions. If something here is ambiguous, choose the most
reasonable option and note it in PROGRESS_DEV.md. Stop and leave a note in
PROGRESS_DEV.md rather than guessing on anything under "Explicitly out of
scope" above.
