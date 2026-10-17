# Mobile API

Base URL: `http://localhost:8080/api/v1`. For an emulator/device, replace localhost with the Docker host address. The backend listens on `0.0.0.0:8080`.

All routes below use JSON. Except login, ping and OPTIONS, send `Authorization: Bearer <token>`. Tokens are HS256, last two hours, and use the same issuer/verifier as the audit RBAC tokens. Restarting the backend rotates its signing key; log in again after restart. Permission scopes come from the current account in the database. CORS allows any origin, Authorization and Content-Type, GET/POST/OPTIONS; cookies are not used.

Each client IP has 100 requests per rolling 10 seconds, including login, preflight and ping. A limited request returns 429 and a `Retry-After` header (seconds). `/health` and `/audit/v1/*` remain exempt. JSON bodies have a 1 MB limit. All errors have this envelope:

```json
{"error":{"code":"FORBIDDEN","message":"Access denied","details":{}}}
```

Missing/invalid/expired credentials: 401 `UNAUTHENTICATED`; forbidden scope: 403 `FORBIDDEN` (including existing foreign-tenant resources); missing resources: 404 `<RESOURCE>_NOT_FOUND`; malformed JSON/fields: 400 `VALIDATION_ERROR` with `details.fields`; oversized body: 413 `PAYLOAD_TOO_LARGE`; rate limiting: 429 `RATE_LIMITED`. Checkout and event domain errors retain the Section 5 codes. Authentication precedes parsing protected request bodies. Monetary amounts are integers in minor units; 450000 PKR minor units means PKR 4500.00.

## Demo accounts and content

Every account has password `Nascon@26` (stored with bcrypt).

| Email | Role | Scope |
|---|---|---|
| admin@nascon.test | super_admin | All tenants |
| organizer@nascon.test | league_organizer | tenant-alpha; scoring league-alpha-1 |
| manager@nascon.test | club_manager | tenant-alpha; roster club-alpha-1 |
| player@nascon.test | player | tenant-alpha; club-alpha-1; player-alpha-1 |
| viewer@nascon.test | viewer | tenant-alpha |

Startup and successful `/audit/v1/reset` restore the same demo content: `league-alpha-1` has teams `team-alpha-1` through `team-alpha-4`, six fixtures `demo-match-alpha-1` through `demo-match-alpha-6` (two completed, one in progress, three upcoming). `club-alpha-1` has 12 players, three staff members and a home venue. Its squad is `squad-alpha-1`; `squad-alpha-2` belongs to `club-alpha-2`. Player ids are `player-alpha-1` and `demo-player-alpha-02` through `demo-player-alpha-12`. `player-alpha-2` belongs to the second club. `league-alpha-2` is an empty reserve league. `league-beta-1`, `club-beta-1` and `demo-match-beta-1` demonstrate foreign-tenant isolation. The catalogue includes `prod-jersey-001` with M/L variants. Reset still accepts its original seed/stock overrides and returns its original response shape.

## Authentication

`POST /auth/login` (public):

```json
{"email":"organizer@nascon.test","password":"Nascon@26"}
```

200:

```json
{"token":"<HS256 JWT>","role":"league_organizer","user":{"id":"user-organizer","email":"organizer@nascon.test","tenant_id":"tenant-alpha","club_id":null,"league_id":"league-alpha-1","player_id":null}}
```

Bad credentials return 401 `UNAUTHENTICATED`. Email matching ignores case and surrounding whitespace. `GET /me` returns 200 `{ "role": "league_organizer", "user": <same user object> }`.

`GET /ping` is public and returns 200 `{"pong":true}`. `OPTIONS /<any-path>` is public and returns 204 with the CORS headers.

## Leagues, fixtures and live scores

All five roles can read their own tenant. The administrator can read all tenants. `GET /leagues` returns 200:

```json
{"leagues":[{"league_id":"league-alpha-1","tenant_id":"tenant-alpha","name":"Alpha Premier League","sport_id":"football","teams":[{"team_id":"team-alpha-1","name":"Alpha United"}],"fixture_count":6,"qualification":{"spots":2}}]}
```

The teams and leagues arrays in this example are abbreviated. `GET /leagues/{id}/fixtures` returns 200:

```json
{"league_id":"league-alpha-1","fixtures":[{"match_id":"demo-match-alpha-3","league_id":"league-alpha-1","sport_id":"football","starts_at":"2026-10-17T09:00:00Z","status":"in_progress","home":{"team_id":"team-alpha-1","name":"Alpha United"},"away":{"team_id":"team-alpha-3","name":"Campus Stars"},"score":{"home":{"team_id":"team-alpha-1","score":1,"wickets":null,"balls":null,"overs":null,"fair_play":0},"away":{"team_id":"team-alpha-3","score":1,"wickets":null,"balls":null,"overs":null,"fair_play":0}},"version":3}]}
```

