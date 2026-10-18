# Final report

Built autonomously overnight from SPEC.md. All phases in PROGRESS.md are
complete and `npm test` passes in full (49/49).

## Full `npm test` output

```
> front-desk@0.1.0 test
> tsx --test test/*.test.ts

TAP version 13
# Subtest: findAvailability
    # Subtest: respects lead time and business hours
    ok 1 - respects lead time and business hours
      ---
      duration_ms: 5.926291
      ...
    # Subtest: excludes busy intervals with buffer applied
    ok 2 - excludes busy intervals with buffer applied
      ---
      duration_ms: 2.698375
      ...
    # Subtest: ignores expired holds
    ok 3 - ignores expired holds
      ---
      duration_ms: 0.5445
      ...
    # Subtest: sorts exact-time requests by distance
    ok 4 - sorts exact-time requests by distance
      ---
      duration_ms: 2.205209
      ...
    # Subtest: does not cap a single-day search at 2 slots
    ok 5 - does not cap a single-day search at 2 slots
      ---
      duration_ms: 0.5705
      ...
    # Subtest: caps multi-day searches at 2 per day with 30-minute spacing
    ok 6 - caps multi-day searches at 2 per day with 30-minute spacing
      ---
      duration_ms: 0.794416
      ...
    # Subtest: isOpenDuringWindow is false for a fully closed day
    ok 7 - isOpenDuringWindow is false for a fully closed day
      ---
      duration_ms: 0.199041
      ...
    1..7
ok 1 - findAvailability
  ---
  duration_ms: 14.01925
  type: 'suite'
  ...
# Subtest: onboardBusiness
    # Subtest: forces save_business, strips $schema, and sets temperature 0
    ok 1 - forces save_business, strips $schema, and sets temperature 0
      ---
      duration_ms: 5.539916
      ...
    # Subtest: converts output correctly: an acrylic set only bookable with Tran
    ok 2 - converts output correctly: an acrylic set only bookable with Tran
      ---
      duration_ms: 0.775708
      ...
    # Subtest: the new business is immediately bookable
    ok 3 - the new business is immediately bookable
      ---
      duration_ms: 48.620167
      ...
    # Subtest: rejects invalid output with a clear error
    ok 4 - rejects invalid output with a clear error
      ---
      duration_ms: 1.267959
      ...
    # Subtest: rejects output where a service has no staff who can perform it
    ok 5 - rejects output where a service has no staff who can perform it
      ---
      duration_ms: 0.520125
      ...
    1..5
ok 2 - onboardBusiness
  ---
  duration_ms: 57.261083
  type: 'suite'
  ...
# Subtest: dailyBriefing
    # Subtest: stays within 90 words and mentions the business
    ok 1 - stays within 90 words and mentions the business
      ---
      duration_ms: 28.036792
      ...
    1..1
ok 3 - dailyBriefing
  ---
  duration_ms: 28.162333
  type: 'suite'
  ...
# Subtest: e2e: none mode
    # Subtest: full flow: find -> details -> availability -> hold -> confirm
    ok 1 - full flow: find -> details -> availability -> hold -> confirm
      ---
      duration_ms: 25.371458
      ...
    # Subtest: prevents double-booking the same slot and staff
    ok 2 - prevents double-booking the same slot and staff
      ---
      duration_ms: 7.518959
      ...
    # Subtest: confirm_appointment is idempotent
    ok 3 - confirm_appointment is idempotent
      ---
      duration_ms: 9.356084
      ...
    # Subtest: reschedules an appointment by its 4-character code
    ok 4 - reschedules an appointment by its 4-character code
      ---
      duration_ms: 7.698584
      ...
    # Subtest: says the business is closed on a fully-closed day
    ok 5 - says the business is closed on a fully-closed day
      ---
      duration_ms: 3.596916
      ...
    # Subtest: offers alternatives and the waitlist when fully booked, then auto-offers the freed slot on cancel
    ok 6 - offers alternatives and the waitlist when fully booked, then auto-offers the freed slot on cancel
      ---
      duration_ms: 29.370333
      ...
    # Subtest: returns a recoverable error for an unknown business
    ok 7 - returns a recoverable error for an unknown business
      ---
      duration_ms: 2.502416
      ...
    # Subtest: GET /health reports protocol 2025-11-25
    ok 8 - GET /health reports protocol 2025-11-25
      ---
      duration_ms: 1.087791
      ...
    # Subtest: GET /api/state returns dashboard state for the business
    ok 9 - GET /api/state returns dashboard state for the business
      ---
      duration_ms: 1.507917
      ...
    # Subtest: GET /mcp returns 405 with Allow: POST
    ok 10 - GET /mcp returns 405 with Allow: POST
      ---
      duration_ms: 0.760833
      ...
    1..10
ok 4 - e2e: none mode
  ---
  duration_ms: 831.178667
  type: 'suite'
  ...
# Subtest: e2e: oauth mode
    # Subtest: part 1b: two linked customers
        # Subtest: A books the only slot, B waitlists, A cancels, B gets offered and confirms, A cannot cancel B's booking
        ok 1 - A books the only slot, B waitlists, A cancels, B gets offered and confirms, A cannot cancel B's booking
          ---
          duration_ms: 76.759166
          ...
        1..1
    ok 1 - part 1b: two linked customers
      ---
      duration_ms: 77.032666
      type: 'suite'
      ...
    # Subtest: part 2: oauth protocol
        # Subtest: 401 with no WWW-Authenticate header when unauthenticated
        ok 1 - 401 with no WWW-Authenticate header when unauthenticated
          ---
          duration_ms: 0.984792
          ...
        # Subtest: protected resource metadata is correct
        ok 2 - protected resource metadata is correct
          ---
          duration_ms: 1.4445
          ...
        # Subtest: authorization server metadata includes S256
        ok 3 - authorization server metadata includes S256
          ---
          duration_ms: 0.665708
          ...
        # Subtest: rejects a wrong resource parameter at /oauth/authorize
        ok 4 - rejects a wrong resource parameter at /oauth/authorize
          ---
          duration_ms: 0.911
          ...
        # Subtest: rejects plain PKCE
        ok 5 - rejects plain PKCE
          ---
          duration_ms: 0.677417
          ...
        # Subtest: rejects an unregistered redirect_uri without redirecting to it
        ok 6 - rejects an unregistered redirect_uri without redirecting to it
          ---
          duration_ms: 0.577125
          ...
        # Subtest: a wrong code_verifier gives invalid_grant
        ok 7 - a wrong code_verifier gives invalid_grant
          ---
          duration_ms: 1.867042
          ...
        # Subtest: happy path issues tokens and a query-string token gives 401
        ok 8 - happy path issues tokens and a query-string token gives 401
          ---
          duration_ms: 2.466375
          ...
        # Subtest: an authenticated booking is attributed to the linked customer
        ok 9 - an authenticated booking is attributed to the linked customer
          ---
          duration_ms: 8.2295
          ...
        # Subtest: refresh rotation rejects the old refresh token
        ok 10 - refresh rotation rejects the old refresh token
          ---
          duration_ms: 3.136875
          ...
        1..10
    ok 2 - part 2: oauth protocol
      ---
      duration_ms: 21.199917
      type: 'suite'
      ...
    1..2
ok 5 - e2e: oauth mode
  ---
  duration_ms: 603.849625
  type: 'suite'
  ...
# Subtest: parseSpokenWindow
    # Subtest: "thursday after work" -> 10-22, band [1020,1260]
    ok 1 - "thursday after work" -> 10-22, band [1020,1260]
      ---
      duration_ms: 22.877125
      ...
    # Subtest: "tomorrow morning" -> 10-19, [480,720]
    ok 2 - "tomorrow morning" -> 10-19, [480,720]
      ---
      duration_ms: 133.741959
      ...
    # Subtest: "this weekend" -> 10-18 only
    ok 3 - "this weekend" -> 10-18 only
      ---
      duration_ms: 0.404875
      ...
    # Subtest: "next weekend" -> 10-24..10-25
    ok 4 - "next weekend" -> 10-24..10-25
      ---
      duration_ms: 0.298167
      ...
    # Subtest: "next week" -> 10-19..10-25
    ok 5 - "next week" -> 10-19..10-25
      ---
      duration_ms: 0.245583
      ...
    # Subtest: "after 3 on friday" -> 10-23, [900,1440]
    ok 6 - "after 3 on friday" -> 10-23, [900,1440]
      ---
      duration_ms: 0.551958
      ...
    # Subtest: "before noon tomorrow" -> [0,720]
    ok 7 - "before noon tomorrow" -> [0,720]
      ---
      duration_ms: 0.3615
      ...
    # Subtest: "between 2 and 4 on wednesday" -> [840,960]
    ok 8 - "between 2 and 4 on wednesday" -> [840,960]
      ---
      duration_ms: 0.570417
      ...
    # Subtest: "thursday at 5:30pm" -> exact Thu 17:30
    ok 9 - "thursday at 5:30pm" -> exact Thu 17:30
      ---
      duration_ms: 1.251167
      ...
    # Subtest: "lunchtime on tuesday" -> [690,810]
    ok 10 - "lunchtime on tuesday" -> [690,810]
      ---
      duration_ms: 0.603208
      ...
    # Subtest: "october 30"
    ok 11 - "october 30"
      ---
      duration_ms: 1.001458
      ...
    # Subtest: "8am" -> rolls to 10-19
    ok 12 - "8am" -> rolls to 10-19
      ---
      duration_ms: 1.15675
      ...
    1..12
ok 6 - parseSpokenWindow
  ---
  duration_ms: 163.96875
  type: 'suite'
  ...
# Subtest: speakDateTime
    # Subtest: formats tomorrow
    ok 1 - formats tomorrow
      ---
      duration_ms: 0.218333
      ...
    # Subtest: formats a weekday within the week
    ok 2 - formats a weekday within the week
      ---
      duration_ms: 0.184542
      ...
    # Subtest: formats a date far enough out to need the full form
    ok 3 - formats a date far enough out to need the full form
      ---
      duration_ms: 0.302958
      ...
    1..3
ok 7 - speakDateTime
  ---
  duration_ms: 0.777584
  type: 'suite'
  ...
1..7
# tests 49
# suites 9
# pass 49
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 4816.565625
```

