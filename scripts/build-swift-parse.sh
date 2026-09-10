#!/usr/bin/env bash
# Stage 1 — cross-compile the swift-syntax based parser to wasm and stage it for the
# playground. swift-syntax is pure Swift, so this needs only the stock Swift SDK for
# WebAssembly: real Swift diagnostics in the browser, years before the full compiler.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${SWIFT_VERSION:=6.3.3}"
: "${SWIFT_SDK:=swift-${SWIFT_VERSION}-RELEASE_wasm}"
: "${WASI_SDK_PATH:=${REPO_ROOT}/toolchain/src/wasi-sdk-34.0-x86_64-linux}"

export PATH="${HOME}/.local/share/swiftly/bin:${PATH}"
command -v swift >/dev/null || { echo "swift not found; see docs/pipeline.md" >&2; exit 1; }

cd "${REPO_ROOT}/tools/swift-parse"
swift build -c release --swift-sdk "$SWIFT_SDK"

DEST="${REPO_ROOT}/packages/playground/public"
mkdir -p "$DEST"
cp .build/release/swift-parse.wasm "${DEST}/swift-parse.wasm"

# Debug info is roughly a third of the module and nothing in the browser reads it.
STRIP="${WASI_SDK_PATH}/bin/llvm-strip"
if [[ -x "$STRIP" ]]; then
  "$STRIP" "${DEST}/swift-parse.wasm"
else
  echo "note: wasi-sdk llvm-strip not found, shipping unstripped module" >&2
fi

printf 'staged %s (%s)\n' "${DEST}/swift-parse.wasm" "$(du -h "${DEST}/swift-parse.wasm" | cut -f1)"
