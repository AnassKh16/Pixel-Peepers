# Day 2 B1 backend

Binding source: C:\nascon-prep\SPEC_DAY2.md plus C:\nascon-prep\DECISIONS_DAY2.md.
This slice implements Sections 5.2-5.5 and media/Grid readiness. It does not implement the guest web UI, QR routes, cart merge, moderation, recording, or a video compositor.

## Start and test

Supply DAY1_SALT and DAY2_SALT through the shell environment, then run `docker compose up -d --build --wait --wait-timeout 120` from the repository root. Neither salt is embedded in code or tests. `.env.example` contains empty placeholders only.
Run `sh ./run_tests.sh` for every Day 1 regression and B1 test plus measured Day 1 coverage. B1 tests are in `backend/test/day2-b1.test.js` and use the environment key to independently check the exact Appendix A message. They also create three actual Grid browser sessions (two Chrome, one Firefox) and check real MediaMTX refusal of revoked keys.

## Services

The API stays on 8080. Grid 4.24.0 exposes 4444/4442/4443 with two Chrome nodes and one Firefox node, each with 1 GB shared memory, two sessions, VNC disabled, and host.docker.internal routing.
MediaMTX is built FROM the pinned official `bluenviron/mediamtx:1.9.1` image. Its small Dockerfile adds BusyBox and the Alpine loader solely for a real HTTP healthcheck because the official image contains no shell or HTTP client. RTMP/HLS/WebRTC use 1935/8888/8889; WebRTC media also uses UDP 8189. Control API 9997 is internal to Docker and is not host-published.
GET /health preserves `{"status":"ok"}` and checks PostgreSQL, Redis, baseline readiness, and a valid response from the real MediaMTX control API. Failure returns 503 NOT_READY.

## Stream key lifecycle

POST /audit/v1/stream/key accepts action generate/rotate/revoke, player_id, optional label (default default), and optional exact stream_key_override. Generate returns 201; rotate/revoke return 200. Generated keys contain 16 lowercase hexadecimal characters after sk_live_. Rotation invalidates prior keys; revoke returns null ingest_endpoints and playback_url.
Responses contain exactly player_id, label, stream_key, status, ingest_endpoints, playback_url, signature. The signature covers action, player_id, status, stream_key using the stream key as entity ID.
MediaMTX calls POST /internal/media/auth for publish/read/playback. Active keys are accepted; unknown keys return 404 STREAM_NOT_FOUND and revoked keys return 409 KEY_REVOKED. MediaMTX translates a denied callback into its protocol's refusal. Revocation/rotation also kicks matching existing RTMP and WebRTC publishers/readers through the control API.
The PostgreSQL tables stream_keys and creator_streams preserve revoked keys, keep the current key, and enforce one active key per player. Player row locks serialize changes; override keys also have advisory locks.

## Co-stream state

POST /audit/v1/costream/session checks schema, player existence, host membership, submitted capacity, then effective layout capacity in that order. Defaults: grid_4 and simulate_host_drop false. It returns 201 for a new state and 200 for an identical replay.
A dropped host is removed before selecting the first remaining participant. A sole dropped host terminates the session with a null active_host. Playback URL and chat room identity stay stable for the session. Earlier request replays return their saved result without undoing a later handoff.
Responses contain exactly session_id, status, active_host, handoff_occurred, participant_count, active_participants, layout, composite_playback_url, chat_room_id, signature. The six signed fields are active_host, handoff_occurred, layout, participant_count, session_id, status. Session updates and replay records are serialized in costream_sessions.
The composite URL is the Section 5.5 state contract; actual mixed video and unified chat delivery belong to subsequent work. No compositor process is spawned by this state endpoint.

## Reset additions

Reset keeps its Day 1 response JSON and restores every existing demo fixture. It additionally seeds player-beta-2, match-m1 as a 1-0 in-progress event stream, three qr_mappings rows, guest_anon_tok_7721 in guest_tokens, and an empty user_carts record for player-alpha-1. All Day 2 mutable state is cleared on reset. The existing regression's total match count becomes eight (seven original matches plus match-m1).
