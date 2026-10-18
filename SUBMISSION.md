# Submission notes

## Devpost description

**Front Desk** is an Alexa+ MCP server that gives small local businesses,
barbershops, physio and massage clinics, pet groomers, real voice booking,
with no app for the customer and no app to build for the owner.

A customer just asks: *"Alexa, ask Front Desk to book a haircut for tomorrow
after work."* Front Desk finds the business, checks real availability against
staff schedules and buffer times, holds the slot, reads it back for
confirmation, and books it, spelling the confirmation code aloud so it's easy
to catch. It also handles rescheduling, cancellations with late-fee warnings,
and waitlists that automatically re-offer a slot the moment it frees up.

On the business side, an owner gets a dashboard that looks like a paper
appointment book: a per-staff timeline with a live "now" line, a waitlist
panel, and a live activity feed of every voice booking as it happens. Owners
onboard their whole catalog, services, prices, staff, hours, by typing a
plain-English description into a box and letting Amazon Bedrock (Nova Lite)
turn it into a structured, bookable business in one tool call.

Technically, it's a stateless Streamable HTTP MCP server (MCP spec
2025-11-25): every request gets a fresh `McpServer` and transport, so there's
no session state to manage, no memory leak to worry about, and nothing in the
hot path but synchronous JSON-file-backed logic, Alexa+'s 500ms budget is met
with room to spare (sub-10ms p50, measured live on the dashboard). Account
linking is a from-scratch OAuth 2.1 + PKCE implementation (Alexa+ doesn't
support dynamic client registration, so it's a pre-registered client with its
own `/oauth/authorize` login page), because getting the auth story right is
most of what makes a voice tool trustworthy enough to actually book something
on someone's behalf.

[YOU: add anything specific about why you personally wanted to build this, or
what you'd tell a judge in 30 seconds that isn't in the pitch above.]

## AWS Builder mini challenge (Amazon Bedrock) answer

Front Desk uses Amazon Bedrock's Converse API (`us.amazon.nova-lite-v1:0` by
default) for two owner-facing features, deliberately kept out of the
customer-facing voice path entirely (every MCP tool call must stay under
500ms with zero network calls, so an LLM call has no place there):

1. **Business onboarding** (`onboardBusiness` in `src/bedrock.ts`): an owner
   types a free-text description of their business, and Bedrock is forced
   (via `toolChoice: {tool: {name: "save_business"}}`, `temperature: 0`) to
   call a `save_business` tool whose JSON schema is generated directly from
   the same Zod schema (`z.toJSONSchema`) used to validate the result, so the
   contract can't drift between what we ask for and what we accept. The
   output is validated again with Zod regardless, with a fallback to parsing
   JSON out of a text response if the model doesn't use the tool, and
   converted into a real, immediately-bookable `Business` (slugged ids,
   staff-name-to-service-id mapping, a hard rejection if any service ends up
   with nobody who can perform it).
2. **Daily briefing** (`dailyBriefing`): a 90-word-or-less summary of today's
   bookings, revenue, and waitlist for the owner dashboard.

[YOU: Devpost's AWS Builder question wording changes year to year, paste the
exact prompt here and answer it directly if this summary doesn't already
cover it.]

## Product feedback and friction log

Built against the Alexa+ MCP Toolkit docs as of this hackathon. Friction
points worth flagging to the Alexa+ team:

- The 401-with-no-`WWW-Authenticate`-header requirement (SPEC.md calls this
  out explicitly because the MCP SDK's own bearer middleware adds the header
  by default) meant writing a custom auth middleware instead of using the
  SDK's. That's a reasonable security posture for Alexa+'s own client, but
  it's an easy trap for a developer who reaches for the SDK's built-in
  middleware first and only discovers the mismatch when their skill fails
  account linking.
- Requiring MCP spec **2025-11-25** specifically (not the newer stateless
  2026-07-28 revision) while the SDK's `LATEST_PROTOCOL_VERSION` constant
  tracks the newest spec meant double-checking the SDK's `SUPPORTED_PROTOCOL_VERSIONS`
  list rather than trusting the "latest" export, worth a callout in the
  Alexa+ docs for anyone pinning SDK versions.
- Alexa+ not supporting dynamic client registration is sensible for a curated
  addon catalog, but it does mean every local dev loop needs a pre-registered
  client id up front, there's no equivalent of "just hit the authorize
  endpoint and go" the way DCR allows.

[YOU: add anything you personally ran into while testing against the real
Alexa+ app/dashboard, especially anything the automated tests here couldn't
exercise, like actual device behavior, latency from a real network, or
Alexa+ console UX friction.]

## 2:45 demo video script

**0:00-0:15, hook.** Cold open on a phone ringing at a barbershop, nobody
picks up. Cut to: *"Alexa, ask Front Desk to book a haircut at Maple Street
Barbers for tomorrow after work."* Alexa+ responds immediately.

**0:15-0:55, the booking flow.** Screen recording of the conversation:
finding the business, hearing services and prices, Alexa+ reading back a
specific slot and price, the explicit "should I book it?", the confirmation
with the spelled-out code. Voiceover: "Front Desk is a real MCP server. Every
one of these calls is a tool call, under ten milliseconds, with the real
appointment book behind it, not a script."

**0:55-1:30, the dashboard.** Cut to the owner dashboard: the paper
appointment-book timeline, a teal block appearing live as the booking from
0:15 lands, the "now" line, the activity feed lighting up. Voiceover: "The
owner sees it land in real time, color-coded: teal for voice bookings, amber
for holds that haven't confirmed yet, violet for waitlist offers."

**1:30-2:00, cancellation and the waitlist.** A second, pre-recorded customer
says *"Alexa, cancel my appointment."* Cut to the dashboard: the slot clears,
and a violet waitlist-offer block appears instantly for a waiting customer.
Voiceover: "Front Desk doesn't just free the slot, it offers it to the next
person in line, automatically."

**2:00-2:30, Bedrock onboarding.** Cut to the dashboard's onboarding panel.
Type a two-sentence description of a fictional new business. Click "Build
catalog with Bedrock." A full services/staff/price table appears in seconds.
Click "Publish to Alexa+." Voiceover: "That's Amazon Bedrock turning plain
English into a bookable business, no spreadsheet, no form with forty fields."

**2:30-2:45, close.** Back to the Front Desk logo and the one-line pitch:
"Front Desk: voice booking for the businesses that never had an app budget."
End on the GitHub repo URL.

[YOU: swap in your actual device/voice footage, your actual repo URL, and
adjust timings once you've recorded a real take, scripted timing always
drifts a few seconds once a real voice and a real Echo are in the loop.]
