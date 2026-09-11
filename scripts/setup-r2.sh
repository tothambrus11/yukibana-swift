#!/usr/bin/env bash
# Create and configure the R2 bucket the toolchain is served from, and print the URL to
# pass as TOOLCHAIN_BASE_URL.
#
# The app fetches swift-frontend.wasm and friends from another origin, so the bucket has
# to allow CORS — without it WebAssembly.compileStreaming fails and the IDE reports a
# compile error that has nothing to do with the code being compiled.
#
# Usage: BUCKET=yukibana-toolchain ./scripts/setup-r2.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${BUCKET:=yukibana-toolchain}"

echo "==> creating bucket ${BUCKET} (ignored if it already exists)"
npx wrangler r2 bucket create "$BUCKET" || true

echo "==> applying CORS from infra/r2-cors.json"
npx wrangler r2 bucket cors set "$BUCKET" --file "${REPO_ROOT}/infra/r2-cors.json"

echo "==> enabling the r2.dev development URL"
npx wrangler r2 bucket dev-url enable "$BUCKET"

cat <<'MSG'

The r2.dev URL printed above works for a first test, but Cloudflare rate-limits it and
documents it as development-only. A cold visit to Yukibana pulls ~69 MiB from this
bucket, so production wants a custom domain:

  npx wrangler r2 bucket domain add <BUCKET> --domain toolchain.yourdomain.com

Then upload and point the app at whichever URL you chose:

  BUCKET=<BUCKET> ./scripts/upload-toolchain.sh
  # Cloudflare build settings: TOOLCHAIN_BASE_URL=https://<that-url>
MSG
