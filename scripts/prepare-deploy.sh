#!/usr/bin/env bash
# Assemble the deployable static site for the IDE.
#
# Two things must not go to the static host:
#
#   * the wasm toolchain — 146 MiB, 99 MiB and 57 MiB files, against Cloudflare's
#     25 MiB per-file cap. It belongs in object storage (R2), fetched at runtime;
#   * source maps — 44 MiB and 42 MiB, over the same cap, and of no use in production.
#
# What is left is ~30 MiB of app, every file well under the limit.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-ide}"
SRC="${REPO_ROOT}/packages/${APP}/lib/frontend"
[[ "$APP" == "playground" ]] && SRC="${REPO_ROOT}/packages/${APP}/dist"
DEST="${REPO_ROOT}/packages/${APP}/deploy"

# Where the browser fetches swift-frontend.wasm, wasm-ld.wasm and the sysroot from.
# Same-origin "/toolchain" is the default and works for a local static server; a real
# deployment points this at an R2 bucket (which must send CORS headers).
: "${TOOLCHAIN_BASE_URL:=/toolchain}"

[[ -d "$SRC" ]] || { echo "no build at ${SRC} — run the app's build first" >&2; exit 1; }

rm -rf "$DEST"
mkdir -p "$DEST"

# Copy everything except the two categories that cannot be hosted.
# *.map.gz too: a production build pre-compresses its source maps, and those are just
# as useless in production as the maps themselves — 15 MiB of them here.
tar -C "$SRC" --exclude='toolchain' --exclude='*.map' --exclude='*.map.gz' -cf - . \
  | tar -C "$DEST" -xf -

# Without this the app loads and then fails on the first compile with a 404.
[[ -f "${DEST}/compile-worker.js" ]] ||
  { echo "error: compile-worker.js missing from the build — run the app's build" >&2; exit 1; }

# The app reads this at startup, so the toolchain can move without a rebuild.
printf '{\n  "baseUrl": "%s"\n}\n' "$TOOLCHAIN_BASE_URL" > "${DEST}/toolchain.json"

oversized="$(find "$DEST" -type f -size +25M)"
if [[ -n "$oversized" ]]; then
  echo "error: files over Cloudflare's 25 MiB per-file limit:" >&2
  echo "$oversized" >&2
  exit 1
fi

printf 'staged %s (%s, %s files), toolchain at %s\n' \
  "$DEST" "$(du -sh "$DEST" | cut -f1)" "$(find "$DEST" -type f | wc -l)" "$TOOLCHAIN_BASE_URL"
