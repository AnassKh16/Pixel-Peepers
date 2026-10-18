# Day 2 B2: guest web backend contract

Base URL: http://localhost:8080. Binding sources are SPEC_DAY2.md and DECISIONS_DAY2.md supplied by the team. Day 1 and B1 endpoints retain their existing contracts.

## Guest access and member compatibility

The public GET routes below work with no Authorization header or with `Authorization: Bearer guest_anon_tok_7721`. They also accept newly issued guest tokens. Invalid non-guest JWTs return 401 rather than silently becoming guests.
For signed-in members, existing match, club, and catalogue handlers retain their original response bodies and tenant checks. A member JWT from tenant-alpha still gets 403 for foreign match/club/player details. Public data contains no account email, private registration fields, private staff contacts, or venue access codes.
All /api/v1 HTTP routes share the existing 100 requests per rolling ten seconds per IP limit. A 429 includes Retry-After. The /audit/v1 and /q surfaces are exempt.

## Routes used by the web player

| Route | Result |
|---|---|
| GET /api/v1/matches/{id} | Guests receive the current public score view, including match_id, status, home, away, version and score as a string such as `1 - 0`. Members retain the original Day 1 score response. |
| GET /api/v1/matches/{id}/summary | No login required. Exactly `{match_id,status,home,away,score}`. home and away are team objects containing team_id, score, wickets, balls, overs and fair_play. |
| GET /api/v1/matches/{id}/stream | Public SSE connection, initial snapshot followed by committed updates. Member JWTs retain tenant checks. |
| ws://localhost:8080/ws/matches/{id} | Public WebSocket score subscription. Initial snapshot followed by committed updates. Optional member Authorization headers retain tenant checks. |
| GET /api/v1/costream/{id} | Saved co-stream response plus participants (the active participant list); includes layout, composite_playback_url, chat_room_id and active_host. Create the session through the B1 audit endpoint first. |
| GET /api/v1/chat?chat_room_id=chat-{session_id} | `{chat_room_id,messages:[...]}` in ascending sequence order. Optional after_sequence and limit (1-100, default 100). |
| GET /api/v1/products | `{products:[...]}`. Public products include product_id, club_id, name, description, category and variants. Variants include variant_id, size, color, price_minor, currency, stock. |
| GET /api/v1/players/{id} | Exactly `{player_id,club_id,name,position}`. |
| GET /api/v1/clubs/{id} | Public club_id, name, description, home_venue, social_handles, staff and roster. Staff expose name/role; roster exposes player_id/name/position/role. |

A score view includes sport_id, league_id, status, outcome, winner_team_id, tiebreak_winner_team_id, home, away, version and the display string score. Raw private account details are never part of the stream.
SSE sends both a named `score` event and a standard message event for compatibility with addEventListener('score') and onmessage consumers. Both carry the same version; consumers listening to both can deduplicate by version and status.
SSE and WebSocket JSON has `{type:"score", ...scoreView, data:scoreView}`. The same fields are available directly and under data. Each accepted event commits a compact PostgreSQL NOTIFY message, so score/compensation/start/end updates reach every API process without polling. Rejected events and idempotent event replays do not publish another event.
Postponed/cancelled/abandoned administrative states are read live from matches.data.status. Updating that field also triggers a score notification. This adds no new Day 1 event type and stores no score counters.

## Guest token and protected writes

POST /api/v1/guest/token accepts an empty JSON object and returns 201:
```json
{"guest_token":"guest_anon_tok_<hex>","role":"guest","read_only":true,"expires_at":"<UTC ISO timestamp>"}
```
The token lasts one hour and is persisted in guest_tokens. Public reads remain available without a token.
Any guest-token write is rejected by the shared server middleware before body parsing, except login, guest-token issuance, and the specified cart-merge flow. No-token /api/v1 writes are also rejected, except login/token issuance. Audit calls without an Authorization header remain available for the grader.
A guest write returns 403 with `{error:{code:"GUEST_WRITE_FORBIDDEN",message:"Anonymous guest tokens cannot perform write mutations.",details:{guest_token:"<supplied token>"}}}`. For no-token writes, details.guest_token is null. POST /api/v1/auth/login keeps its existing contract.

