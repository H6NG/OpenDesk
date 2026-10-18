# Progress

Project: "Front Desk" — Alexa+ MCP server for small business voice booking.
Working autonomously from SPEC.md. This file tracks phase completion.

## Phase plan

- [ ] Phase 0: Scaffolding — package.json, tsconfig, .gitignore, .env.example, dir layout
- [ ] Phase 1: Data model & store (src/types.ts, src/store.ts, seed data w/ deterministic PRNG)
- [x] Phase 2: Spoken-time engine (src/spokenTime.ts) + test/spokenTime.test.ts
- [ ] Phase 3: Availability engine (src/availability.ts)
- [ ] Phase 4: MCP server core (src/server.ts, src/mcp/tools.ts) — stateless Streamable HTTP, AUTH_MODE=none, 9 tools
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

## Known issues / ambiguities

- Harbour Physio and Massage hours not given in SPEC beyond "Wednesday has a lunch break" + 24h notice. Assumed Mon-Fri 9:00-17:00, Wed split 9-12/13-17, closed weekends.
- Paws and Suds Grooming hours only "open Mon-Sat" with no times given. Assumed 9:00-17:00 Mon-Sat. Buffer/lead/cancel-notice for both Harbour and Paws not specified; used bufferMin 10, leadTimeMin 60, cancelNoticeHours 24 for both.
- Massage service names ("60 min $120, 30 min $70") given without explicit names; named them "60-Minute Massage" / "30-Minute Massage".

## Next step

Phase 3: availability engine (src/availability.ts).
