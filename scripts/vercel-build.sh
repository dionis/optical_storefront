#!/bin/bash
set -e

cd apps/vto-web
npm install
VITE_TRYON_BASE=/tryon-3d/ VITE_VISION_API_BASE=/medusa npm run build
mkdir -p ../capri-storefront/public/tryon-3d
cp -r dist/* ../capri-storefront/public/tryon-3d/

cd ../capri-storefront
npm install
npm run build
