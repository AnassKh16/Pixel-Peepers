# Pixel Peepers - NaSCon '26 Parts I and II

## Run
```bash
DAY1_SALT=<day1-salt> DAY2_SALT=<day2-salt> docker compose up -d --build
curl http://localhost:8080/health
```

API: `http://localhost:8080`. Day 2 backend notes: [B1 streaming and Grid](DAY2_B1.md), [B2 guest web API, QR, carts and score push](DAY2_B2.md).
Mobile app: `mobile/release/app-release.apk`.
Server address is editable in the app's Settings screen (default http://192.168.137.1:8080; emulator 10.0.2.2:8080).

## Tests
```bash
./run_tests.sh
```

## Demo accounts
The password for all accounts is `Nascon@26`.

| Role | Email |
|---|---|
| Platform Super-Admin | admin@nascon.test |
| League Organizer (owns league-alpha-1) | organizer@nascon.test |
| Club Manager (owns club-alpha-1) | manager@nascon.test |
| Player (player-alpha-1) | player@nascon.test |
| General Viewer | viewer@nascon.test |

## Architecture

The backend uses Node.js 20, Express, PostgreSQL, and Redis. Scoring is
event-sourced, checkout is transactional, and authorization is centralized in
one policy matrix. See [ADR.md](ADR.md) for the key design decisions and
[TRACEABILITY.md](TRACEABILITY.md) for requirement-to-code and test coverage.

## Environment

See `.env.example` for optional environment configuration.


---

## 🌈 Day 2

**🟦 API & scores · 🟪 Guest web · 🟩 Browser Grid · 🟧 Android app**

### 🚀 Start the stack

Run on the backend laptop from the repo root, using Bash. Replace the placeholders
with your venue salts locally; never put real salts in files or commits.

```bash
DAY1_SALT='<salt>' DAY2_SALT='<salt>' docker compose up -d --build
curl --fail http://localhost:8080/health
```

Ready response: HTTP 200 with `{"status":"ok"}`.
The backend uses **up to 4 Node workers**, capped by available CPUs
(`min(4, availableParallelism())` in [server.js](backend/src/server.js)).

### 🧭 Services & ports

From [docker-compose.yml](docker-compose.yml); “internal” ports are not published to the host.

| Service | Published host ports | Role / internal ports |
|---|---|---|
| `backend` | **8080/TCP** | Core API and guest web player |
| `selenium-hub` | **4444/TCP**, 4442–4443/TCP | Grid WebDriver hub and event bus |
| `node-chrome-1` | — | Chrome node; 5555/TCP internal |
| `node-chrome-2` | — | Chrome node; 5555/TCP internal |
| `node-firefox` | — | Firefox node; 5555/TCP internal |
| `mediamtx` | **1935/TCP**, **8888/TCP**, **8889/TCP**, 8189/UDP | RTMP, HLS, WebRTC; control API 9997/TCP internal |
| `minio` | **9000/TCP** | Object storage API |
| `postgres` | — | PostgreSQL; 5432/TCP internal |
| `redis` | — | Redis; 6379/TCP internal |

Grid includes **one hub + three browser nodes**, with 1 GB shared memory per node and VNC disabled.

### 🎟️ Open the guest web player

- Match: [localhost:8080/web/matches/match-m1/live](http://localhost:8080/web/matches/match-m1/live)
- Co-stream: [localhost:8080/web/costream/cs-session-101](http://localhost:8080/web/costream/cs-session-101), after creating that session.
- Short QR links resolve through `/q/{short_code}`; seeded example: [localhost:8080/q/m1-live](http://localhost:8080/q/m1-live).

Guests can read without an account. Protected guest writes return **403**
with `GUEST_WRITE_FORBIDDEN`; chat then opens the sign-in modal and keeps the staged cart.

### 📱 Android

Install [mobile/release/app-release.apk](mobile/release/app-release.apk).
In **Settings**, set the server to `http://<backend-laptop-LAN-IP>:8080`;
keep the phone and backend laptop on the same network.

Deep links: `nascon://entity/match-m1` and `nascon://stream/cs-session-101`.

### 🧪 Tests & evidence

Recorded backend result: **515 passed · 0 failed · 0 skipped**
([latency and regression verification](DAY2_LATENCY.md)).
Install Python test dependencies with `python -m pip install -r tests/requirements.txt`.

```bash
./run_tests.sh
pytest -n 3 tests/selenium/ --junitxml=tests/reports/selenium-report.xml
pytest tests/appium/ --junitxml=tests/reports/appium-report.xml
```

Appium needs **Appium 2 + UiAutomator2 on localhost:4723**, an authorized USB
Android phone, and the APK installed. Missing device/server causes the current fixture to skip.

Same k6 command as [autograde.yml](.github/workflows/autograde.yml), on the Linux/CI backend host:

```bash
docker run --rm --network host \
  -v "$PWD:/work" -w /work \
  grafana/k6:0.54.0 \
  run --summary-export=tests/reports/k6-summary.json tests/k6_load.js
```

Reports: `tests/reports/` → `selenium-report.xml`, `appium-report.xml`, `k6-summary.json`.
See [COVERAGE_DAY2.json](COVERAGE_DAY2.json) for measured line coverage and
[TRACEABILITY.md](TRACEABILITY.md) for requirement-to-source/test mappings.

### 🟠 Known limitations

- No real co-stream media compositor.
- No stream recording or VOD indexing.
- Native broadcasting, playback and four-way video are placeholders.
- No native QR scanner.
- No OS push notifications.
- Host handoff is simulated through the audit request.
