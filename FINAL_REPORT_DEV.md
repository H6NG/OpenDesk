# Final Report — dev branch stretch features (Phases 11-22)

This is the dev-branch continuation of "Front Desk," building on top of the
frozen main-branch submission (Phases 0-10, documented in PROGRESS.md and
FINAL_REPORT.md). All work described here lives on the `dev` branch; `main`,
SPEC.md, PROGRESS.md, FINAL_REPORT.md, and DONE were never touched.

Every phase in SPEC_DEV.md (11 through 15) is complete, plus several
user-requested additions made after SPEC_DEV.md was finished: Phase 16
(French voice support), Phase 17 (a closed-day alternatives fix, plus a
stock-tracked item/order catalog for businesses that sell goods, not just
appointment time), Phase 18 (group bookings), Phase 19 (staff time-off
blocks), Phase 20 (order-ready notifications plus real, pluggable SMS
delivery), Phase 21 (SMS consent/opt-out tracking, so Phase 20's real
delivery path can't text anyone without their explicit opt-in), and Phase
22 (real per-owner dashboard login, DynamoDB-backed — one owner, one
business, no cross-business visibility, replacing the single
shared-secret `DASHBOARD_TOKEN` as the real auth story).
Deposits/prepayment for no-show-prone bookings was proposed alongside
18-20 but explicitly deferred — it needs a real PCI/compliance conversation
with the project owner, same reasoning as the other out-of-scope items
below. See PROGRESS_DEV.md for the full phase-by-phase log, including every
design decision and scope cut, with reasoning. Nothing was left "explicitly
out of scope" from SPEC_DEV.md's own out-of-scope list (real payments,
multi-location businesses, a standalone customer portal) — none of these
phases touched any of those.

## Full `npm test` output (155/155 passing)

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
# Subtest: requireProduct
    # Subtest: finds a product by id, exact name, or substring name, case-insensitively
    ok 1 - finds a product by id, exact name, or substring name, case-insensitively
    # Subtest: throws a BookingError for an unknown item
    ok 2 - throws a BookingError for an unknown item
    1..2
ok 5 - requireProduct
# Subtest: checkItemAvailability
    # Subtest: reports current stock and price without mutating anything
    ok 1 - reports current stock and price without mutating anything
    1..1
ok 6 - checkItemAvailability
# Subtest: placeOrder
    # Subtest: decrements stock, computes the total price, and logs an order_placed event
    ok 1 - decrements stock, computes the total price, and logs an order_placed event
    # Subtest: defaults quantity to 1 and resolves a spoken pickup phrase into a label
    ok 2 - defaults quantity to 1 and resolves a spoken pickup phrase into a label
    # Subtest: rejects ordering more than is in stock
    ok 3 - rejects ordering more than is in stock
    # Subtest: rejects ordering an item with zero stock
    ok 4 - rejects ordering an item with zero stock
    1..4
ok 7 - placeOrder
# Subtest: cancelOrder
    # Subtest: restocks the item and marks the order cancelled
    ok 1 - restocks the item and marks the order cancelled
    # Subtest: is idempotent on an already-cancelled order
    ok 2 - is idempotent on an already-cancelled order
    # Subtest: rejects cancelling an order belonging to a different customer
    ok 3 - rejects cancelling an order belonging to a different customer
    1..3
ok 8 - cancelOrder
# Subtest: listMyOrders
    # Subtest: lists only the customer's active (placed/ready) orders, oldest first
    ok 1 - lists only the customer's active (placed/ready) orders, oldest first
    1..1
ok 9 - listMyOrders
# Subtest: markOrderReady / markOrderPickedUp
    # Subtest: transitions placed -> ready and notifies the customer
    ok 1 - transitions placed -> ready and notifies the customer
    # Subtest: rejects marking ready an order that isn't placed
    ok 2 - rejects marking ready an order that isn't placed
    # Subtest: transitions ready -> picked_up without sending another notification
    ok 3 - transitions ready -> picked_up without sending another notification
    1..3
