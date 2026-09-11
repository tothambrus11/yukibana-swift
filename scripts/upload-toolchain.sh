#!/usr/bin/env bash
# Upload the wasm toolchain to an R2 bucket, compressed and correctly labelled.
#
# The artifacts are ~300 MiB raw and ~72 MiB gzipped, and every visitor pays that on a
# cold load, so they are uploaded pre-compressed. The trick is to store the *gzipped
# bytes* under the *plain* object name with Content-Encoding: gzip — the browser then
# decompresses transparently and still sees Content-Type: application/wasm, which is
# what WebAssembly.compileStreaming requires. Uploading them as "*.gz" instead would
# make the app fetch a file it has to decompress itself, wasting a full copy in memory.
#
# Usage: BUCKET=yukibana-toolchain ./scripts/upload-toolchain.sh [source-dir]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-${REPO_ROOT}/packages/playground/public/toolchain}"
: "${BUCKET:?set BUCKET to the R2 bucket name}"
: "${CACHE_CONTROL:=public, max-age=31536000, immutable}"

content_type() {
  case "$1" in
    *.wasm) echo "application/wasm" ;;
    *.tar)  echo "application/x-tar" ;;
    *)      echo "application/octet-stream" ;;
  esac
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for artifact in swift-frontend.wasm wasm-ld.wasm swift-sysroot-core.tar; do
  path="${SRC}/${artifact}"
  [[ -f "$path" ]] || { echo "missing ${path} — run scripts/fetch-toolchain.sh first" >&2; exit 1; }

  gzip -9 -c "$path" > "${work}/${artifact}"
  raw=$(du -m "$path" | cut -f1)
  packed=$(du -m "${work}/${artifact}" | cut -f1)
  printf 'uploading %-24s %4s MB -> %3s MB\n' "$artifact" "$raw" "$packed"

  npx wrangler r2 object put "${BUCKET}/${artifact}" \
    --file "${work}/${artifact}" \
    --content-type "$(content_type "$artifact")" \
    --content-encoding gzip \
    --cache-control "$CACHE_CONTROL" \
    --remote
done

cat <<MSG

Uploaded to ${BUCKET}. Two settings still have to be right on the bucket itself:

  * CORS must allow the site's origin, or compileStreaming fails cross-origin.
  * The bucket needs a public URL (r2.dev or a custom domain) to pass to
    TOOLCHAIN_BASE_URL when staging the app.
MSG
