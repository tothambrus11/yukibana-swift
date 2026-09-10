#!/usr/bin/env bash
# Stage 10 — build the native LLVM host tools (TableGen) that the cross build needs.
#
# LLVM generates a large amount of C++ from .td files using llvm-tblgen, which must run
# on the *build* machine. Cross-building LLVM therefore always starts with a native
# build of just those generators.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"

BUILD_DIR="${YUKIBANA_BUILD}/host"

if [[ -x "${BUILD_DIR}/bin/llvm-tblgen" && -x "${BUILD_DIR}/bin/llvm-min-tblgen" ]]; then
  log "native tblgen already built"
  exit 0
fi

log "configuring native host tools"
cmake -G Ninja -S "${LLVM_SRC}/llvm" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_ENABLE_TERMINFO=OFF

log "building llvm-tblgen and llvm-min-tblgen with ${JOBS} jobs"
ninja -C "$BUILD_DIR" -j "$JOBS" llvm-tblgen llvm-min-tblgen

log "host tools at ${BUILD_DIR}/bin"