ok 10 - markOrderReady / markOrderPickedUp
# Subtest: e2e: none mode
    # Subtest: full flow: find -> details -> availability -> hold -> confirm
    ok 1 - full flow: find -> details -> availability -> hold -> confirm
    # Subtest: prevents double-booking the same slot and staff
    ok 2 - prevents double-booking the same slot and staff
    # Subtest: confirm_appointment is idempotent
    ok 3 - confirm_appointment is idempotent
    # Subtest: reschedules an appointment by its 4-character code
    ok 4 - reschedules an appointment by its 4-character code
    # Subtest: says the business is closed on a fully-closed day, and still offers the next open alternative
    ok 5 - says the business is closed on a fully-closed day, and still offers the next open alternative
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
    # Subtest: Phase 18: group bookings
        # Subtest: books a 2-person party via hold+confirm with a distinct staff member each, speech mentions it, and list_my_appointments groups it
        ok 1 - books a 2-person party via hold+confirm with a distinct staff member each, speech mentions it, and list_my_appointments groups it
        # Subtest: rejects a group too large for the business's staff
        ok 2 - rejects a group too large for the business's staff
        1..2
    ok 14 - Phase 18: group bookings
    # Subtest: Phase 21: SMS consent
        # Subtest: opts in and back out, idempotently
        ok 1 - opts in and back out, idempotently
        1..1
    ok 15 - Phase 21: SMS consent
    # Subtest: Phase 17: item catalog / orders
        # Subtest: checks availability, orders, lists, and cancels an item order
        ok 1 - checks availability, orders, lists, and cancels an item order
        # Subtest: reports out of stock and rejects ordering more than is in stock
        ok 2 - reports out of stock and rejects ordering more than is in stock
        1..2
    ok 16 - Phase 17: item catalog / orders
    1..16
ok 11 - e2e: none mode
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
ok 12 - e2e: oauth mode
# Subtest: e2e: Spanish locale (Phase 15)
    # Subtest: finds, holds, confirms, lists, and cancels entirely in Spanish
    ok 1 - finds, holds, confirms, lists, and cancels entirely in Spanish
    # Subtest: reports a closed day in Spanish
    ok 2 - reports a closed day in Spanish
    1..2
ok 13 - e2e: Spanish locale (Phase 15)
# Subtest: e2e: French locale (Phase 16)
    # Subtest: finds, holds, confirms, lists, and cancels entirely in French
    ok 1 - finds, holds, confirms, lists, and cancels entirely in French
    # Subtest: reports a closed day in French
    ok 2 - reports a closed day in French
    1..2
ok 14 - e2e: French locale (Phase 16)
# Subtest: group bookings: hold + confirm
    # Subtest: books a 3-person party atomically, each attendee with a different staff member
    ok 1 - books a 3-person party atomically, each attendee with a different staff member
    # Subtest: defaults to the caller's own name plus 'Guest N' when no names are given
    ok 2 - defaults to the caller's own name plus 'Guest N' when no names are given
    # Subtest: rejects a group booking immediately if too few staff perform the service
    ok 3 - rejects a group booking immediately if too few staff perform the service
    # Subtest: rejects the whole group at confirm time if not enough staff are free, leaving the hold intact
    ok 4 - rejects the whole group at confirm time if not enough staff are free, leaving the hold intact
    # Subtest: rejects combining recurrence and party in the same booking
    ok 5 - rejects combining recurrence and party in the same booking
    # Subtest: confirming an already-confirmed group hold is idempotent and returns the same group
    ok 6 - confirming an already-confirmed group hold is idempotent and returns the same group
    1..6
ok 15 - group bookings: hold + confirm
# Subtest: group bookings: manual booking
    # Subtest: createManualAppointment with party books every attendee as confirmed directly, each with a distinct staff member
    ok 1 - createManualAppointment with party books every attendee as confirmed directly, each with a distinct staff member
    1..1
ok 16 - group bookings: manual booking
# Subtest: signUpOwner / loginOwner / getSessionOwner / logoutOwner
    # Subtest: signs up, logs in, resolves the session, and logs out
    ok 1 - signs up, logs in, resolves the session, and logs out
    # Subtest: rejects a duplicate email
    ok 2 - rejects a duplicate email
    # Subtest: rejects a password under 8 characters
    ok 3 - rejects a password under 8 characters
    # Subtest: rejects the wrong password
    ok 4 - rejects the wrong password
    # Subtest: rejects login for an unknown email
    ok 5 - rejects login for an unknown email
    # Subtest: getSessionOwner returns null for a missing or garbage token
    ok 6 - getSessionOwner returns null for a missing or garbage token
    1..6
