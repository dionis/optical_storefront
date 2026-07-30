#!/usr/bin/env bash
# Install and verify the `tryon` extra (rembg background removal, Phase 6).
#
# Without it, process_product_images() still uploads the optimized WebP images
# but every try-on asset is skipped with:
#   [images] rembg failed for <url>: No module named 'rembg'
#
# Usage (from anywhere):
#   apps/scraper/scripts/setup_tryon.sh              # install + verify + warm model
#   apps/scraper/scripts/setup_tryon.sh --no-warm    # skip the u2net model download
#   apps/scraper/scripts/setup_tryon.sh --check      # verify only, install nothing
set -euo pipefail

SCRAPER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRAPER_DIR"

WARM_ARG="--warm"
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --no-warm) WARM_ARG="--no-warm" ;;
    --check) CHECK_ONLY=1 ;;
    *) echo "[tryon] Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# uv keeps the lockfile in sync and is what local dev uses; CI runners only have
# pip. Pick whichever is present so the same script works in both places.
if command -v uv >/dev/null 2>&1; then
  if [ "$CHECK_ONLY" -eq 0 ]; then
    echo "[tryon] Installing extra with uv (resolves and updates uv.lock)..."
    uv sync --extra tryon
  fi
  PYTHON=(uv run --no-sync python)
else
  if [ "$CHECK_ONLY" -eq 0 ]; then
    echo "[tryon] uv not found — falling back to pip."
    python -m pip install -e ".[tryon]"
  fi
  PYTHON=(python)
fi

echo "[tryon] Verifying the install..."
"${PYTHON[@]}" - "$WARM_ARG" <<'PY'
import io
import sys

from PIL import Image

try:
    import numpy
    import onnxruntime
    from rembg import remove
except ImportError as err:
    print(f"[tryon] FAIL: {err}")
    raise SystemExit(1)

print(f"[tryon] python        {sys.version.split()[0]}")
print(f"[tryon] numpy         {numpy.__version__}")
print(f"[tryon] onnxruntime   {onnxruntime.__version__}")

# numba-backed alpha matting has no wheels for numpy 2.5+, so assert the cap held
# here instead of discovering a broken resolution during a live sync.
if tuple(int(p) for p in numpy.__version__.split(".")[:2]) >= (2, 5):
    print("[tryon] FAIL: numpy >= 2.5 — incompatible with numba/pymatting.")
    raise SystemExit(1)

if sys.argv[1] == "--no-warm":
    print("[tryon] Import OK (model warm-up skipped)")
    raise SystemExit(0)

# The first remove() call downloads the u2net model (~175 MB) into ~/.u2net.
# Do it here so a real sync never pays the download mid-run.
print("[tryon] Warming the u2net model (first run downloads ~175 MB)...")
probe = Image.new("RGB", (64, 64), (200, 120, 60))
cutout = remove(probe)
buf = io.BytesIO()
cutout.save(buf, format="PNG")
print(f"[tryon] Background removal OK ({len(buf.getvalue())} bytes PNG, mode={cutout.mode})")
PY

echo "[tryon] Done."
