# Progress

Project: "Front Desk" — Alexa+ MCP server for small business voice booking.
Working autonomously from SPEC.md. This file tracks phase completion.

## Phase plan

- [x] Phase 0: Scaffolding — package.json, tsconfig, .gitignore, .env.example, dir layout
- [x] Phase 1: Data model & store (src/types.ts, src/store.ts, seed data w/ deterministic PRNG)
- [x] Phase 2: Spoken-time engine (src/spokenTime.ts) + test/spokenTime.test.ts
- [x] Phase 3: Availability engine (src/availability.ts)
- [x] Phase 4: MCP server core (src/server.ts, src/mcp/tools.ts) — stateless Streamable HTTP, AUTH_MODE=none, 9 tools
- [ ] Phase 5: OAuth account linking (src/oauth.ts) — PRM/AS metadata, authorize/token, login page
- [ ] Phase 6: Bedrock integration (src/bedrock.ts) + test/bedrock.test.ts
- [ ] Phase 7: Owner dashboard (public/dashboard.html, /api endpoints, SSE)
- [ ] Phase 8: e2e tests (test/e2e.test.ts) — none mode, oauth mode, part 2 oauth protocol
- [ ] Phase 9: Repo files — README.md, Dockerfile, addon-package/addon.json, extras/spoken-window, SUBMISSION.md
- [ ] Phase 10: Final verification — run server, full npm test output, FINAL_REPORT.md, DONE

## Log

- Phase 0: scaffolding, deps installed (express 5.3, zod 4.6, @modelcontextprotocol/sdk 1.32.1, chrono-node 2.10.3). Test runner: node:test via `tsx --test`.
- Phase 1: types.ts, store.ts (debounced atomic JSON writes, ":memory:" support), seed.ts (3 businesses, deterministic mulberry32 PRNG, 570 fake appointments over 14 days).
- Phase 2: spokenTime.ts. All 15 spokenTime/speakDateTime tests pass. Key trick: chrono-node leaves `day` uncertain when it only rolls a bare time forward (e.g. "8am" -> tomorrow), so dayIsCertain also checks `isCertain("hour")`.
- Phase 3: availability.ts (per-request busy index, epoch-ms candidate generation, exact-time distance sort, multi-day 2-per-day/30-min-spacing cap, lead time, warmUp). Found and fixed a seed-data bug: original booking probability (`min(0.85, 40/duration)`) packed nearly every day solid with no gaps; recalibrated to `min(0.5, 8/duration)` for ~35-50% occupancy. 7 new tests in test/availability.test.ts, all pass (22/22 total).

- Phase 4: src/config.ts, src/latency.ts, src/businesses.ts (keyword scoring + hours formatting), src/booking.ts (hold/confirm/cancel/reschedule/waitlist, double-booking prevention, waitlist auto-offer on freed slots), src/mcp/speech.ts, src/mcp/tools.ts (all 9 tools), src/server.ts (stateless POST /mcp — new McpServer+transport per request, sessionIdGenerator undefined, enableJsonResponse true; GET/DELETE /mcp -> 405 Allow POST; GET /health with latency p50/p95/max). AUTH_MODE=oauth not yet wired (demo customer always used for now; Phase 5 will attach req.customerId upstream of the /mcp handler).
  - Found and fixed a real timezone bug via manual smoke testing: `DateTime.fromISO(isoStringWithOffset)` without `{setZone: true}` silently reinterprets the instant in the *system* local zone, not the offset embedded in the string. This made spoken times wrong by the system/business zone difference (e.g. "8:45 PM" spoken for an actual 5:45 PM PDT slot, since the dev machine is US Eastern). Fixed every such call site in src/mcp/speech.ts, src/mcp/tools.ts, src/clock.ts, and test/availability.test.ts. Internal bookkeeping timestamps (createdAt/updatedAt/holdExpiresAt) now go through a new `isoUtc()` helper in clock.ts instead of defaulting to system zone.
  - Manually smoke-tested with a live server + MCP SDK client: full find->hold->confirm flow, double-booking prevention, idempotent confirm, reschedule by code, idempotent cancel, closed-day messaging, and latency (max 4ms over 10 calls, well under the 500ms/10ms targets).

## Known issues / ambiguities

- Harbour Physio and Massage hours not given in SPEC beyond "Wednesday has a lunch break" + 24h notice. Assumed Mon-Fri 9:00-17:00, Wed split 9-12/13-17, closed weekends.
- Paws and Suds Grooming hours only "open Mon-Sat" with no times given. Assumed 9:00-17:00 Mon-Sat. Buffer/lead/cancel-notice for both Harbour and Paws not specified; used bufferMin 10, leadTimeMin 60, cancelNoticeHours 24 for both.
- Massage service names ("60 min $120, 30 min $70") given without explicit names; named them "60-Minute Massage" / "30-Minute Massage".

## Next step

Phase 5: OAuth account linking (src/oauth.ts — PRM/AS metadata, authorize/token endpoints, login page, bearer middleware wired into POST /mcp).
