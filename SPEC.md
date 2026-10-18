Build "Front Desk": an Alexa+ MCP server that gives small local businesses (barbers, clinics, pet groomers) voice booking. This is for the Alexa+ track of the Amazon Developer Hackathon (deadline Oct 23, 2026), plus the AWS Builder mini challenge (Amazon Bedrock). Work in phases, run the tests after each phase, and don't stop until every test passes.

## Hard requirements (from the Alexa+ MCP Toolkit docs)
- MCP spec 2025-11-25 exactly (Alexa+ supports 2025-11-25; do NOT target the newer stateless 2026-07-28 revision). Transport: Streamable HTTP. Use the official @modelcontextprotocol/sdk (TypeScript, v1.32.x, which reports LATEST_PROTOCOL_VERSION 2025-11-25).
- Stateless Streamable HTTP at POST /mcp: create a new McpServer + StreamableHTTPServerTransport per request with sessionIdGenerator: undefined and enableJsonResponse: true. GET or DELETE /mcp → 405 with Allow: POST.
- Every MCP round trip must be under 500 ms. No network or LLM calls inside tool handlers. Target under 10 ms p50.
- Alexa+ account linking (AUTH_MODE=oauth):
  - Unauthenticated /mcp requests → 401 with NO WWW-Authenticate header (the SDK's bearer middleware adds one, so write custom middleware).
  - RFC 9728 Protected Resource Metadata at /.well-known/oauth-protected-resource (also at /.well-known/oauth-protected-resource/mcp): resource = PUBLIC_URL/mcp, authorization_servers = [PUBLIC_URL], scopes_supported = ["appointments"], bearer_methods_supported = ["header"].
  - RFC 8414 metadata at /.well-known/oauth-authorization-server, with code_challenge_methods_supported including "S256".
  - OAuth 2.1 authorization code flow with PKCE, S256 only. Validate the `resource` parameter on both the authorize and token requests. Scopes must come from scopes_supported.
  - Pre-registered client only (Alexa+ doesn't support DCR or CIMD): OAUTH_CLIENT_ID, optional OAUTH_CLIENT_SECRET (client_secret_post or basic), OAUTH_REDIRECT_URIS allow-list, and OAUTH_ALLOW_ANY_REDIRECT for dev only.
  - Bearer token accepted in the Authorization header only, never the query string. Store tokens as sha256 hashes. Codes are single-use with a 10-minute TTL. Access tokens last 1 hour; refresh tokens last 90 days and rotate on use.
  - Login page at GET/POST /oauth/authorize: a simple name + phone form that upserts a customer by phone.
- AUTH_MODE=none (the default) acts as a demo customer, "Alex Rivera", for local testing.

## Stack
Node 20+, TypeScript (ESM, NodeNext), express 5, zod 4, luxon, chrono-node, @aws-sdk/client-bedrock-runtime, tsx. Persist data to a JSON file (DATA_FILE, default data/store.json, with debounced atomic writes); ":memory:" means in-memory only. Config comes from env vars: PORT, PUBLIC_URL, AUTH_MODE, OAUTH_*, DATA_FILE, DASHBOARD_TOKEN, AWS_REGION, BEDROCK_MODEL_ID (default us.amazon.nova-lite-v1:0), and FRONTDESK_NOW (freezes the clock for demos and tests; every time-dependent function must use a now() helper).

## Data model
- Business: id, name, category, keywords[], address, city, phone, timezone (IANA), hours per weekday as [["HH:MM","HH:MM"]] (split shifts allowed), services, staff, bufferMin, slotStepMin (15), leadTimeMin, cancelNoticeHours, policyNote.
- Service: {id, name, durationMin, priceCents}. Staff: {id, name, title, serviceIds}.
- Appointment: id, code (4 characters from an alphabet without 0/O/1/I/L), businessId, serviceId, staffId, customerId, customerName, start, end, status (held | confirmed | cancelled | expired), holdExpiresAt, holdKind (customer | waitlist_offer), source (alexa | phone | walk-in), notes.
- Waitlist entries, an activity event log (last 300 events), OAuth codes and tokens.

Seed three fictional businesses in America/Los_Angeles:
- Maple Street Barbers: staff Sam and Priya. Men's Cut 30 min $35, Beard Trim 15 min $20, Cut and Beard 45 min $50, Kids' Cut 20 min $25. Open Tue–Wed 10–19, Thu–Fri 10–20, Sat 9–17. Buffer 5 min, lead 30 min, 2-hour cancellation notice.
- Harbour Physio and Massage: Dr. Lena Okafor (physio assessment 45 min $110, follow-up 30 min $85) and Marco (massage 60 min $120, 30 min $70). Wednesday has a lunch break. 24-hour notice.
- Paws and Suds Grooming: Jess. Small dog groom 90 min $85, large dog 120 min $120, bath 45 min $45, nail trim 15 min $18. Open Mon–Sat.

Pre-fill the next 14 days with deterministic fake bookings (seeded PRNG). Make the booking probability inversely proportional to service duration so long-service shops aren't fully booked.

## Spoken-time engine (src/spokenTime.ts)
parseSpokenWindow(phrase, nowInBusinessZone, horizonDays=14) → {fromDay, toDay, band?: [minFrom, minTo), exact?: DateTime, label}.
- Dayparts: early morning/before work 7:00–9:30; morning 8–12; lunch/lunchtime/midday 11:30–13:30; afternoon 12–17; late afternoon/end of day 15–18; after school 15–18; after work/evening/tonight 17–21.
- "after X", "before X", "between X and Y". Replace "noon" with 12pm first. A bare hour from 1 to 7 means PM.
- "this weekend", "next weekend", "next week" (Mon–Sun), "this week". "asap", "whenever" and an empty phrase mean today through the horizon.
- Use chrono-node (forwardDate, with a reference instant and timezone offset) for days and clock times. An exact time searches −60/+90 minutes around it; if the time has already passed today, roll to tomorrow. Never start in the past.
- Also provide speakDateTime → "tomorrow at 9:00 AM" / "Thursday at 5:30 PM" / "Monday, November 2 at 10:00 AM".

## Availability engine (hot path, must be fast)
Build a per-request busy index per staff member as epoch-ms intervals (buffer included; expired holds ignored), then generate candidates with epoch arithmetic (dayStartMs + minutes). Use Luxon only once per day, and on DST days. Rules:
- Respect lead time, the time band and the staff's services.
- For an exact time, sort by distance from the requested time.
- For multi-day searches, return at most 2 slots per day and skip slots less than 30 minutes after the previous pick.
- Default to 3 results.
- Warm up the hot path at boot (5 rounds over all businesses and services) so the first Alexa+ call is fast.

## MCP tools
Server instructions must describe the flow: find_businesses → get_business_details → find_availability → hold_appointment → read back and get an explicit yes → confirm_appointment. Never confirm without a yes.

Every tool has a title, an LLM-oriented description, a zod inputSchema, an outputSchema, and annotations. Every tool returns structuredContent that includes a voice-ready `speech` sentence, and text content equal to that speech. Errors return isError: true with a recoverable message such as "Use find_businesses to look it up".

1. find_businesses {query?, category?}: readOnly. Keyword scoring.
2. get_business_details {business_id}: readOnly. Services, staff, hours text, policy.
3. find_availability {business_id, service_id, when?, date?, staff?, limit 1–8}: readOnly.
   - Speech groups slots by day and staff, e.g. "Thursday at 6:15 or 6:30 PM with Priya, or 7:15 PM with Sam".
   - If there are no slots, search the following 7 days (same band first, then any time) and return `alternatives`.
   - Say "is closed today" when the shop is closed for the whole window (can_join_waitlist: false). Otherwise say "fully booked" and offer the waitlist.
4. hold_appointment {business_id, service_id, start ISO, staff?, notes?}: creates a 5-minute hold. A taken slot is an error. Speech: "I'm holding X with Y, Thursday at 6:45 PM, for $35. Should I book it?"
5. confirm_appointment {hold_id}: idempotent. Speech spells the code with spaces: "C N Q E".
6. list_my_appointments: readOnly. Includes waitlist offers ("Good news: a spot opened up...").
7. reschedule_appointment {appointment_id or code, new_start, staff?}: atomic. The freed slot is offered to the waitlist.
8. cancel_appointment {appointment_id or code}: destructive, idempotent. Warns about a late cancellation fee inside the notice window. Auto-offers the freed slot to the first matching waitlist entry by creating a waitlist_offer hold for that customer (2-hour expiry).
9. join_waitlist {business_id, service_id, when?}: idempotent.

Customers can only see and act on their own appointments. Log activity events for each action (held, booked, rescheduled, cancelled, waitlist, waitlist_offer, onboarded, account_linked).

## Amazon Bedrock (src/bedrock.ts), owner side only, never inside tools
- onboardBusiness(description): ConverseCommand with a system prompt and a `save_business` tool whose JSON schema comes from z.toJSONSchema(OnboardingSchema, {io:'input'}) with the $schema key deleted. Force it with toolChoice {tool:{name:'save_business'}} and temperature 0.
  - Validate the output with zod. Fall back to parsing a JSON object from text.
  - Convert to a Business: slug ids, cents, staff_names → staff serviceIds (every service must be bookable by someone), createdVia 'bedrock-onboarding'.
  - Reject invalid output with a clear error.
- dailyBriefing(store, businessId): a briefing of at most 90 words, built from today's bookings, revenue, waitlist and recent events.
- Export setBedrockClient() so tests can inject a stub.

## Owner dashboard (public/dashboard.html, served at / and /dashboard) and API under /api
- API endpoints: GET /businesses, GET /state?business=&days=7, GET /events (SSE), POST /onboard {description}, POST /businesses {business}, GET /briefing, POST /demo/reset. Optionally protected by DASHBOARD_TOKEN (?token= or x-dashboard-token).
- GET /health returns protocol, transport, auth mode and latency stats (p50/p95/max over the last 500 MCP requests, recorded per request).
- Design: a paper appointment book. Cool mint-gray paper (#eef2f0), navy ink (#1b2a41), teal for voice bookings (#0e7c86), amber dashed for holds, violet dashed for waitlist offers. Fonts: Bricolage Grotesque for headings, Atkinson Hyperlegible for body. Include a dark mode.
- Layout: day tabs showing "N by voice" counts, a per-staff timeline with 15-minute ruling, hatched closed hours, a red "now" line, and single-line rendering for short blocks. Side column with a Bedrock daily briefing button, the waitlist, and a live activity feed over SSE. Below that, a "Put your business on Alexa+" section: textarea, then "Build catalog with Bedrock", then a preview table, then "Publish to Alexa+".
- Show the MCP endpoint with a copy button and an "Alexa+ link live: N calls, p95 X ms (limit 500 ms)" status. No middle-dot separators and no all-caps labels. Responsive at phone width with no horizontal page scroll.

## Tests (npm test must run all three)
1. test/spokenTime.test.ts with now = Sunday 2026-10-18 09:00 America/Los_Angeles. Expected results:
   - "thursday after work" → 10-22, band [1020,1260]
   - "tomorrow morning" → 10-19, [480,720]
   - "this weekend" → 10-18 only
   - "next weekend" → 10-24..10-25
   - "next week" → 10-19..10-25
   - "after 3 on friday" → 10-23, [900,1440]
   - "before noon tomorrow" → [0,720]
   - "between 2 and 4 on wednesday" → [840,960]
   - "thursday at 5:30pm" → exact Thu 17:30
   - "lunchtime on tuesday" → [690,810]
   - "october 30"
   - "8am" → rolls to 10-19
2. test/bedrock.test.ts with a stubbed client:
   - The request forces save_business, the $schema key is stripped, and temperature is 0.
   - Conversion is correct (an acrylic set only bookable with Tran).
   - The new business is immediately bookable.
   - Invalid output is rejected.
3. test/e2e.test.ts: spawn the real server as a child process (FRONTDESK_NOW=2026-10-18T09:00:00-07:00) and drive it with the SDK Client + StreamableHTTPClientTransport.
   - Assert every callTool takes under 500 ms.
   - Part 1 (none mode): full flow, double-booking prevention, idempotent confirm, reschedule by code, closed-day alternatives, waitlist, recoverable errors, health protocol 2025-11-25, dashboard state, GET /mcp → 405.
   - Part 1b (oauth): two linked customers. A books, B joins the waitlist, A cancels, B sees a waitlist_offer and confirms it, and A can't cancel B's booking.
   - Part 2 (oauth): 401 with no WWW-Authenticate; PRM and AS metadata correct; wrong resource, plain PKCE and an unregistered redirect are each rejected; a wrong verifier gives invalid_grant; the happy path issues tokens; a query-string token gives 401; an authenticated booking is attributed to the linked customer; refresh rotation rejects the old refresh token.

## Repo files
- README.md: pitch, architecture mermaid diagram, tools table, the voice-design choices, run locally, connect to Alexa+, App Runner deploy, config table.
- MIT LICENSE, .gitignore, .env.example, and a multi-stage Dockerfile (node:22-slim, runs dist/server.js as the node user).
- addon-package/addon.json in the Alexa+ schema (shortDescription ≤123 characters, 3–4 example phrases, REPLACE-ME URLs for icons, carousel, privacy and terms, integrations[0].type "MCP" with an HTTPS endpoint).
- extras/spoken-window/: the spoken-time engine as a standalone MIT npm package with its own README and tests, for the Open Source mini challenge.
- SUBMISSION.md: Devpost description, AWS Builder answer, product feedback and friction log with [YOU] placeholders for anything I must write from my own experience, and a 2:45 demo-video script.

When done, start the server, show me the npm test output, and tell me exactly how to expose it with cloudflared and connect it with the alexa-ai CLI.
