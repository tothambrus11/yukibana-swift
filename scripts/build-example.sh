#!/usr/bin/env bash
# Stage 0 — compile the example Swift package to wasm with the official Swift SDK for
# WebAssembly and stage it for the playground.
#
# This is the "output half" of Yukibana: it needs no custom toolchain, only a stock
# Swift release plus a matching wasm SDK. The result is what the browser executes.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${SWIFT_VERSION:=6.3.3}"
: "${SWIFT_SDK:=swift-${SWIFT_VERSION}-RELEASE_wasm}"
: "${EXAMPLE:=hello}"

export PATH="${HOME}/.local/share/swiftly/bin:${PATH}"

command -v swift >/dev/null || { echo "swift not found; install it with swiftly" >&2; exit 1; }
swift sdk list | grep -qx "$SWIFT_SDK" || {
  echo "Swift SDK '$SWIFT_SDK' not installed. See docs/pipeline.md" >&2
  exit 1
}

cd "${REPO_ROOT}/examples/${EXAMPLE}"
swift build -c release --swift-sdk "$SWIFT_SDK"

DEST="${REPO_ROOT}/packages/playground/public"
mkdir -p "$DEST"
cp ".build/release/${EXAMPLE}.wasm" "${DEST}/hello.wasm"
cp "Sources/${EXAMPLE}/main.swift" "${DEST}/hello.swift"

printf 'staged %s (%s)\n' "${DEST}/hello.wasm" "$(du -h "${DEST}/hello.wasm" | cut -f1)"
