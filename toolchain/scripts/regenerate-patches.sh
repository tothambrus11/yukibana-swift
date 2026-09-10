#!/usr/bin/env bash
# Development helper: snapshot the working tree of the LLVM checkout back into the
# patch series, so fixes made while debugging a build become reproducible inputs.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"

OUT="${YUKIBANA_ROOT}/toolchain/patches/llvm/0001-wasi-host-support.patch"
cd "$LLVM_SRC"
git diff > "$OUT"
log "wrote ${OUT} ($(grep -c '^--- a/' "$OUT") files, $(wc -l < "$OUT") lines)"
