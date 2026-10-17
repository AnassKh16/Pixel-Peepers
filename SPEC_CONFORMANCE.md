# Section 5 conformance sweep

Scope: the 23 method/path endpoints in Sections 5.4–5.14, including all four fixture formats, all three scoring models, all seven RBAC probes and every target/role matrix cell. Requests were sent with curl to http://localhost:8080. DAY1_SALT was confirmed present in the running backend without printing its value.

Final live result: 173 checks; 0 remaining mismatches. Machine-readable evidence: SPEC_CONFORMANCE.json. Initial confirmed failures: SPEC_CONFORMANCE.before.json (four failing probes, two input classes).

Object comparisons require every specified field and reject extra fields. Values, JSON types, nesting, explicit nulls, response statuses and error codes are compared. Generated ids, timestamps, JWTs and signatures use their specified formats; signatures are independently recomputed using the running environment salt. Fixture outputs allow the schedule choices explicitly permitted by 5.7. Examples with ellipses are checked against the complete mandatory object fields, not the literal ellipsis.

## Confirmed mismatches and surgical fixes

| Live failing input | Before | After | Regression test |
|---|---|---|---|
| POST /audit/v1/events with a signed payload containing 1e999, decoded as a non-finite number | 500 INTERNAL_ERROR | 400 VALIDATION_ERROR; details.fields includes payload; schema validation precedes missing references | conformance-fixes.test.js: non-finite signed payload |
| POST /audit/v1/events with a payload nested 6,000 arrays deep | 500 INTERNAL_ERROR from recursive canonicalization | 400 VALIDATION_ERROR; no event appended | conformance-fixes.test.js: deeply nested signed payload |
| POST /audit/v1/offline-sync containing the same non-finite event payload | 500 and the wrong top-level error envelope | 200; per-action rejected/server_wins/VALIDATION_ERROR; summary.rejected=1; replay duplicate | Same non-finite test exercises both HTTP paths |
| POST /audit/v1/offline-sync containing the same deeply nested event payload | 500 and the wrong top-level error envelope | 200; per-action rejected/server_wins/VALIDATION_ERROR; rejected action is safely persisted; replay duplicate | Same nested-payload test exercises both HTTP paths |

Only two production files changed:

- backend/src/scoring.js validates canonical representability in the existing event schema validator, before database lookup. It handles TypeError/RangeError as input validation errors.
- backend/src/offline-sync.js retains safe resource references for malformed rejected actions, avoiding a second serialization failure while preserving processed-action deduplication and current-version reporting.

No response fields or rules that matched the spec were refactored. The signature helper, fixture generators, standings, checkout, roster rules, policy matrix and authentication code were left unchanged.

## Endpoint-by-endpoint result