`npm run build` (TypeScript compile to `dist/`) also completes with no
errors. The compiled server (`node dist/server.js`) was run and smoke-tested
alongside the `tsx`-run dev server; both serve the dashboard at `/` and
respond correctly at `/health`.

Note: the sandbox this was built in has no Docker daemon running and no AWS
credentials, so `docker build` and a live Bedrock call couldn't be exercised
end-to-end here. Every step the Dockerfile performs was verified individually
(`npm run build` produces `dist/`, `node dist/server.js` runs correctly with
`public/` present), and the Bedrock integration is covered by
`test/bedrock.test.ts` against a stubbed client plus a real, non-stubbed call
in `/api/onboard` that correctly surfaces AWS's "could not load credentials"
error as a clean 502, i.e. the wiring is right; a real `AWS_REGION` and
credentials are all that's needed for it to actually call Bedrock.

## How to run the server

```sh
npm install
cp .env.example .env    # defaults work for a local demo, AUTH_MODE=none
npm run dev             # or: npm run build && npm start
```

The server listens on `http://localhost:3000` by default. Open it in a
browser for the owner dashboard. The MCP endpoint is `http://localhost:3000/mcp`.

To freeze the clock for a deterministic demo (matches the dates used
throughout SPEC.md and the test suite):

```sh
FRONTDESK_NOW=2026-10-18T09:00:00-07:00 npm run dev
```

