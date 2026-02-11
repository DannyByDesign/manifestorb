#!/usr/bin/env sh
set -eu

SCHEMA_PATH="prisma/schema.prisma"

echo "[deploy] prisma migrate precheck starting"
bunx prisma migrate status --schema "$SCHEMA_PATH"

echo "[deploy] prisma migrate deploy starting"
# Fail fast instead of hanging indefinitely during Railway predeploy.
if command -v timeout >/dev/null 2>&1; then
  timeout 600 bunx prisma migrate deploy --schema "$SCHEMA_PATH"
else
  bunx prisma migrate deploy --schema "$SCHEMA_PATH"
fi

echo "[deploy] prisma migrate deploy finished"
