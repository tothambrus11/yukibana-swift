#!/usr/bin/env bash
# Stage 30 — cross-build `swift-frontend` for a wasm host.  *** NOT YET EXECUTED ***
#
# This script encodes what the Swift build system says is required, derived by reading
# swiftlang/swift @ swift-6.3.3-RELEASE. It has not been run to completion; treat every
# flag here as researched-but-unverified, and expect a patch series of its own.
#
# What the research established (see docs/pipeline.md for the full write-up):
#
#   * Swift's CMake ALREADY recognises WASI as a host: CMakeLists.txt maps
#     CMAKE_SYSTEM_NAME=WASI to SWIFT_HOST_VARIANT_SDK=WASI. Nothing has to be taught
#     that wasm-as-a-host is a concept.
#   * There is a documented cross-compile path for the Swift-implemented parts of the
#     compiler: set SWIFT_NATIVE_SWIFT_TOOLS_PATH to a previously built native toolchain
#     and BOOTSTRAPPING_MODE=CROSSCOMPILE, and the native swiftc builds the compiler's
#     Swift modules for the target host. We have exactly that: a native Swift 6.3.3 that
#     can target wasm32-unknown-wasip1.
#   * swift-frontend embeds ClangImporter, so clang must be cross-built too — which is
#     why Stage 20 builds "clang;lld" into the tree this stage consumes.
#
# The known-hard part is NOT the build system. It is that macros and compiler plugins
# are implemented by spawning plugin executables, and WASI has no way to spawn anything
# (see toolchain/patches — Program.inc reports this rather than pretending). So the first
# working configuration must have SWIFT_BUILD_SWIFT_SYNTAX=OFF, and an in-browser
# compiler will not support macros until plugins are redesigned as in-process wasm
# modules the embedder loads.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"

: "${SWIFT_SRC:=${YUKIBANA_SRC}/swift}"
: "${SWIFT_CMARK_SRC:=${YUKIBANA_SRC}/swift-cmark}"
: "${NATIVE_SWIFT_BIN:=${HOME}/.local/share/swiftly/bin}"

LLVM_BUILD="${YUKIBANA_BUILD}/wasm-llvm"   # produced by 20-llvm-wasm.sh
SWIFT_BUILD="${YUKIBANA_BUILD}/wasm-swift"
HOST_BIN="${YUKIBANA_BUILD}/host/bin"

[[ -d "${SWIFT_SRC}" ]] || die "swift sources missing; extend 00-fetch-sources.sh"
[[ -x "${HOST_BIN}/llvm-tblgen" ]] || die "run 10-host-tools.sh first"
command -v "${NATIVE_SWIFT_BIN}/swiftc" >/dev/null 2>&1 ||
  warn "no native swiftc at ${NATIVE_SWIFT_BIN}; CROSSCOMPILE bootstrapping will fail"

WASI_EMULATION_DEFINES="-D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID"
WASI_EMULATION_LIBS="-lwasi-emulated-mman -lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-getpid"
STACK_SIZE=16777216

# --- 1. LLVM + clang + lld for the wasm host ----------------------------------
# Built by Stage 20; this stage only checks it is there.
[[ -d "${LLVM_BUILD}/lib/cmake/llvm" ]] ||
  die "run 20-llvm-wasm.sh with LLVM_PROJECTS='clang;lld' first"

# --- 2. swift-frontend --------------------------------------------------------
log "configuring swift-frontend for ${WASM_TARGET}"
cmake -G Ninja -S "${SWIFT_SRC}" -B "$SWIFT_BUILD" \
  -DCMAKE_TOOLCHAIN_FILE="${WASI_SDK_PATH}/share/cmake/wasi-sdk-p1.cmake" \
  -DWASI_SDK_PREFIX="${WASI_SDK_PATH}" \
  -DUNIX=1 \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_DIR="${LLVM_BUILD}/lib/cmake/llvm" \
  -DClang_DIR="${LLVM_BUILD}/lib/cmake/clang" \
  -DSWIFT_PATH_TO_CMARK_SOURCE="${SWIFT_CMARK_SRC}" \
  -DSWIFT_HOST_VARIANT_SDK=WASI \
  -DSWIFT_HOST_VARIANT_ARCH=wasm32 \
  -DSWIFT_INCLUDE_TOOLS=ON \
  -DSWIFT_BUILD_STDLIB=OFF \
  -DSWIFT_BUILD_STDLIB_EXTRA_TOOLCHAIN_CONTENT=OFF \
  -DSWIFT_BUILD_DYNAMIC_STDLIB=OFF \
  -DSWIFT_BUILD_STATIC_STDLIB=OFF \
  -DSWIFT_BUILD_REMOTE_MIRROR=OFF \
  -DSWIFT_BUILD_SOURCEKIT=OFF \
  -DSWIFT_INCLUDE_TESTS=OFF \
  -DSWIFT_INCLUDE_DOCS=OFF \
  -DSWIFT_BUILD_SWIFT_SYNTAX=OFF \
  -DSWIFT_ENABLE_SWIFT_IN_SWIFT=ON \
  -DBOOTSTRAPPING_MODE=CROSSCOMPILE \
  -DSWIFT_NATIVE_SWIFT_TOOLS_PATH="${NATIVE_SWIFT_BIN}" \
  -DCMAKE_CXX_FLAGS="${WASI_EMULATION_DEFINES} -fno-exceptions" \
  -DCMAKE_EXE_LINKER_FLAGS="${WASI_EMULATION_LIBS} -Wl,-z,stack-size=${STACK_SIZE}"

log "building swift-frontend"
ninja -C "$SWIFT_BUILD" -j "$JOBS" swift-frontend

install -D "${SWIFT_BUILD}/bin/swift-frontend" "${YUKIBANA_OUT}/swift-frontend.wasm"
log "wrote ${YUKIBANA_OUT}/swift-frontend.wasm"
