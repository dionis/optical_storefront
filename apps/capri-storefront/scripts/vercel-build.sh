#!/bin/bash
set -e

# Which backend this build talks to. vercel.json is the same on every branch and
# rewrites /medusa → production, /medusa-staging → staging and /medusa-t-<slug> →
# each new optician's backend; backend-target.mjs picks the prefix (tenant, then
# BACKEND_TARGET_OVERRIDE, then the branch: develop/main → /medusa). Outside Vercel
# nothing is set and the app keeps its local defaults (/medusa + the Vite proxy).
if [ -n "$VERCEL" ]; then
  # An assignment, not `read <<< "$(…)"`: the assignment carries node's exit
  # status, so set -e stops the build when backend-target.mjs throws (bad
  # BACKEND_TARGET_OVERRIDE, missing TENANT_FILE on tenant-deploy, no domains.api).
  TARGET_LINE="$(node backend-target.mjs)"
  read -r VITE_BACKEND_TARGET VITE_BACKEND_PROXY BACKEND_DECIDED_BY <<< "$TARGET_LINE"
  export VITE_BACKEND_TARGET VITE_BACKEND_PROXY
  # A deliberate switch (BACKEND_TARGET_OVERRIDE in the Vercel project) is said
  # out loud in the build log, so nobody wonders why a live branch is on staging.
  if [ "$BACKEND_DECIDED_BY" = "override" ]; then
    echo "vercel-build: WARNING — BACKEND_TARGET_OVERRIDE=$BACKEND_TARGET_OVERRIDE sends this build to '$VITE_BACKEND_TARGET' ($VITE_BACKEND_PROXY) whatever the branch. Delete the variable and redeploy to return to the branch rule." >&2
  fi

  # Last line of defense: a branch that serves customers must use the production
  # prefix (unless the explicit override says otherwise). Failing here keeps the
  # previous deployment live.
  case "$VERCEL_GIT_COMMIT_REF" in
    develop|main) LIVE=1 ;;
    *) LIVE=$([ "$VERCEL_ENV" = "production" ] && echo 1 || echo 0) ;;
  esac
  # Another optician (TENANT_FILE in its Vercel project): only its own prefix.
  if [ "$VITE_BACKEND_TARGET" = "tenant" ]; then
    case "$VITE_BACKEND_PROXY" in
      /medusa-t-*) ;;
      *) echo "vercel-build: tenant build got proxy '$VITE_BACKEND_PROXY'. Aborting." >&2; exit 1 ;;
    esac
  elif [ "$BACKEND_DECIDED_BY" = "override" ]; then
    if [ "$VITE_BACKEND_PROXY" != "/medusa-staging" ]; then
      echo "vercel-build: override build got proxy '$VITE_BACKEND_PROXY' (expected /medusa-staging). Aborting." >&2
      exit 1
    fi
  elif [ "$LIVE" = "1" ] && { [ "$VITE_BACKEND_TARGET" != "production" ] || [ "$VITE_BACKEND_PROXY" != "/medusa" ]; }; then
    echo "vercel-build: branch '$VERCEL_GIT_COMMIT_REF' ($VERCEL_ENV) serves customers but targets '$VITE_BACKEND_TARGET' ($VITE_BACKEND_PROXY). Aborting." >&2
    exit 1
  fi
  if [ -z "$VITE_BACKEND_PROXY" ]; then
    echo "vercel-build: backend-target.mjs gave no proxy path. Aborting." >&2
    exit 1
  fi
  echo "vercel-build: branch '$VERCEL_GIT_COMMIT_REF' ($VERCEL_ENV) → backend '$VITE_BACKEND_TARGET' via $VITE_BACKEND_PROXY (decided by: $BACKEND_DECIDED_BY)"
fi

cd ../vto-web
npm install
VITE_TRYON_BASE=/tryon-3d/ VITE_VISION_API_BASE="${VITE_BACKEND_PROXY:-/medusa}" npm run build
mkdir -p ../capri-storefront/public/tryon-3d
cp -r dist/* ../capri-storefront/public/tryon-3d/

cd ../capri-storefront
# robots.txt + sitemap.xml from the current catalog (scripts/gen-seo.mjs).
node scripts/gen-seo.mjs
npm run build
