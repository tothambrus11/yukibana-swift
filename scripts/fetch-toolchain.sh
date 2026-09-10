#!/usr/bin/env bash
# Fetch the wasm toolchain artifacts and stage them where the app serves them.
#
# The toolchain is built by a separate repository — tothambrus11/swift-toolchain-wasm —
# because cross-compiling LLVM, clang and the Swift frontend takes hours and has nothing
# to do with the IDE's own build. This pulls its published artifacts, so a contributor
# gets a working in-browser compiler without building one.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${TOOLCHAIN_REPO:=tothambrus11/swift-toolchain-wasm}"
: "${TOOLCHAIN_TAG:=latest}"
DEST="${REPO_ROOT}/packages/playground/public/toolchain"

# A local build of the toolchain repo takes precedence: this is the loop someone
# iterating on the compiler itself wants.
if [[ -n "${LOCAL_TOOLCHAIN_OUT:-}" ]]; then
  echo "staging from local build at ${LOCAL_TOOLCHAIN_OUT}"
  mkdir -p "$DEST"
  for artifact in swift-frontend.wasm wasm-ld.wasm swift-sysroot-core.tar; do
    if [[ -f "${LOCAL_TOOLCHAIN_OUT}/${artifact}" ]]; then
      cp "${LOCAL_TOOLCHAIN_OUT}/${artifact}" "${DEST}/"
      printf '  %s (%s)\n' "$artifact" "$(du -h "${DEST}/${artifact}" | cut -f1)"
    else
      echo "  missing ${artifact} — build it with the toolchain repo's scripts/build-all.sh" >&2
    fi
  done
  exit 0
fi

if [[ "$TOOLCHAIN_TAG" == "latest" ]]; then
  base="https://github.com/${TOOLCHAIN_REPO}/releases/latest/download"
else
  base="https://github.com/${TOOLCHAIN_REPO}/releases/download/${TOOLCHAIN_TAG}"
fi

mkdir -p "$DEST"
for artifact in swift-frontend.wasm wasm-ld.wasm swift-sysroot-core.tar; do
  echo "fetching ${artifact}"
  if ! curl -fsSL --retry 3 -o "${DEST}/${artifact}" "${base}/${artifact}"; then
    rm -f "${DEST}/${artifact}"
    cat >&2 <<MSG

Could not fetch ${artifact} from ${base}.

No release has been published yet if the toolchain build is still running. The page
works without it — "Run prebuilt" needs no toolchain — and "Compile & Run" will say
what is missing. To build the toolchain yourself:

  git clone https://github.com/${TOOLCHAIN_REPO}
  cd swift-toolchain-wasm && ./scripts/build-all.sh
  LOCAL_TOOLCHAIN_OUT=\$PWD/out $0

MSG
    exit 1
  fi
  printf '  %s (%s)\n' "$artifact" "$(du -h "${DEST}/${artifact}" | cut -f1)"
done

echo "staged in ${DEST}"
