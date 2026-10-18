# Progress

Project: "Front Desk" — Alexa+ MCP server for small business voice booking.
Working autonomously from SPEC.md. This file tracks phase completion.

## Phase plan

- [ ] Phase 0: Scaffolding — package.json, tsconfig, .gitignore, .env.example, dir layout
- [ ] Phase 1: Data model & store (src/types.ts, src/store.ts, seed data w/ deterministic PRNG)
- [ ] Phase 2: Spoken-time engine (src/spokenTime.ts) + test/spokenTime.test.ts
- [ ] Phase 3: Availability engine (src/availability.ts)
- [ ] Phase 4: MCP server core (src/server.ts, src/mcp/tools.ts) — stateless Streamable HTTP, AUTH_MODE=none, 9 tools
- [ ] Phase 5: OAuth account linking (src/oauth.ts) — PRM/AS metadata, authorize/token, login page
- [ ] Phase 6: Bedrock integration (src/bedrock.ts) + test/bedrock.test.ts
- [ ] Phase 7: Owner dashboard (public/dashboard.html, /api endpoints, SSE)
- [ ] Phase 8: e2e tests (test/e2e.test.ts) — none mode, oauth mode, part 2 oauth protocol
- [ ] Phase 9: Repo files — README.md, Dockerfile, addon-package/addon.json, extras/spoken-window, SUBMISSION.md
- [ ] Phase 10: Final verification — run server, full npm test output, FINAL_REPORT.md, DONE

## Log

(nothing yet)

## Known issues / ambiguities

(none yet)

## Next step

Start Phase 0.
