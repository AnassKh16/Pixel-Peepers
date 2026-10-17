# Traceability Matrix

Links every requirement to the code that implements it and the test that proves it.
One row per requirement. If a requirement has no test yet, write `TODO` so the gap is visible.

Status values: Not started | In progress | Done | Tested (passing)

## Part I (Day 1)

| Req ID | Requirement (short, from problem statement) | Code file(s) | Test file :: test name | Test type | Status |
|---|---|---|---|---|---|
| FR-1.1 | Sections 5.6 and 5.9: validated JSON-configured sports; immediate mystery-sport use; all three scoring models; signed append-only events and compensations; full score projection rebuilt on every read. No branches on sport ids or scoring event names. | backend/src/sports.js; backend/src/scoring.js; backend/src/validation.js; backend/src/signature.js; backend/src/database.js; backend/src/baseline.js; backend/src/app.js | backend/test/sports.test.js :: Section 5.6 sport configuration API (60 subtests); backend/test/scoring.test.js :: Section 5.9 mystery-sport event sourcing API (17 subtests: all models/errors, completed-match compensation, replay, independent signatures, concurrent sequences, database immutability). Full run_tests.sh: 190 passed, 0 failed, 0 skipped. | API / integration / concurrency | Tested (passing) |
| FR-1.3 | Section 5.7 pure fixture generation implemented: balanced single/double round robin with withdrawals; seeded single elimination and third place; exact minimum-difference Swiss with Buchholz and bye priority; double elimination with conditional reset. Broader venue/player conflicts, manual rescheduling, and status broadcasts: TODO. | backend/src/fixtures.js; backend/src/brackets.js; backend/src/swiss.js; backend/src/matching.js; backend/src/double-elimination.js; backend/src/app.js | backend/test/fixtures-ab.test.js (37 tests); backend/test/fixtures-swiss.test.js (15 tests, independent exhaustive oracle, NO_VALID_PAIRING); backend/test/fixtures-double.test.js (22 tests, routing graph and complete playthroughs); backend/test/fixtures-api.test.js (live limits/errors and PostgreSQL/Redis state preservation). n=2..12 properties; double-elim n=2 correctly rejected; upper limits checked. Full run_tests.sh: 270 passed, 0 failed, 0 skipped. | Unit / property / API / integration | In progress |
| FR-2.3 | Section 5.12 merchandise checkout/inventory, mock payments, discounts, signed PDF receipts, and order-status events are implemented and tested. Remaining catalogue, fulfilment, and pinned showcase features: TODO. | backend/src/checkout.js; backend/src/receipt.js; backend/src/order-events.js; backend/src/app.js; backend/src/database.js | backend/test/checkout.test.js :: Section 5.12 checkout and inventory against running stack (13 subtests: every checkout error code, rollback, replay, signatures, independent PDF text, Redis outbox delivery) | API / integration | In progress |
| P1-R01 | | | | API / UI-web / UI-mobile / Load | |
| P1-R02 | | | | | |
| P1-R03 | | | | | |
| P1-R04 | | | | | |
| P1-R05 | | | | | |
| P1-R06 | | | | | |
| P1-R07 | | | | | |
| P1-R08 | | | | | |

## Part II (Day 2)

| Req ID | Requirement (short, from problem statement) | Code file(s) | Test file :: test name | Test type | Status |
|---|---|---|---|---|---|
| P2-R01 | | | | | |
| P2-R02 | | | | | |
| P2-R03 | | | | | |
| P2-R04 | | | | | |
| P2-R05 | | | | | |
| P2-R06 | | | | | |

## Non-functional requirements

| Req ID | Requirement (performance, reliability, etc.) | Code / config file(s) | Test / evidence | Status |
|---|---|---|---|---|
| NFR-3 | Atomic inventory reservations prevent overselling and release stock after failed payments. | backend/src/checkout.js (one reservation transaction, ordered FOR UPDATE row locks, order-id serialization); backend/src/database.js (nonnegative constraints) | backend/test/checkout.test.js :: 20-thread last-unit burst: exactly one 201, nineteen 409, stock 0, reserved 0; 20-thread identical-order replay; opposite basket order; payment rollback. Observed last-unit burst: 529 ms. Full run_tests.sh: 111 passed, 0 failed, 0 skipped. | Tested (passing) |
| NFR-01 | | | | |
| NFR-02 | | | | |

## Related ADRs

| Req ID | ADR |
|---|---|
| | |
