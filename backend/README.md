Implements GET /health, POST /audit/v1/reset, HMAC signing, Section 5.6 sport configuration, Section 5.7 fixture generation, Section 5.9 event sourcing, Section 5.12 checkout/inventory, and Section 5.13 security probes.

From the repository root run `DAY1_SALT=<your-salt> docker compose up -d --build`.
The API listens on 0.0.0.0:8080. Startup creates the tables and resets baseline data automatically.
Use `curl http://localhost:8080/health` and `curl -X POST http://localhost:8080/audit/v1/reset`.
Reset accepts optional integer seed and stock overrides for the two baseline variants; omitted variants keep their defaults. It uses a transaction and serializes concurrent resets.

Run tests after building with `sh run_tests.sh`. For local tests, run `npm ci` then `npm test` inside backend.
DAY1_SALT must be supplied through the environment; an absent or empty value fails startup.
PostgreSQL and Redis use named volumes. Each backend startup resets application data, as requested for this step.
The five seeded accounts are admin, organizer, manager, player, and viewer at @nascon.test, password Nascon@26 (bcrypt, cost 10). Login endpoints are not implemented.

POST /audit/v1/rbac-matrix returns HS256 JWTs valid for two hours and the exact seeded context. Tokens use a cryptographically random process-local key, so restarting the backend invalidates earlier tokens. Probe routes share the policy in src/policy.js. Authentication and authorization run before body parsing; existing foreign-tenant resources return 403 and unknown resource ids return 404.

GET /api/v1/ping is subject to 100 requests per rolling 10 seconds per socket IP. Redis evaluates the window atomically; rejected calls include Retry-After in seconds. Forwarded IP headers are not trusted. /health and /audit/v1/* are exempt. Reset clears Redis state, including limiter windows.

`sh run_tests.sh` runs the live tests against the running stack, including all 85 expected RBAC cells, additional ownership and authentication cases, bcrypt checks, and the 150-request limiter probe with an 11-second recovery check. Tests reset application data.

Section 5.12 store API:
- POST /audit/v1/checkout accepts order_id, customer_id, items [{variant_id, quantity}], optional discount_code, and payment {token}. Valid mock tokens: tok_success, tok_declined, tok_capture_fail.
- GET /audit/v1/inventory/:variant_id returns variant_id, stock, and reserved.
- WELCOME10 discounts the subtotal by 10%, rounded down in minor units.
- New purchases return 201; identical successful replays return 200 with the stored response; changed bodies return DUPLICATE_ORDER_ID. Unknown fields are ignored.
- Variants are locked in deterministic order in one PostgreSQL transaction. Authorization/capture failures roll the transaction back, releasing every reservation. Order ids are serialized independently so concurrent replays cannot create duplicate purchases.
- Receipts contain an HMAC signature using the startup DAY1_SALT and a PDFKit PDF encoded as base64. Prices in the PDF use PKR major units with two decimal places.
- Paid orders and their outbox records commit together. The server publishes order.status_changed events to the Redis stream order-status, using atomic deduplication and a background retry every second. Reset clears orders, outbox records, and Redis transient state.

Run from C:/Pixel-Peepers: DAY1_SALT=<your-salt> docker compose up -d --build, then sh run_tests.sh. The full suite includes 20 real worker threads synchronized at a barrier and sending HTTP requests to the running stack, concurrent idempotency, opposite basket lock order, all checkout error codes, rollback, independent HMAC and PDF.js text verification, and Redis delivery. Latest verified result: 270 passed, 0 failed, 0 skipped; last-unit burst: 951 ms with one 201 and nineteen OUT_OF_STOCK responses.
Sections 5.6 and 5.9:
- POST /audit/v1/sports validates and stores the supplied sport config and returns 201 with sport_id, status, and config. All seeded sports pass through this same validator. Scoring consumes config fields and never selects behavior by a sport id or scoring-event name.
- POST /audit/v1/events supports match_init, match_start, score, discipline, tiebreak_winner, match_end, and compensation. Payloads are signed in full, including extra payload keys. Successful event-id replays return the original response with HTTP 200; changed bodies return DUPLICATE_EVENT_ID.
- GET /audit/v1/score/:match_id reads metadata, config, and the full ordered log in one consistent PostgreSQL snapshot, then rebuilds scores, status, outcome, and correction annotations. No score counters are stored. A completed match stays completed after compensation; a level score without an active required tie-break winner becomes undecided.
- Match metadata is stored in matches.data as sport_id, home_team_id, away_team_id, and optional league_id. A fixture-created stream may start with no events and version zero. Event data stores the request and original response; dedicated match_id and sequence columns have a unique index. Appends serialize by event id and match id and lock the match row. Database triggers reject event UPDATE and DELETE; reset intentionally clears logs with TRUNCATE.
- The full test script includes 60 sport-config subtests and 17 scoring subtests, with arbitrary mystery configurations for every model, model limits and their compensation, all rejection codes, completed-match corrections, independent UTF-8 HMAC verification with the supplied test salt, concurrent appends/replays, and immutable-event enforcement. Latest full run: 270 passed, 0 failed, 0 skipped.
Section 5.7 fixtures:
- POST /audit/v1/fixtures takes format, teams, and optional params. It computes the response without reading or writing application state. No fixture-generation libraries or sport-specific logic are used.
- round_robin (2-40 teams): circle pairings with balanced cyclic home/away orientation, one or two legs, global round numbers, byes, withdrawals, and scheduled/forfeit/voided summary counts. The second leg reverses each pair.
- single_elim (2-128 teams): exact recursive seeding, immediate bye propagation, winner/loser routing, optional third_place_match, and params.results applied in graph order even if the supplied array is out of order. TP is included in the final round's matches array.
- swiss (2-64 teams): exact first-round pairing; later rounds honor rematch exclusions and bye priority, then minimize total score difference by exact memoized branch-and-bound. A custom Edmonds blossom feasibility algorithm and admissible score bounds prune the search. Scores and Buchholz are computed from supplied history; byes contribute score but no opponent. Impossible pairings return 409 NO_VALID_PAIRING with details.round.
- double_elim (3-128 teams): exact WR/LR sizes and ids, seeded WR1, one source per downstream slot, empty-slot propagation through the losers bracket, GF1 and optional conditional GF2. GF2.required is null before GF1 resolves, true when the losers champion wins GF1, and false otherwise. Its two participants are the GF1 participants; after GF1, routing places the GF1 winner at home and loser away. Results for a non-required GF2 are rejected.
- Property checks cover n=2..12 (the double-elim minimum of 3 is validated), independent exhaustive Swiss optimality, exact spec examples, no-pairing history, both reset outcomes, complete tournament playthroughs, graph routing, and all format size limits. Live API tests compare every PostgreSQL table and Redis keys before and after requests to prove absence of side effects. Latest full run_tests.sh: 270 passed, 0 failed, 0 skipped.