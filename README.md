# Pixel Peepers - NaSCon '26 Parts I and II

## Run
```bash
DAY1_SALT=<day1-salt> DAY2_SALT=<day2-salt> docker compose up -d --build
curl http://localhost:8080/health
```

API: `http://localhost:8080`. Day 2 B1 contracts, infrastructure, and test notes: [DAY2_B1.md](DAY2_B1.md).
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
