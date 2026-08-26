#!/bin/sh
set -e

# vision-measure runs as a second process in this same container instead of a
# separate Coolify app — see src/api/vision-measure/proxy.ts, which reaches it
# at http://127.0.0.1:8008 and is the only thing that ever talks to it; the
# port is never exposed on its own.
#
# Restart-looped in the background rather than supervised with a real process
# manager: a crash here degrades only the try-on's AI panel (the proxy route
# already answers with a friendly 502 while it is down), never the storefront
# or checkout, so pulling in bash + `wait -n` (busybox ash has neither) for
# proper multi-process supervision is not worth it.
(
  cd /app/vision-measure
  while true; do
    uv run --frozen --no-sync python services/api/vision_api.py
    echo "[vision-measure] exited, restarting in 2s" >&2
    sleep 2
  done
) &

cd /app/apps/backend/.medusa/server
# Non-blocking: a migration failure must never take the whole deploy down with
# it (see the Dockerfile's own note on this line's history).
/app/apps/backend/node_modules/.bin/medusa db:migrate || echo "[deploy] db:migrate fallo; arrancando de todos modos"

# exec replaces this shell with Medusa as PID 1, so Coolify/Docker's SIGTERM
# on stop reaches Medusa directly for a clean shutdown instead of being
# swallowed by a shell that is not listening for it.
exec /app/apps/backend/node_modules/.bin/medusa start -H 0.0.0.0