ok 17 - signUpOwner / loginOwner / getSessionOwner / logoutOwner
# Subtest: dashboard routes with owner-auth enabled (in-process, stub Dynamo client)
    # Subtest: GET /api/me reports ownerAuthEnabled and unauthenticated before login
    ok 1 - GET /api/me reports ownerAuthEnabled and unauthenticated before login
    # Subtest: signup sets a session cookie that GET /api/state honors, scoped to that owner's business only
    ok 2 - signup sets a session cookie that GET /api/state honors, scoped to that owner's business only
    # Subtest: rejects mutating a different business's data even with a valid session for another business
    ok 3 - rejects mutating a different business's data even with a valid session for another business
    # Subtest: rejects /api/state with no cookie at all
    ok 4 - rejects /api/state with no cookie at all
    # Subtest: logout clears the session so the cookie no longer works
    ok 5 - logout clears the session so the cookie no longer works
    1..5
ok 18 - dashboard routes with owner-auth enabled (in-process, stub Dynamo client)
# Subtest: recurring appointments: hold + confirm
    # Subtest: books a 4-occurrence weekly series atomically, every Monday
    ok 1 - books a 4-occurrence weekly series atomically, every Monday
    # Subtest: rejects the whole series if any occurrence conflicts, booking none of it
    ok 2 - rejects the whole series if any occurrence conflicts, booking none of it
    1..2
ok 19 - recurring appointments: hold + confirm
# Subtest: recurring appointments: cancel / reschedule scope
    # Subtest: cancel scope:'series' cancels the target and future occurrences but leaves past ones alone
    ok 1 - cancel scope:'series' cancels the target and future occurrences but leaves past ones alone
    # Subtest: reschedule scope:'series' shifts future occurrences by the same delta
    ok 2 - reschedule scope:'series' shifts future occurrences by the same delta
    # Subtest: reschedule scope:'this' (default) leaves siblings untouched
    ok 3 - reschedule scope:'this' (default) leaves siblings untouched
    1..3
ok 20 - recurring appointments: cancel / reschedule scope
# Subtest: recurring appointments: manual booking
    # Subtest: createManualAppointment with recurrence books every occurrence as confirmed directly
    ok 1 - createManualAppointment with recurrence books every occurrence as confirmed directly
    1..1
ok 21 - recurring appointments: manual booking
# Subtest: sweepReminders: hold expiry
    # Subtest: fires exactly one reminder once a hold has used 80% of its 5-minute TTL
    ok 1 - fires exactly one reminder once a hold has used 80% of its 5-minute TTL
    # Subtest: does not remind an already-expired hold
    ok 2 - does not remind an already-expired hold
    # Subtest: does not remind an already-confirmed hold
    ok 3 - does not remind an already-confirmed hold
    1..3
ok 22 - sweepReminders: hold expiry
# Subtest: sweepReminders: upcoming appointment
    # Subtest: fires once ~2 hours before start and not again on a second sweep
    ok 1 - fires once ~2 hours before start and not again on a second sweep
    # Subtest: logs a reminder_sent activity event
    ok 2 - logs a reminder_sent activity event
    1..2
ok 23 - sweepReminders: upcoming appointment
# Subtest: smsConfigured
    # Subtest: is true only when all three fields are set
    ok 1 - is true only when all three fields are set
    1..1
ok 24 - smsConfigured
# Subtest: sendSms
    # Subtest: throws a clear error when not configured, without touching the client
    ok 1 - throws a clear error when not configured, without touching the client
    # Subtest: calls the injected client with to/from/body when configured
    ok 2 - calls the injected client with to/from/body when configured
    # Subtest: propagates a client failure
    ok 3 - propagates a client failure
    1..3
