#!/bin/bash
set -e

# Last line of defense, inside Vercel's own build: a store that serves customers
# must talk to the production backend. vercel.ts sets VITE_BACKEND_TARGET from the
# same decision as the /medusa rewrite; if it is missing, vercel.ts was not applied
# (and the rewrite with it). Failing here keeps the previous deployment live.
if [ -n "$VERCEL" ]; then
  if [ -z "$VITE_BACKEND_TARGET" ]; then
    echo "vercel-build: VITE_BACKEND_TARGET is not set — apps/capri-storefront/vercel.ts was not applied. Aborting." >&2
    exit 1
  fi
  case "$VERCEL_GIT_COMMIT_REF" in
    develop|main) LIVE=1 ;;
    *) LIVE=$([ "$VERCEL_ENV" = "production" ] && echo 1 || echo 0) ;;
  esac
  if [ "$LIVE" = "1" ] && [ "$VITE_BACKEND_TARGET" != "production" ]; then
    echo "vercel-build: branch '$VERCEL_GIT_COMMIT_REF' ($VERCEL_ENV) serves customers but targets '$VITE_BACKEND_TARGET'. Aborting." >&2
    exit 1
  fi
  echo "vercel-build: branch '$VERCEL_GIT_COMMIT_REF' ($VERCEL_ENV) → backend '$VITE_BACKEND_TARGET'"
fi

cd ../vto-web
npm install
VITE_TRYON_BASE=/tryon-3d/ VITE_VISION_API_BASE=/medusa npm run build
mkdir -p ../capri-storefront/public/tryon-3d
cp -r dist/* ../capri-storefront/public/tryon-3d/

cd ../capri-storefront
npm run build