`starts_at` is nullable. Status is `upcoming`, `in_progress` or `completed`. Scores are folded from events on each read. `GET /matches/{id}` returns exactly the audit score body:

```json
{"match_id":"demo-match-alpha-3","sport_id":"football","league_id":"league-alpha-1","status":"in_progress","outcome":"pending","winner_team_id":null,"tiebreak_winner_team_id":null,"home":{"team_id":"team-alpha-1","score":1,"wickets":null,"balls":null,"overs":null,"fair_play":0},"away":{"team_id":"team-alpha-3","score":1,"wickets":null,"balls":null,"overs":null,"fair_play":0},"version":3,"events":[{"sequence":1,"event_id":"demo-event-demo-match-alpha-3-1","type":"match_start","payload":{},"signature":"<hex>","compensated":false,"compensated_by":null}]}
```

The event array is abbreviated. Outcomes: `pending`, `home_win`, `away_win`, `draw`, `undecided`. Innings models populate wickets, balls and the overs string; other models use null for these fields. Event and scoring rules come from the stored sport configuration.

`GET /leagues/{id}/standings` returns exactly `/audit/v1/standings/{id}` (recomputed from logs):

```json
{"league_id":"league-alpha-1","sport_id":"football","qualification_spots":2,"table":[{"rank":1,"team_id":"team-alpha-1","played":1,"won":1,"drawn":0,"lost":0,"scored":1,"conceded":0,"points":3,"fair_play":0,"diff":1,"status":"still_possible","resolved_by":"h2h_points"}],"h2h":{"team-alpha-1":{"team-alpha-2":{"played":1,"points":3,"scored":1,"conceded":0}}}}
```

The table and h2h matrix are abbreviated. `h2h` contains every ordered pair, including zero entries. Table status is `clinched`, `eliminated` or `still_possible`; `resolved_by` is nullable. For innings, `diff` is NRR rounded to three decimals; for rounds, rounds won minus lost.

## Clubs

`GET /clubs/{id}` returns 200:

```json
{"club_id":"club-alpha-1","tenant_id":"tenant-alpha","name":"Alpha United","description":"The home of Alpha United.","home_venue":{"name":"Campus Sports Ground","latitude":33.6518,"longitude":73.1566,"address":"Islamabad, Pakistan"},"social_handles":{"instagram":"@alphasports"},"staff":[{"name":"Ayesha Khan","role":"coach"}],"roster":[{"player_id":"player-alpha-1","name":"Ali Ahmed","position":"gk","squad_id":"squad-alpha-1","role":"captain","parent_squad_id":null,"registration_type":"registration","start_date":"2026-01-01","loan_end_date":null,"league_id":"league-alpha-1"}]}
```

Staff and roster arrays are abbreviated. Rosters reflect current registrations. A release removes the player from the club roster response; transfer/loan moves the registration to the destination squad. Clubs without profile data use empty description/staff/social handles and null venue.

## Catalogue and checkout

`GET /products` returns the tenant's catalogue (administrator: all tenants):

```json
{"products":[{"product_id":"prod-jersey-001","tenant_id":"tenant-alpha","club_id":"club-alpha-1","name":"Alpha Home Jersey","description":"Official Alpha Sports home jersey.","category":"apparel","variants":[{"variant_id":"var-jersey-001-M","size":"M","color":"Blue","price_minor":450000,"currency":"PKR","stock":1,"reserved":0}]}]}
```

`club_id` and `category` may be null; variant size/color are optional. `POST /checkout` uses the audit checkout service. All roles can purchase their tenant's variants. Customer identity is bound to the logged-in account: omit `customer_id` or send the exact user id; a different id returns 403.

```json
{"order_id":"mobile-order-1","items":[{"variant_id":"var-jersey-001-M","quantity":1}],"discount_code":"WELCOME10","payment":{"token":"tok_success"}}
```

201 (identical replay: 200, same stored body):

```json
{"order_id":"mobile-order-1","status":"paid","currency":"PKR","items":[{"variant_id":"var-jersey-001-M","quantity":1,"unit_price_minor":450000}],"subtotal_minor":450000,"discount_minor":45000,"total_minor":405000,"payment":{"authorization_id":"auth_<uuid>","capture_id":"cap_<uuid>","state":"captured"},"receipt":{"payload":{"order_id":"mobile-order-1","customer_id":"user-viewer","items":[{"variant_id":"var-jersey-001-M","quantity":1,"unit_price_minor":450000}],"subtotal_minor":450000,"discount_minor":45000,"total_minor":405000,"currency":"PKR","paid_at":"<ISO timestamp>"},"signature":"<hex>","pdf_base64":"<PDF base64>"}}
```