ok 25 - sendSms
# Subtest: SmsNotificationSink
    # Subtest: sends via the configured client when the customer has a phone on file and has consented
    ok 1 - sends via the configured client when the customer has a phone on file and has consented
    # Subtest: logs instead of sending when the customer hasn't consented, even with a phone on file
    ok 2 - logs instead of sending when the customer hasn't consented, even with a phone on file
    # Subtest: logs instead of sending when the customer has no phone on file
    ok 3 - logs instead of sending when the customer has no phone on file
    # Subtest: logs rather than throwing when the send fails
    ok 4 - logs rather than throwing when the send fails
    1..4
ok 26 - SmsNotificationSink
# Subtest: Store.setSmsConsent
    # Subtest: records opt-in with a timestamp, defaulting to no consent beforehand
    ok 1 - records opt-in with a timestamp, defaulting to no consent beforehand
    # Subtest: records opt-out just as well
    ok 2 - records opt-out just as well
    # Subtest: returns undefined for an unknown customer
    ok 3 - returns undefined for an unknown customer
    1..3
ok 27 - Store.setSmsConsent
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
ok 28 - parseSpokenWindow
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
ok 29 - parseSpokenWindow: Spanish equivalents resolve to the same windows
# Subtest: parseSpokenWindow: French equivalents resolve to the same windows
    # Subtest: "jeudi après le travail" -> 10-22, band [1020,1260]
    ok 1 - "jeudi après le travail" -> 10-22, band [1020,1260]
    # Subtest: "demain matin" -> 10-19, [480,720]
    ok 2 - "demain matin" -> 10-19, [480,720]
    # Subtest: "ce week-end" -> 10-18 only
    ok 3 - "ce week-end" -> 10-18 only
    # Subtest: "le week-end prochain" -> 10-24..10-25
    ok 4 - "le week-end prochain" -> 10-24..10-25
    # Subtest: "la semaine prochaine" -> 10-19..10-25
    ok 5 - "la semaine prochaine" -> 10-19..10-25
    # Subtest: "après 3 vendredi" -> 10-23, [900,1440]
    ok 6 - "après 3 vendredi" -> 10-23, [900,1440]
    # Subtest: "avant midi demain" -> [0,720]
    ok 7 - "avant midi demain" -> [0,720]
    # Subtest: "entre 2 et 4 mercredi" -> [840,960]
    ok 8 - "entre 2 et 4 mercredi" -> [840,960]
    # Subtest: "jeudi à 5:30pm" -> exact Thu 17:30
    ok 9 - "jeudi à 5:30pm" -> exact Thu 17:30
    # Subtest: "à l'heure du déjeuner mardi" -> [690,810]
    ok 10 - "à l'heure du déjeuner mardi" -> [690,810]
    # Subtest: "30 octobre"
    ok 11 - "30 octobre"
    # Subtest: "8am" -> rolls to 10-19 (digits parse the same in every locale)
    ok 12 - "8am" -> rolls to 10-19 (digits parse the same in every locale)
    1..12
ok 30 - parseSpokenWindow: French equivalents resolve to the same windows
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
    # Subtest: formats tomorrow in French
    ok 7 - formats tomorrow in French
    # Subtest: formats a weekday within the week in French
    ok 8 - formats a weekday within the week in French
    # Subtest: formats a date far enough out to need the full form in French
    ok 9 - formats a date far enough out to need the full form in French
    1..9
ok 31 - speakDateTime
# Subtest: addStaffTimeOff / removeStaffTimeOff / listStaffTimeOff
    # Subtest: adds a block, lists only future/ongoing ones, and removes it
    ok 1 - adds a block, lists only future/ongoing ones, and removes it
    # Subtest: excludes blocks that have already ended
    ok 2 - excludes blocks that have already ended
    # Subtest: rejects an unknown staff member and a backwards range
    ok 3 - rejects an unknown staff member and a backwards range
    # Subtest: removing an unknown id throws
    ok 4 - removing an unknown id throws
    1..4
ok 32 - addStaffTimeOff / removeStaffTimeOff / listStaffTimeOff
# Subtest: staff time-off integrated into availability
    # Subtest: excludes a blocked staff member from findAvailability during their time off
    ok 1 - excludes a blocked staff member from findAvailability during their time off
    # Subtest: isSlotFree returns false during a blocked staff member's time off
    ok 2 - isSlotFree returns false during a blocked staff member's time off
    1..2
