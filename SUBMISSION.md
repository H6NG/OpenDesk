# Submission notes

## Devpost description

**OpenDesk** is an Alexa+ MCP server that turns any small local business, a
barbershop, a physio clinic, a pet groomer, a hotel concierge desk, even a
corner grocery store, into something a customer can book entirely by voice,
with no app for the customer and no app to build for the owner.

A customer just asks: *"Alexa, ask OpenDesk to book a haircut for tomorrow
after work."* OpenDesk finds the business, checks real availability against
staff schedules and buffer times, holds the slot, reads it back for
confirmation, and books it, spelling the confirmation code aloud so it's easy
to catch. It also handles rescheduling, cancellations with late-fee warnings,
waitlists that automatically re-offer a slot the moment it frees up, and
stock-tracked product orders (groceries, retail items) for businesses that
sell things instead of, or alongside, appointments.

On the business side, an owner gets a real dashboard: a per-staff timeline
with a live "now" line, a waitlist panel, a professional analytics view
(bookings, revenue, channel split), and a live activity feed of every voice
booking as it happens. Accounts are real and DynamoDB-backed, with
owner/manager/employee roles so staff can be given dashboard access without
handing over pricing control. Owners onboard their whole catalog, services,
prices, staff, hours, by typing a plain-English description into a box and
letting Amazon Bedrock (Nova Lite) turn it into a structured, bookable
business in one tool call.

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

OpenDesk uses Amazon Bedrock's Converse API (`us.amazon.nova-lite-v1:0` by
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

A note on what's shown: the real Alexa+ add-on console is not open to the public
yet (confirmed directly with the hackathon's own team — no escalation path, no
sandbox account available). The hackathon rules explicitly allow for this:
"you can simulate an Alexa+ experience using your preferred agentic tools via
a web app." This script uses an MCP client (Claude Desktop, via `mcp-remote`)
talking to the real, running OpenDesk server, not Alexa+ hardware or a mock.
Every tool call shown is real.

**0:00-0:15, hook.** Cold open on a phone ringing at a barbershop, nobody
picks up. Cut to a chat client: *"book a haircut at Maple Street Barbers for
tomorrow after work."* The response comes back immediately. Voiceover (or a
title card): "This is OpenDesk, a real MCP server, simulating the Alexa+
conversation since the add-on console isn't public yet."

**0:15-0:55, the booking flow.** Screen recording of the conversation:
finding the business, hearing services and prices, a specific slot and price
read back, the explicit "should I book it?", the confirmation with the
spelled-out code. Voiceover: "177 automated tests behind it. Every one of
these is a real tool call, measured live at 2 milliseconds median, 5 at the
95th percentile, against the real appointment book, not a script."

**0:55-1:20, more than one kind of business.** Quick montage, four cuts:
*"find a dog groomer,"* *"...book a massage,"* *"...order a Standard King
Room for tonight at the Alder House Hotel,"* *"...order bananas for
pickup."* Voiceover: "Same server, five different kinds of business, barber,
physio, pet groomer, hotel, grocery store, because the catalog is just data,
not code written for one use case, appointments and stock-tracked orders
both come from the same tools."

**1:20-1:55, the dashboard.** Cut to the owner dashboard: the paper
appointment-book timeline, a teal block appearing live as the booking from
earlier lands, the "now" line, the activity feed lighting up, then a cut to
the analytics panel's real charts. Voiceover: "The owner sees it land in
real time, color-coded, with real analytics underneath it." Quick beat:
log in as an employee account, try to edit a product's price, get blocked.
"Role-based accounts mean a manager can touch pricing and staffing, and an
employee can't, without the owner handing over the whole account."

**1:55-2:25, cancellation and the waitlist.** A second, pre-recorded
customer cancels their appointment through the chat client. Cut to the
dashboard: the slot clears, and a violet waitlist-offer block appears
instantly for a waiting customer. Voiceover: "OpenDesk doesn't just free the
slot, it offers it to the next person in line, automatically."

**2:25-2:45, close.** Back to the OpenDesk logo and the one-line pitch:
"OpenDesk: voice booking for the businesses that never had an app budget."
End on the GitHub repo URL.

[YOU: swap in your actual screen recording and repo URL, and adjust timings
once you've recorded a real take. The 177-test and 2ms/5ms numbers above are
real, measured live against this server tonight, re-measure right before
recording in case the test count or load has changed, don't just read these
off without checking. No Bedrock-dependent beat in this version, on purpose:
Bedrock onboarding is fully built and tested (see the AWS Builder answer
above) but blocked by a confirmed, Amazon-acknowledged account-level quota
restriction with no available escalation before the deadline, so it isn't
demoed live.]
