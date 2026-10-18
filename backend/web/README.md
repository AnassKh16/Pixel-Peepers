# Skorly guest web player (B1)

Plain HTML, CSS and browser JavaScript. No framework, npm install or build step.
Only files under backend/web/ are owned by Laptop 2. The cleaned SPEC_DAY2.md and DECISIONS_DAY2.md are the reference; bracketed PDF instructions are ignored.

## Backend integration (Laptop 1)

Serve this directory at /web, including vendor/, and return index.html for the following page routes:
- /web/matches/{id}/live
- /web/matches/{id}/preview
- /web/matches/{id}/vod
- /web/matches/{id}/notice?state=postponed|cancelled|abandoned
- /web/costream/{id}
- /web/players/{id}
- /web/clubs/{id}

Serve real files first; do not return index.html for missing JavaScript, CSS or HLS assets.
The backend owns /q/* redirects, all APIs, authorization, moderation, atomic merging and media.
No service code, Docker configuration or test runner outside this directory was modified.
The normal production origin remains port 8080.

## Every API called by this client

All URLs below are same-origin. JSON requests carry Accept: application/json and
Authorization: Bearer <guest token>, or the authenticated member token after successful login.
POSTs also carry Content-Type: application/json. No salt is used or stored by this client.

1. GET /api/v1/matches/{id}: initial score and, when SSE fails, polling every 300 ms.
   One request at a time. Supports the existing response with home.score, away.score and version,
   or score.home.score / score.away.score. Optional fields: title, home.name, away.name,
   guest_token, playback_url, hls_url, stream.playback_url, chat_room_id, messages,
   pinned_merchandise. Lower score versions are ignored.
2. GET /api/v1/matches/{id}/stream: native EventSource (SSE). No custom Authorization header is
   possible with native EventSource; the backend must allow anonymous read access/session cookies
   on this read-only stream. Supports default message events and named score, score_update, match,
   match_update, update and chat events, each containing a JSON snapshot. data or match envelopes
   are accepted. SSE reconnects normally; on error the 300 ms poll starts and stops on reconnection.
3. GET /api/v1/costream/{id}: co-stream metadata. Expected optional composite_playback_url,
   chat_room_id, match_id and the same score fields. This read API is an integration addition:
   the spec defines session creation, but not its public GET shape. Until match_id is provided,
   co-stream pages subscribe to seeded match-m1. The default chat room is chat-{session_id}.
4. GET /api/v1/chat?chat_room_id={room}: moderated chat history, every 1 second. Accepts an array
   or {messages:[...]} / {filtered_messages:[...]}. Stable message_id/id/sequence should be provided.
   This read API is an integration addition; unavailable history shows an empty state, never fake chat.
5. POST /api/v1/chat: {chat_room_id,message_id,text}. The backend derives sender identity.
   A guest 403 with error.code GUEST_WRITE_FORBIDDEN opens the auth modal; the rejected message is
   NOT appended, and the draft/cart are kept. A network error or another error is shown honestly.
   Even an erroneous 2xx guest response is not appended by the client.
   After member authentication, only server-returned moderated messages are appended.
6. GET /api/v1/products: {products:[...]}. Reads product prod-jersey-001 and var-jersey-001-L
   name/description/price. The initial card identifies the spec's seeded jersey and price; it never
   claims available stock. Clicking stages that variant locally, not a checkout mutation.
7. GET /api/v1/players/{id} and GET /api/v1/clubs/{id}: public profiles. Optional name,
   description, club_affiliations, career_records, upcoming_fixtures, vod_archive, roster, staff.
   The player read API and public guest authorization must be supplied by Laptop 1.
8. POST /api/v1/auth/login: {email,password}; existing API response {token,user:{id,player_id}}.
   registered_user_id, when explicitly supplied by login, takes priority for merging.
9. POST /audit/v1/guest/cart-merge: {guest_token,registered_user_id,guest_cart,test_write_block:true},
   only after successful login and only for a nonempty staged cart. Receives cart_merged and active_cart.
   The staged cart is removed only after server confirmation. Errors preserve the exact payload for
   retries; no quantities are silently capped. An empty guest cart does not call this 1..10-item API.
   The UI keeps the same video element and restores its playback time after closing the modal.
   Registration's endpoint is unspecified by the contract: the modal directs new users to their club
   organizer rather than inventing an unsafe registration API.

## Guest token, persistence and security

A guest_token in the match/co-stream snapshot replaces the current anonymous token.
Until one is issued, the explicitly seeded contract token guest_anon_tok_7721 is used.
The backend MUST issue valid short-lived tokens for production guests; the UI cannot mint them.
Guest cart/token use sessionStorage, with an in-memory fallback if storage is disabled. Member
credentials/tokens are not persisted. Clear sessionStorage for a fresh-session 0-item cart test.
Authentication is never forced on page load. Login is triggered by chat's actual blocked POST or
an explicit checkout click. This UI does not pretend that hiding buttons enforces authorization.

## Media and accessibility

A visible VIDEO element has data-testid guest-video-player. Bundled hls.js 1.7.3 is licensed in vendor/HLS-LICENSE.txt. A local optional
/web/vendor/hls.min.js supplies Hls for browsers without native HLS; otherwise video.src is used.
Media URLs must be browser-reachable HTTP(S), with correct HLS CORS configuration if cross-origin.
Changing scores never reattaches media unless the playback URL actually changes.
Native controls plus labelled 48px custom Play, Mute and Full screen buttons are present.
All dynamic text uses textContent, not HTML interpolation. Focus is trapped inside the auth modal,
Escape/close restores focus and playback, and the background main area is inert while it is open.
CSS uses local system fonts, visible focus outlines, high-contrast text and responsive layouts.
The nine required selectors are unique, with progressive-auth-modal hidden on initial load.

## Verification status

See verification.md for checks actually run: 18 passed, 0 failed in isolated real Chrome. Local checker source/results are in the ignored .checks/ directory; node .checks/browser-check.cjs reruns it. These are frontend fixture checks, not the Docker suite. Real backend integration, real HLS ingest, latency
under Selenium Grid, and run_tests.sh are Laptop 1 checks; no Docker is run on this laptop.


