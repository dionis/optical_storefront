#!/bin/bash
set -e

# Which backend this build talks to. vercel.json is the same on every branch and
# rewrites /medusa → production and /medusa-staging → staging; backend-target.mjs
# picks the prefix from the branch (develop/main → /medusa, always). Outside Vercel
# nothing is set and the app keeps its local defaults (/medusa + the Vite proxy).
if [ -n "$VERCEL" ]; then
  read -r VITE_BACKEND_TARGET VITE_BACKEND_PROXY <<< "$(node backend-target.mjs)"
  export VITE_BACKEND_TARGET VITE_BACKEND_PROXY

  # Last line of defense: a branch that serves customers must use the production
  # prefix. Failing here keeps the previous deployment live.
  case "$VERCEL_GIT_COMMIT_REF" in
    develop|main) LIVE=1 ;;
    *) LIVE=$([ "$VERCEL_ENV" = "production" ] && echo 1 || echo 0) ;;
  esac
  if [ "$LIVE" = "1" ] && { [ "$VITE_BACKEND_TARGET" != "production" ] || [ "$VITE_BACKEND_PROXY" != "/medusa" ]; }; then
    echo "vercel-build: branch '$VERCEL_GIT_COMMIT_REF' ($VERCEL_ENV) serves customers but targets '$VITE_BACKEND_TARGET' ($VITE_BACKEND_PROXY). Aborting." >&2
    exit 1
  fi
  if [ -z "$VITE_BACKEND_PROXY" ]; then
    echo "vercel-build: backend-target.mjs gave no proxy path. Aborting." >&2
    exit 1
  fi
  echo "vercel-build: branch '$VERCEL_GIT_COMMIT_REF' ($VERCEL_ENV) → backend '$VITE_BACKEND_TARGET' via $VITE_BACKEND_PROXY"
fi

cd ../vto-web
npm install
VITE_TRYON_BASE=/tryon-3d/ VITE_VISION_API_BASE="${VITE_BACKEND_PROXY:-/medusa}" npm run build
mkdir -p ../capri-storefront/public/tryon-3d
cp -r dist/* ../capri-storefront/public/tryon-3d/

cd ../capri-storefront
npm run build
