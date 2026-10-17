Implements GET /health, POST /audit/v1/reset, the signature helper, and Section 5.13 security probes.

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