## Member chat

POST /api/v1/chat requires a real member JWT. Use either chat_room_id or session_id:
```json
{"session_id":"cs-session-101","message_id":"optional-unique-id","text":"Live reaction"}
```
201 returns a stored message:
```json
{"chat_room_id":"chat-cs-session-101","message_id":"<id>","sender":"user-viewer","text":"Live reaction","sequence":1,"flagged":false,"reason":null,"created_at":"<UTC ISO timestamp>"}
```
The server sets sender from the verified member, not from the request. Sequences are allocated under a room row lock and are strictly increasing per room. Identical message-ID replays return 200; a different message with that ID returns 409 DUPLICATE_MESSAGE_ID.
The shared backend/src/chat-filter.js masks configured profanity/leetspeak with `***`. Flood messages are dropped with a 200 response containing dropped:true and reason:flood_character_repeat; they are not stored and consume no sequence. The later moderation audit/DLQ module can reuse filterChatMessage rather than creating a second filter.

## Dynamic QR and exports

GET /audit/v1/qr/{entity_id} returns exactly the Section 5.6 metadata and signature. It increments scan_count; `?inspect=true` reads without incrementing. Existing matches, players, clubs and co-streams receive stable mappings as needed; the three baseline short codes remain m1-live, p-alpha-1 and c-alpha-1.
GET /q/{short_code} increments one scan and returns 302 with Location equal to the live target_route. A completed match changes to /vod; postponed/cancelled/abandoned change to /notice?state=...; the printed short URL remains unchanged. Responses use Cache-Control:no-store.
GET /audit/v1/qr/{entity_id}/export.svg, export.png and export.pdf generate real QR exports. Exact content types are image/svg+xml, image/png and application/pdf. Exporting does not count a scan. PDF posters contain the entity ID and the stable short URL.
Telemetry stores only entity_id, device_family (mobile/desktop), UTC hour and an aggregate count. It stores no IP, raw User-Agent, cookies or fingerprint.

## Atomic cart merge

POST /audit/v1/guest/cart-merge follows Section 5.7. Validate schema first, player next, every variant next, then stock limits and merge conflicts. The default test_write_block:true exercises the same real guard as POST /api/v1/chat and records write_block_verified:true/write_rejection_code:403. With false, those fields are false and integer 0.
Identity for replay is `(guest_token, registered_user_id, guest_cart)`; changing only the probe flag still replays the stored result. A changed user/cart after a successful merge returns GUEST_TOKEN_ALREADY_MERGED after the earlier reference and stock checks. Duplicate variants are summed together with the member's existing cart.
Guest/cart/variant locks serialize concurrent requests. Rejected requests roll back. Merging does not reserve or decrement inventory; the existing checkout transaction remains responsible for reservation. This prevents duplicate merge retries from double-reserving stock.

## Files, services and verification

New services live under backend/src; regression tests are backend/test/day2-b2.test.js. Root tests/, .github/, mobile/ and backend/web/ were not edited.
Express serves the existing backend/web files and returns index.html for deep SPA paths. Compose mounts that folder read-only; Docker also copies it into the image. No placeholder was needed because index.html already existed.
Compose adds persistent MinIO on port 9000, built FROM cgr.dev/chainguard/minio:latest. Its minimal derivative adds BusyBox for a real /minio/health/live healthcheck and creates a data directory owned by the non-root service user. Data uses minio_data. MediaMTX and Grid remain as in B1.
Run `sh ./run_tests.sh` from the repository root with both salts in the environment. Tests use runtime environment keys, never a hard-coded Day 2 key. The B2 suite covers all validation/error ordering, binary exports/PDF text, private-field filtering, concurrent scans/cart/chat, all public GETs, the 25-client WebSocket probe, cross-process SSE and MinIO readiness. The final counts and measured latency are in DAY2_B2_VERIFICATION.json.