With `AUTH_MODE=none` (the default), every MCP call is attributed to a fixed
demo customer, "Alex Rivera", no account linking needed, which is the
fastest way to try the tools directly.

## How to expose it with cloudflared

1. Install cloudflared if you don't have it: `brew install cloudflared`
   (macOS) or see https://github.com/cloudflare/cloudflared for other
   platforms.
2. With the server running locally on port 3000, in a second terminal:

   ```sh
   cloudflared tunnel --url http://localhost:3000
   ```

3. cloudflared prints a public HTTPS URL like
   `https://random-words-1234.trycloudflare.com`. That's your public
   `PUBLIC_URL` for this session. The MCP endpoint is
   `https://random-words-1234.trycloudflare.com/mcp`.

4. If you want to test `AUTH_MODE=oauth` through the tunnel instead of
   `none`, restart the server with that URL baked in so OAuth metadata and
   the `resource` parameter line up:

   ```sh
   PUBLIC_URL=https://random-words-1234.trycloudflare.com \
   AUTH_MODE=oauth \
   OAUTH_CLIENT_ID=demo-client \
   OAUTH_REDIRECT_URIS=https://your-client-redirect-uri \
   FRONTDESK_NOW=2026-10-18T09:00:00-07:00 \
   npm run dev
   ```

   (Restart cloudflared too if the server restarted, or just keep the same
   terminal running throughout and only restart the Node process.)

## How to connect with the alexa-ai CLI

With the tunnel's HTTPS URL in hand:

```sh
alexa-ai connect --endpoint https://random-words-1234.trycloudflare.com/mcp
```

(or whatever the `alexa-ai` CLI's equivalent flag is for pointing it at an
arbitrary MCP endpoint, consult `alexa-ai --help` if the flag name has
changed since this was written). The CLI should be able to:

- Discover the server over Streamable HTTP at `/mcp` (MCP spec `2025-11-25`).
- If `AUTH_MODE=oauth`, discover `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server` automatically, walk the OAuth 2.1
  + PKCE authorization-code flow (it will hit `GET /oauth/authorize`, which
  renders a simple name + phone login form Front Desk serves itself), and
  come back with a bearer token.
- List the 9 tools (`find_businesses`, `get_business_details`,
  `find_availability`, `hold_appointment`, `confirm_appointment`,
  `list_my_appointments`, `reschedule_appointment`, `cancel_appointment`,
  `join_waitlist`) and call them.

A good first call to try once connected: `find_businesses` with no arguments
returns all three seeded demo businesses (Maple Street Barbers, Harbour
Physio and Massage, Paws and Suds Grooming).
