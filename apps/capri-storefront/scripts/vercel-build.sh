#!/bin/bash
set -e

# Last line of defense, inside Vercel's own build: a store that serves customers
# must talk to the production backend. backend-target.mjs is the same decision
# vercel.ts uses for the /medusa rewrite; its answer becomes VITE_BACKEND_TARGET
# (the STAGING banner). If it errors (e.g. MEDUSA_BACKEND_ORIGIN pointing a live
# branch elsewhere) or disagrees with the branch, the build fails and Vercel keeps
# the previous deployment live.
if [ -n "$VERCEL" ]; then
  VITE_BACKEND_TARGET="$(node backend-target.mjs)"
  export VITE_BACKEND_TARGET
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