Only `WELCOME10` is supported; omit/null for no discount. Tokens: `tok_success`, `tok_declined` (402 `PAYMENT_DECLINED`), `tok_capture_fail` (402 `PAYMENT_CAPTURE_FAILED`). Other errors include 404 `VARIANT_NOT_FOUND`, 400 `INVALID_DISCOUNT_CODE`, 409 `OUT_OF_STOCK` and 409 `DUPLICATE_ORDER_ID`. Inventory changes and order replay use the existing locked transaction; successful purchases publish the existing Redis Stream order event.

## Online event submission

`POST /events` accepts exactly the audit event request and returns its response. Organizers can score only their assigned league; administrators can score any league. Other roles return 403. Existing matches determine the league scope; match initialization uses `payload.league_id`.

```json
{"event_id":"mobile-start-1","match_id":"demo-match-alpha-4","type":"match_start","payload":{}}
```

201 (identical event replay: 200):

```json
{"event_id":"mobile-start-1","match_id":"demo-match-alpha-4","type":"match_start","sequence":1,"match_version":1,"signature":"<hex>"}
```

Supported types and payloads retain Section 5.9: `match_init` `{sport_id,home_team_id,away_team_id,league_id?}`, `match_start` `{}`, `score` `{team_id,event_type}`, `discipline` `{team_id,points}`, `tiebreak_winner` `{team_id}`, `match_end` `{}`, `compensation` `{compensates,reason}`. `event_type` must be a key in that sport's `scoring_events`; do not infer rules from sport names. The signature uses Section 5.3 with the event id and the entire canonical payload. Clients never receive DAY1_SALT.

## Offline queue

`POST /offline-sync` accepts 1..100 actions. IDs use `[A-Za-z0-9_.:-]{1,64}`. Each action has a unique `action_id` within the batch, an ISO `queued_at`, a non-negative integer `base_version`, type `score_event` or `roster_action`, and an object `payload`.

```json
{"device_id":"phone-01","actions":[{"action_id":"queued-start-1","type":"score_event","queued_at":"2026-10-17T10:00:00Z","base_version":0,"payload":{"event_id":"offline-start-1","match_id":"demo-match-alpha-4","type":"match_start","payload":{}}}]}
```

200:

```json
{"device_id":"phone-01","processed_order":["queued-start-1"],"results":[{"action_id":"queued-start-1","status":"applied","resolution":"appended","error":null,"server_version":1,"signature":"<hex>"}]}
```

Actions execute in ascending queued_at order (input order for equal timestamps); results remain in input order. Permissions for the whole batch are checked before any action is applied; one unauthorized action rejects the batch with 403. Domain errors reject only the affected action. The batch is not all-or-nothing. A rejected result has `status:"rejected"`, null resolution/signature and an error object `{code,message,details}`. Valid stale versions append with `resolution:"rebased_append"`; a future version is rejected with `INVALID_BASE_VERSION`. Event versions are match log lengths; roster versions count successful mutations of that player in that league.

Deduplication is scoped to authenticated user + device + action id. Retried actions, including previously rejected actions, return `status:"skipped_duplicate"`, null resolution/error/signature and the current server version. Retrying the same underlying event/request id under a new action id also cannot apply it twice. Keep event/request ids stable across retries. To retry a corrected rejected action, allocate a new action id. Per-action database locks serialize duplicate submissions; domain mutations keep their existing transaction and idempotency checks.

A roster action is available only to the source club's manager or the administrator. There is no new audit roster route. Example payload:

```json
{"request_id":"transfer-1","league_id":"league-alpha-1","player_id":"demo-player-alpha-12","type":"transfer","from_squad_id":"squad-alpha-1","to_squad_id":"squad-alpha-2","effective_date":"2026-10-17","reason":"Squad move"}
```

Use this as `payload` with action type `roster_action`. Supported mutations: `transfer`, `loan` (also requires `loan_end_date` later than effective_date), `release` (`to_squad_id` is null/omitted). Dates are YYYY-MM-DD. `requested_by` is assigned by the server. A successful mutation updates the registration immediately and records an audit history row; offline results expose the new roster version with null signature. Transfers/loans enforce the configured window, capacity and required positions; source membership and cross-tenant constraints apply. Domain errors include `LEAGUE_NOT_FOUND`, `SQUAD_NOT_FOUND`, `PLAYER_NOT_FOUND`, `NOT_IN_SQUAD`, `TRANSFER_WINDOW_CLOSED`, `PLAYER_ON_LOAN`, `SQUAD_FULL`, `MIN_POSITION_VIOLATION`, `CROSS_TENANT_TRANSFER`, `DUPLICATE_REQUEST_ID`, `INVALID_BASE_VERSION`. Read `/clubs/{id}` again after a successful sync to refresh the roster.
