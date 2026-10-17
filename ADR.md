# Architecture Decision Records

Each record answers: "We chose X over Y because Z." Keep each one short (5-10 lines).
Every team member must be able to defend every record in the viva.

Status values: Proposed | Accepted | Superseded by ADR-NNN

---

## ADR-001: Node 20 and Express for the backend
- **Date:** 2026-10-17
- **Status:** Accepted
- **Context:** The backend needs an HTTP API, async database access, and a supported runtime in the container.
- **Decision:** We chose **Node.js 20 with Express**.
- **Alternatives considered:** Python with FastAPI; another JavaScript HTTP framework.
- **Why:** `backend/Dockerfile` pins Node 20, `package.json` selects ES modules, and `backend/src/app.js` uses Express middleware and routes.
- **Consequences:** JavaScript is used throughout the service; the image remains small, but the team owns request validation and middleware conventions.
- **Related requirements:** Sections 5.6, 5.9, 5.11, 5.12 and 5.14 API requirements.

---

## ADR-002: PostgreSQL as the source of truth
- **Date:** 2026-10-17
- **Status:** Accepted
- **Context:** Sports, leagues, events, inventory, users, rosters, orders, and outbox records need durable transactional storage.
- **Decision:** We chose **PostgreSQL 16 as the single source of truth**.
- **Alternatives considered:** MongoDB and using Redis as the primary database.
- **Why:** `docker-compose.yml` runs `postgres:16-alpine`, while `backend/src/database.js` defines relational tables, constraints, transactions, and reset state.
- **Consequences:** SQL transactions, foreign keys, row locks, and advisory locks are available; schema changes must be maintained explicitly.
- **Related requirements:** FR-1.1, FR-1.4, FR-2.3, NFR-3.

---

## ADR-003: Append-only scoring events with read-time projections
- **Date:** 2026-10-17
- **Status:** Accepted
- **Context:** Scores must support corrections while preserving the original event history and reproducing the same result after restart.
- **Decision:** We chose **an append-only event log and a projection rebuilt on read**.
- **Alternatives considered:** Mutable score rows and sport-specific score counters.
- **Why:** `backend/src/scoring.js` appends events, `projectScore` folds records into a score, and `backend/src/database.js` rejects event updates and deletes.
- **Consequences:** History is auditable and compensations are explicit; reads perform projection work and event validation must remain complete.
- **Related requirements:** FR-1.1 and FR-1.4.

---

## ADR-004: HMAC-SHA256 signatures from the environment
- **Date:** 2026-10-17
- **Status:** Accepted
- **Context:** Event and receipt payloads need deterministic integrity signatures without storing a signing secret in source control.
- **Decision:** We chose **HMAC-SHA256 using `DAY1_SALT` from the environment and canonical JSON**.
- **Alternatives considered:** A hard-coded key, ordinary hashes, or signing the original JSON key order.
- **Why:** `backend/src/signature.js` canonicalizes JSON and signs `id|canonical(payload)` with an environment-only UTF-8 secret; `server.js` creates the signer at startup.
- **Consequences:** Equivalent JSON objects produce stable signatures and secrets stay outside the image; startup fails when `DAY1_SALT` is absent.
- **Related requirements:** FR-1.1 and Section 5.3 signed payload requirements.

---

## ADR-005: Transactional row locking for checkout
- **Date:** 2026-10-17
- **Status:** Accepted
- **Context:** Concurrent buyers may request the final inventory unit, and failed payments must not consume stock.
- **Decision:** We chose **ordered row locks and conditional stock changes inside one PostgreSQL transaction**.
- **Alternatives considered:** Application-level locks, Redis-only reservations, or mutable updates without locking.
- **Why:** `backend/src/checkout.js` locks variants in deterministic order, reserves and decrements in one transaction, and rolls back on payment failure.
- **Consequences:** Exactly one concurrent buyer can reserve the last unit and deadlocks are reduced; checkout depends on PostgreSQL transaction availability.
- **Related requirements:** FR-2.3 and NFR-3.

---

## ADR-006: Redis for rate limits and order streams
- **Date:** 2026-10-17
- **Status:** Accepted
- **Context:** API requests need an atomic rolling limit, and paid orders need reliable asynchronous status delivery.
- **Decision:** We chose **Redis for rate limiting and Redis Streams for order events, backed by a PostgreSQL outbox**.
- **Alternatives considered:** RabbitMQ and an in-process limiter or event queue.
- **Why:** `backend/src/rate-limit.js` uses an atomic Lua sliding window, while `backend/src/order-events.js` publishes an outbox to a Redis stream with duplicate suppression.
- **Consequences:** The service gains fast shared coordination and retryable delivery; Redis is an operational dependency and delivery is eventually consistent.
- **Related requirements:** FR-2.3 and the rate-limit requirements in `backend/src/app.js`.

---

## ADR-007: One policy matrix for RBAC and tenant isolation
- **Date:** 2026-10-17
- **Status:** Accepted
- **Context:** Five roles need consistent authorization across leagues, clubs, players, products, scoring, and roster operations.
- **Decision:** We chose **one role/action/scope policy matrix with shared target checks**.
- **Alternatives considered:** Independent authorization checks in every route and role-specific middleware modules.
- **Why:** `backend/src/policy.js` defines the five roles and scopes, while `app.js` and `mobile-api.js` call `permits` and `findTarget` for tenant-aware decisions.
- **Consequences:** Policy changes have one central implementation and empty permissions deny by default; routes must provide the correct target context.
- **Related requirements:** Section 5.13 RBAC and tenant-isolation requirements.

---

## ADR-008: Custom fixture generation algorithms
- **Date:** 2026-10-17
- **Status:** Accepted
- **Context:** Fixture generation must support multiple formats, exact pairing constraints, seeded brackets, and deterministic output.
- **Decision:** We chose **custom algorithms, including backtracking Swiss matching**.
- **Alternatives considered:** Third-party tournament libraries and approximate greedy pairing.
- **Why:** `backend/src/fixtures.js` dispatches formats, `swiss.js` calls `matching.js`, and `matching.js` combines blossom feasibility with branch-and-bound minimum pairing.
- **Consequences:** The implementation directly controls limits, tie-breaking, byes, and rematches; algorithm complexity must be managed within the documented team limits.
- **Related requirements:** FR-1.3.

---

<!--
Typical decisions worth recording (pick what the problem actually needs):
backend framework, database, cache/queue/broker, file storage (MinIO replacement),
real-time transport, auth approach, mobile framework, test strategy, load-test tool,
container layout / ports, how the app reaches the backend from a physical phone.
-->
