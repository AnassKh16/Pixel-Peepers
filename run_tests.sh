#!/bin/sh
set -eu
# Run after docker compose up -d --build; includes live database/reset checks.
docker compose exec -T -e RUN_INTEGRATION=1 backend npm test
