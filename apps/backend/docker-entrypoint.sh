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
    # The venv's own python, not `uv run`: uv writes and deletes temp dirs under
    # /root/.cache/uv on every start, and Coolify's rolling update measures the
    # container's disk at that same moment — a dir vanishing mid-scan failed
    # the deploy ("snapshotter.Usage failed … .cache/uv/.tmp…: no such file").
    /app/vision-measure/.venv/bin/python services/api/vision_api.py
    echo "[vision-measure] exited, restarting in 2s" >&2
    sleep 2
  done
) &

cd /app/apps/backend/.medusa/server
# Non-blocking: a migration failure must never take the whole deploy down with
# it (see the Dockerfile's own note on this line's history). It is NOT silent
# either: the status travels to `GET /version` ("migrations": "failed") and to
# the panel's Security tab (lib/security.ts `db.migrations_applied`), instead of
# being discovered through 500s on the routes that needed the new columns.
#
# Bounded by MIGRATE_TIMEOUT_SECONDS (default 900): a migration that hangs (a
# lock that never comes, a database that stops answering) used to keep the
# server from ever starting, which only showed up as a mute 502 from the proxy.
# busybox `timeout` kills it with SIGTERM: exit 143 (137 if it had to be SIGKILLed).
MIGRATE_TIMEOUT_SECONDS="${MIGRATE_TIMEOUT_SECONDS:-900}"
if timeout "$MIGRATE_TIMEOUT_SECONDS" /app/apps/backend/node_modules/.bin/medusa db:migrate; then
  export MEDUSA_MIGRATE_STATUS=ok
else
  status=$?
  if [ "$status" -eq 143 ] || [ "$status" -eq 137 ]; then
    echo "[deploy] db:migrate TIMED OUT after ${MIGRATE_TIMEOUT_SECONDS}s; starting anyway — GET /version reports migrations=failed. Check pg_stat_activity / pg_locks, then redeploy." >&2
  else
    echo "[deploy] db:migrate FAILED (exit $status); starting anyway — GET /version reports migrations=failed. Run the migration by hand and redeploy." >&2
  fi
  export MEDUSA_MIGRATE_STATUS=failed
fi

# exec replaces this shell with Medusa, so the SIGTERM that tini (PID 1, see
# the Dockerfile) forwards on stop reaches Medusa directly for a clean shutdown
# instead of being swallowed by a shell that is not listening for it. Medusa
# must NOT be PID 1 itself: it never reaps re-parented orphans (zombie PIDs).
exec /app/apps/backend/node_modules/.bin/medusa start -H 0.0.0.0
