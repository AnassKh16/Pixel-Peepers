# Pixel Peepers - NaSCon '26 Part I

## Run
```bash
DAY1_SALT=<salt> docker compose up -d --build
curl http://localhost:8080/health
```
API: `http://localhost:8080`. Mobile app: `mobile/release/app-release.apk` (server address is changeable in the app's settings screen).

## Tests
```bash
./run_tests.sh
```

## Demo accounts (password for all: `Nascon@26`)
| Role | Email |
|---|---|
| Platform Super-Admin | admin@nascon.test |
| League Organizer (owns league-alpha-1) | organizer@nascon.test |
| Club Manager (owns club-alpha-1) | manager@nascon.test |
| Player (player-alpha-1) | player@nascon.test |
| General Viewer | viewer@nascon.test |

## Environment variables
See `.env.example`.