ok 33 - staff time-off integrated into availability
1..33
# tests 155
# suites 41
# pass 155
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 7939.432375
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
- **Phase 16 — French voice support** (user-requested, after SPEC_DEV.md):
  setting `Business.locale = "fr"` does the same for French (via
  `chrono.fr`), on the same `Locale`/`RULES` foundation Phase 15 built.
- **Phase 17 — closed-day fix + item catalog/orders** (user-requested,
  after SPEC_DEV.md): `find_availability` now offers the next open
  alternative even when the business is closed for the whole requested
  window, not just when it's fully booked. Separately, businesses can now
  carry a stock-tracked catalog of physical items/dishes — independent of
  the time-slot Services — with `check_item_availability`, `order_item`,
  `list_my_orders`, and `cancel_order` (no hold/confirm step: an in-stock
  item has no time-slot contention to protect against).
- **Phase 18 — Group bookings** (user-requested, after SPEC_DEV.md):
  `hold_appointment`/`confirm_appointment`/the manual-booking endpoint take
  an optional `party: { count, names? }` and book every attendee's
  appointment atomically at the same start time, each with a different
  staff member (e.g. 3 kids' haircuts at once). Mutually exclusive with
  `recurrence`.
- **Phase 19 — Staff time off** (user-requested, after SPEC_DEV.md): an
  owner can mark a staff member unavailable for a block of time (e.g. "Sam
  is out sick Thursday"), independent of the business's own hours. Folded
  directly into the existing busy-interval index, so every
  availability/double-booking check already respects it automatically.
- **Phase 20 — Order-ready notifications + real SMS** (user-requested,
  after SPEC_DEV.md): an owner marks a placed order "ready," which notifies
  the customer — the piece that was previously missing even though
  `Order.status` already had a `"ready"` value. The notification system
  itself gained a real, pluggable delivery path: a Twilio-backed
  `SmsNotificationSink` sends an actual SMS when `TWILIO_*` credentials are
  configured, falling back to the existing console sink otherwise — same
  "implement it for real, fail cleanly without live credentials" pattern
  Phase 6 used for Bedrock.
- **Phase 21 — SMS consent/opt-out tracking** (user-requested, after
  SPEC_DEV.md): a customer must explicitly opt in via the new
  `set_sms_consent` tool before `SmsNotificationSink` will ever text them
  — a phone number on file is never enough on its own. Closes a real
  compliance gap Phase 20 opened: once real SMS delivery exists, texting
  without consent is a TCPA risk, not just a demo shortcut.
- **Phase 22 — Real per-owner dashboard login** (user-requested, after
  SPEC_DEV.md): DynamoDB-backed owner accounts (`src/owners.ts`) replace
  the single shared `DASHBOARD_TOKEN` as the dashboard's real auth story —
  one owner, one business, no cross-business visibility, every mutating
  route checks ownership and 403s otherwise. Entirely additive: with no
  `DYNAMODB_*` env vars set (the default), the dashboard behaves exactly as
  before this phase, zero risk to any pre-existing test or the already-live
  demo server.

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

### Phase 16 — French voice support

Same mechanism as Phase 15, just `locale: "fr"`. Set it on a business, then
call the MCP tools with French phrases, e.g.:

```
find_availability { business_id, service_id, when: "mardi matin" }
```

Every tool's success-path speech comes back in French — "Je réserve..." for
a hold, "C'est réservé..." for a confirmation, "Annulé..." for a
cancellation, "Vous avez N rendez-vous : ..." for a listing.
`test/e2e.test.ts`'s "e2e: French locale (Phase 16)" suite drives this exact
flow end-to-end over the real MCP protocol if you'd rather read code than
set it up by hand.

### Phase 17 — closed-day alternatives + item catalog/orders

**Closed-day alternatives**: ask `find_availability` for a day the business
is fully closed (e.g. Sunday at Maple Street Barbers) — the speech now adds
"The next time they're open is ..." with a real alternative slot, instead of
just stopping at "they're closed."

**Item catalog/orders**: Maple Street Barbers carries two seeded items
(Matte Pomade, Beard Oil); Paws and Suds Grooming carries two more, one
seeded at zero stock (Dental Chews) to demo the out-of-stock path. Via an
MCP client:

```
check_item_availability { business_id: "maple-street-barbers", item: "beard oil" }
order_item { business_id: "maple-street-barbers", item: "beard oil", quantity: 2, pickup_when: "tomorrow morning" }
list_my_orders {}
cancel_order { order_id: "<order_id from order_item>" }
```

`order_item` decrements stock immediately (no hold/confirm step) and
returns a spoken confirmation code the same way `confirm_appointment` does;
`cancel_order` restocks the item. On the dashboard, open `/`, pick a
business with products — the new **Products** card lets the owner set a
stock count directly, and the new **Orders** card lists active orders.
Manually verified against a live server: `GET /api/state` returns the
business's `products`/`orders`, `PATCH /api/products/:id` restocks, and a
full MCP round trip (check → order → list) produced the expected speech
("Order placed: 2 Beard Oil from Maple Street Barbers, total $30, ready
tomorrow morning...") with stock correctly decremented from 4 to 2.
`test/catalog.test.ts` and the "Phase 17: item catalog / orders" suite in
`test/e2e.test.ts` cover this without needing a live server.

### Phase 18 — Group bookings

Via an MCP client, book a party at the same time with different staff:

```
find_availability { business_id: "maple-street-barbers", service_id: "mens-cut", when: "tomorrow morning" }
hold_appointment { business_id: "maple-street-barbers", service_id: "mens-cut", start: "<a slot's start>", party: { count: 2, names: ["Mia", "Liam"] } }
confirm_appointment { hold_id: "<hold_id from above>" }
list_my_appointments {}
```

The confirmation speech adds "I've also got Liam in your group," and
`group_codes` lists both confirmation codes; `list_my_appointments` groups
them with "(plus 1 more in this group)." If the business doesn't have
enough staff who perform the service free at that exact time, the whole
group is rejected atomically and the hold is left intact (same shape as
Phase 13's recurrence). Manually verified against a live server with the
real randomized demo seed: a contended slot correctly rejected the whole
group while a different, open slot booked cleanly for both attendees with
two different barbers. `test/group.test.ts` (unit, with a dedicated
3-staff fixture) and the "Phase 18: group bookings" suite in
`test/e2e.test.ts` cover this deterministically.

### Phase 19 — Staff time off

Via the dashboard: open `/`, pick a business, open the **Staff time off**
card, and add a block (staff member, from/to ISO times, optional reason).
Or directly:

```
curl -X POST http://localhost:3000/api/staff-time-off \
  -H 'content-type: application/json' \
  -d '{"businessId":"maple-street-barbers","staffId":"sam","fromIso":"2026-10-20T00:00:00-07:00","toIso":"2026-10-21T00:00:00-07:00","reason":"sick"}'
```

Then call `find_availability` for that staff member on that day — they no
longer appear, while other staff are unaffected. Manually verified against
a live server: adding Sam's time-off block made `find_availability`
(filtered to Sam) return zero slots for that day while Priya's slots were
untouched. `test/staffTimeOff.test.ts` covers the CRUD operations and the
availability-engine integration directly.

### Phase 20 — Order-ready notifications + real SMS

Place an order (see Phase 17 above), then mark it ready from the dashboard's
**Orders** card ("Mark ready" button), or directly:

```
curl -X PATCH http://localhost:3000/api/orders/<order_id> -H 'content-type: application/json' -d '{"status":"ready"}'
```

With no `TWILIO_*` env vars set, the notification logs to the console/
activity feed exactly like Phase 12's reminders do (verified live: `[notify]
Your order for 1 Matte Pomade at Maple Street Barbers is ready for pickup.`
appeared on the server's stdout). Set `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` in `.env` to send a real SMS
instead — `server.ts` swaps in `SmsNotificationSink` automatically when all
three are present. `test/sms.test.ts` covers the Twilio REST client (via an
injectable stub, same pattern as `setBedrockClient`) and the
configured-vs-unconfigured/success-vs-failure paths without ever making a
real network call; `test/catalog.test.ts`'s `markOrderReady` suite covers
the status transition and notification firing.

### Phase 21 — SMS consent/opt-out tracking

Via an MCP client:

```
set_sms_consent { opt_in: true }
```

Speech confirms: "Got it, I'll text you reminders and order updates." From
that point on, `SmsNotificationSink` will actually text that customer when
`TWILIO_*` is configured (see Phase 20); without this call first, it logs
"no SMS consent on file" and refuses to send even with a real phone number
and real credentials. Call it again with `opt_in: false` to unsubscribe —
speech confirms "Got it, I won't text you anymore." Manually verified
against a live server: both directions returned the correct `sms_consent`
value and speech. `test/sms.test.ts` covers `Store.setSmsConsent` and the
`SmsNotificationSink` consent gate directly; the "Phase 21: SMS consent"
e2e suite drives the actual tool round trip.

### Phase 22 — Real per-owner dashboard login

Off by default — the dashboard behaves exactly as in every earlier phase
until both `DYNAMODB_OWNERS_TABLE` and `DYNAMODB_SESSIONS_TABLE` are set.
To turn it on:

```
npm run setup:dynamodb   # one-time, with your own AWS credentials; creates both tables
```

Then set the two table names (and `AWS_REGION`) in `.env` and restart the
server. Visit `/` — you'll be redirected to `/login`. Sign up with an
email, password, and an existing business (picked from a dropdown backed
by the new unauthenticated `GET /api/public/businesses`), and you're
dropped straight into that business's dashboard — no business-picker
dropdown anymore, just that one business and a working **Log out** button.
Try hitting `/api/state?business=<a-different-business-id>` with your
session cookie: you still only ever get your own business back, confirming
the server ignores the query param entirely once a session is active.
`test/owners.test.ts` covers this without needing real AWS credentials: 6
unit tests against `src/owners.ts` directly, plus 5 in-process Express
integration tests driving the real HTTP routes (signup → cookie → scoped
`/api/state`, a cross-business mutation attempt correctly 403ing, no
cookie correctly 401ing, logout actually invalidating the session) against
an injected stub DynamoDB client.

## Known sandbox limitations (not bugs)

- No headless browser (Chromium/Puppeteer/Playwright) was available in this
  sandbox to visually screenshot the new dashboard charts, the Phase 17
  Products/Orders cards, or the Phase 19 Staff time off card; verified
  instead by checking the dashboard's inline JS syntax (`node --check`) and
  by exercising the real endpoints (`GET /api/analytics`, `GET /api/state`,
  `PATCH /api/products/:id`, `POST /api/staff-time-off`,
  `PATCH /api/orders/:id`) and full MCP round trips against a live server.
  Same category of gap as the original FINAL_REPORT.md's
  no-Docker/no-AWS-credentials notes.
- No real Twilio account/credentials exist in this sandbox, so
  `SmsNotificationSink` (Phase 20) was never exercised against the live
  Twilio API — only against an injected stub client in `test/sms.test.ts`.
  Without `TWILIO_*` configured, both Phase 12's reminders and Phase 20's
  order-ready notifications fall back to `ConsoleNotificationSink`
  (stdout/the activity feed) — the same "implement for real, inject a
  stub, document the gap" pattern the original submission used for
  Bedrock in Phase 6.
- No real AWS account/credentials were used in this sandbox to actually
  create or call the two DynamoDB tables (Phase 22) — this session built
  the code, wrote `scripts/setup-dynamodb.ts` for the user to run
  themselves, and verified the full signup/login/session/ownership logic
  against an injected stub client (`test/owners.test.ts`, both at the
  `src/owners.ts` unit level and via a real in-process Express HTTP
  server). The one thing that couldn't be exercised here specifically is
  the live DynamoDB network call itself — same category of gap as the
  Twilio/Bedrock notes above, and the dashboard behaves identically with
  or without it configured, so this never blocked anything else.

See PROGRESS_DEV.md for the complete list of every ambiguity and scope
decision made along the way.
