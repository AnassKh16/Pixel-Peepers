#!/bin/sh
set -eu
cd "$(dirname "$0")"

# A clean checkout needs only Docker and the environment salt.
if [ -z "$(docker compose ps --status running -q backend)" ]; then
  docker compose up -d --build
fi
started=$(date +%s)
until docker compose exec -T backend node -e "fetch('http://127.0.0.1:8080/health',{signal:AbortSignal.timeout(1000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"; do
  if [ "$(( $(date +%s) - started ))" -ge 120 ]; then
    echo 'Backend did not return /health 200 within 120 seconds' >&2
    exit 1
  fi
  sleep 2
done

docker compose exec -T backend node scripts/run-tests.mjs
docker compose cp backend:/tmp/nascon-coverage/COVERAGE.json ./COVERAGE.json