| Section | Endpoint / response family | Result checked against the spec |
|---|---|---|
| 5.4 | GET /health | 200; exactly status=ok |
| 5.5 | POST /audit/v1/reset | 200; status, seed, exact sport/tenant id arrays and stock map; two resets yield identical all-table snapshots and audit sequence state |
| 5.6 | POST /audit/v1/sports | 201 sport_id/status/config; complete nested config, ordered tie breakers; 400 validation precedes 409 duplicate |
| 5.7 A | POST /audit/v1/fixtures, round_robin | format/legs/team_count/round_count/rounds/summary; match ids, leg, home, away, status, awarded_to null/string; byes arrays |
| 5.7 B | POST /audit/v1/fixtures, swiss | format/round/total_rounds/pairings/bye/standings; rank, team_id, numeric score and Buchholz |
| 5.7 C | POST /audit/v1/fixtures, single_elim | format/bracket_size/rounds; every mandatory MATCH field, seeded participants, null unknown slots, routing, propagated results |
| 5.7 D | POST /audit/v1/fixtures, double_elim | format/bracket_size/bracket_reset/winners/losers/grand_final; complete MATCH fields plus conditional and nullable required |
| 5.8 | POST /audit/v1/leagues | 201; exactly league_id/status/team_count/fixture_count; fixtures become upcoming streams |
| 5.9 | POST /audit/v1/events | All event types; 201 new/200 replay; exactly event_id/match_id/type/sequence/match_version/signature; independent HMAC checks |
| 5.9 | GET /audit/v1/score/{match_id} | Complete example body, per-team score/wickets/balls/overs/fair_play, explicit model-specific nulls, event compensation fields; completed compensation produces undecided when required |
| 5.10 | GET /audit/v1/standings/{league_id} | league_id/sport_id/qualification_spots/table/h2h; complete row fields and full ordered-pair H2H cells |
| 5.11 | POST /audit/v1/roster/setup | 201; exactly league_id/status/squad_counts |
| 5.11 | POST /audit/v1/roster/transfer | 201/200 replay; request_id/status/state/blocking_match_id/registration/audit_entry; active and deferred cases, nullable parent/end date, loan registration |
| 5.11 | GET /audit/v1/roster/history/{player_id} | player_id/as_of/league_id/current_squad_id/parent_squad_id/history; exact audit entry fields; one system loan_return on repeated reads |
| 5.12 | POST /audit/v1/checkout | 201/200 replay; complete items/totals/payment/receipt fields, matching signed payload; decoded PDF contains order id and PKR 4500.00 |
| 5.12 | GET /audit/v1/inventory/{variant_id} | variant_id/stock/reserved; numeric zero stock and zero reservations after success |
| 5.13 | POST /audit/v1/rbac-matrix | Exactly five role-token keys and the full seeded-id context; HS256 tokens last at least one hour |
| 5.13 P1 | POST /audit/v1/rbac/tenants | All five role cells; allowed 200 authorized=true, denied 403 FORBIDDEN |
| 5.13 P2 | POST /audit/v1/rbac/leagues/{id}/fixtures | All roles against own, other and foreign league |
| 5.13 P3 | POST /audit/v1/rbac/clubs/{id}/roster | All roles against own, other and foreign club |
| 5.13 P4 | POST /audit/v1/rbac/clubs/{id}/products | All roles against own, other and foreign club |
| 5.13 P5 | PATCH /audit/v1/rbac/players/{id} | All roles against own, other and foreign player |
| 5.13 P6 | GET /audit/v1/rbac/clubs/{id} | All roles against own, other and foreign club; foreign denied as 403 |
| 5.13 P7 | GET /audit/v1/rbac/platform/config | Every role; alg:none is 401 UNAUTHENTICATED |
| 5.13 | GET /api/v1/ping | Exactly pong=true; 150 requests within five seconds trigger at least 40 RATE_LIMITED responses and Retry-After; recovery after 11 seconds |
| 5.14 | POST /audit/v1/offline-sync | device_id/results/summary; action_id/status/resolution/error_code/processed_order/server_version/signature, explicit nulls, request-order results, duplicate full replay |

## Appendix C and error-order checks

- All public tables and roster_audit_seq match after two consecutive resets. Transient test data is removed; the deterministic demo baseline requested for the app is restored.
- The independent runtime-salt HMAC verification covers live event signatures and the exact live receipt payload. Appendix A's known vector is also part of run_tests.sh.
- Every audit POST, including authorized RBAC POSTs (and the RBAC PATCH), rejects a body larger than 1 MB with 413 PAYLOAD_TOO_LARGE. Failed probe authentication keeps its Section 5.13 precedence.
- Audit calls remain 200 after the ping namespace has exhausted its allowance; /health remains exempt.
- Quoted SQL-like sport ids return 400 VALIDATION_ERROR; quoted/script customer strings are preserved as data. The four newly confirmed 5xx cases are fixed.
- Checkout checks schema before missing variants, missing variants before invalid discounts, and invalid discounts before stock exhaustion.
- The full regression suite additionally asserts every roster rule's precedence, scoring/compensation errors, all fixture limits, NO_VALID_PAIRING, hostile reference ids, expired/tampered/alg:none tokens, concurrent checkout and roster capacity, and immutable logs.
- Git/push actions and mobile/ inspection or changes are outside this sweep, per the user's explicit constraints.

## Final regression result

run_tests.sh: **320 passed, 0 failed, 0 skipped**. Two regression tests were added, one for each hostile-input class; each exercises the event and offline-sync paths, validation order, absence of event writes, and replay.

Measured line coverage, regenerated from the full test and API V8 profiles:

```json
{
  "fixtures": 100,
  "scoring": 99.22,
  "standings": 99.16,
  "store": 98.83,
  "roster": 100,
  "rbac": 100
}
```

Completed on 17 October 2026 before the 14:25 PKT deadline. The stack is left healthy with its deterministic reset baseline.