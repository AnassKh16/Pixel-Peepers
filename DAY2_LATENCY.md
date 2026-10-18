# Day 2 latency verification

The unchanged `tests/k6_load.js` runs 500 QR viewers and 50 moderation posters for 15 seconds.

| Check | Final result | Evidence |
|---|---|---|
| k6 after final rebuild | Exit 0; p95 420.95 ms; 0/23,648 failed | DAY2_LATENCY_FINAL_K6.log |
| k6 steady-state confirmation | Exit 0; p95 320.94 ms; average 177.26 ms; 0/28,019 failed; 1,830.99 requests/s | DAY2_LATENCY_STEADY_K6.log |
| Backend regression suite | 515 passed; 0 failed; 0 skipped | DAY2_LATENCY_TEST_RESULTS.log |
| External verifier, unchanged | 35/35 checks passed | DAY2_LATENCY_VERIFY.log |

Both final-build load runs passed the original p95 <800 ms and zero-failure thresholds. The earlier local baseline measured p95 2.46 seconds.

## Changes

- QR inspection executes one read-only SQL statement for mapping, live entity metadata, sport configuration and event log. It creates no mapping, scan count or telemetry row.
- Requests for the same entity waiting in one event-loop turn share a read scheduled afterward. The batch entry is removed before SQL starts. Completed and in-flight snapshots are never cached for later requests; each later batch reads live state again.
- Unmapped entities use deterministic virtual short URLs. Their first actual scan creates the same mapping through the normal transaction, so inspected/exported QR codes remain usable.
- DLQ snapshot/depth reads use single SELECT statements without writer advisory locks or connection-holding transactions. Enqueue and clear retain transactional writer serialization.
- The server runs up to four Node workers, with at most eight database connections each. PostgreSQL and Redis remain the shared authorities for writes, privacy, idempotency, score notifications and rate limits.
- Only the primary initializes/seeds the database. Workers share one runtime JWT key and baseline password hash, and only one worker runs the order outbox publisher. Worker restarts do not reset data.
- Route DLQ initialization and database connection setup occur before listening. Subscriber metrics aggregate live counts across serving workers through IPC.

## Regression coverage

Eight new checks cover one-statement inspection, same-turn batching with fresh later reads, PostgreSQL READ ONLY enforcement, first-scan virtual URLs, non-blocking DLQ reads, JWT verification across workers, identical resets across workers, and live subscriber metrics across workers.

`tests/k6_load.js` and the external verifier were read only. No changes were made to mobile/, backend/web/, root tests/, .github/, COVERAGE_DAY2.json or TRACEABILITY.md. Salts were read through environment variables only and are absent from this report and the recorded output. No git commands were run.
