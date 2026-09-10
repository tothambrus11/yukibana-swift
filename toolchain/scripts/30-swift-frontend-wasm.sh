#!/usr/bin/env bash
# Stage 30 — cross-build `swift-frontend` for a wasm host.
#
# The CMake configure below is VERIFIED: it completes, and generates a build. The build
# itself has not yet been run to completion, because it needs Stage 20's clang and LLVM
# libraries; expect a patch series of its own beyond the one patch already required.
#
# What the configure established, by doing it rather than by reading:
#
#   * Swift's CMake already recognises WASI as a host — CMakeLists.txt maps
#     CMAKE_SYSTEM_NAME=WASI to SWIFT_HOST_VARIANT_SDK=WASI. Nothing has to be taught
#     that wasm-as-a-host is a concept.
#   * Pass BOOTSTRAPPING_MODE=BOOTSTRAPPING, not CROSSCOMPILE. Swift's CMake translates
#     the former to the latter when SWIFT_NATIVE_SWIFT_TOOLS_PATH is set; passing
#     CROSSCOMPILE directly skips the branch that sets SWIFT_EXEC_FOR_SWIFT_MODULES and
#     the configure fails with "Need a swift toolchain building swift compiler sources".
#     A native swiftc then builds the compiler's own Swift-implemented modules for the
#     wasm host — and Stage 0 already installs a native Swift that targets wasm.
#   * LLVM_TABLEGEN/CLANG_TABLEGEN must be passed explicitly. Without them, Swift insists
#     on an ${LLVM_BINARY_DIR}/NATIVE directory and aborts with "no native LLVM build
#     found", even though the native TableGen binaries exist elsewhere.
#   * cmark-gfm must be *built*, not just present in source form (Stage 15).
#   * One patch is required: SwiftCompilerSources unconditionally depends on an in-tree
#     swift-stdlib-wasi-wasm32 target when cross-compiling, which does not exist when the
#     host stdlib comes prebuilt from the SDK. See toolchain/patches/swift/.
#
# The known-hard part is NOT the build system. Macros and compiler plugins are
# implemented by spawning plugin executables, and WASI can spawn nothing (see
# WASI/Program.inc, which reports this rather than pretending). So SWIFT_BUILD_SWIFT_SYNTAX
# must be OFF, and macro support needs plugins redesigned as in-process wasm modules the
# embedder loads.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"

: "${SWIFT_SRC:=${YUKIBANA_SRC}/swift}"
: "${SWIFT_CMARK_SRC:=${YUKIBANA_SRC}/swift-cmark}"
: "${NATIVE_SWIFT_BIN:=${HOME}/.local/share/swiftly/toolchains/${SWIFT_VERSION}/usr/bin}"
: "${CMARK_INSTALL:=${YUKIBANA_BUILD}/wasm-cmark-install}"
# The prebuilt WASI sysroot from the Swift SDK: the compiler's own Swift modules are
# built against it, since the host stdlib is not built in this tree.
: "${SWIFT_WASM_SDK_SYSROOT:=${HOME}/.swiftpm/swift-sdks/${SWIFT_TAG}_wasm.artifactbundle/${SWIFT_TAG}_wasm/wasm32-unknown-wasip1/WASI.sdk}"

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
[[ -f "${CMARK_INSTALL}/lib/cmake/cmark-gfm-config.cmake" ]] ||
  die "run 15-cmark-wasm.sh first"

log "configuring swift-frontend for ${WASM_TARGET}"
cmake -G Ninja -S "${SWIFT_SRC}" -B "$SWIFT_BUILD" \
  -DCMAKE_TOOLCHAIN_FILE="${WASI_SDK_PATH}/share/cmake/wasi-sdk-p1.cmake" \
  -DWASI_SDK_PREFIX="${WASI_SDK_PATH}" \
  -DUNIX=1 \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_DIR="${LLVM_BUILD}/lib/cmake/llvm" \
  -DClang_DIR="${LLVM_BUILD}/lib/cmake/clang" \
  -DLLVM_TABLEGEN="${HOST_BIN}/llvm-tblgen" \
  -DCLANG_TABLEGEN="${HOST_BIN}/clang-tblgen" \
  -Dcmark-gfm_DIR="${CMARK_INSTALL}/lib/cmake" \
  -Dcmark-gfm-extensions_DIR="${CMARK_INSTALL}/lib/cmake" \
  -DSWIFT_PATH_TO_CMARK_SOURCE="${SWIFT_CMARK_SRC}" \
  -DSWIFT_PATH_TO_CMARK_BUILD="${YUKIBANA_BUILD}/wasm-cmark" \
  -DSWIFT_HOST_VARIANT_SDK=WASI \
  -DSWIFT_HOST_VARIANT_ARCH=wasm32 \
  -DSWIFT_WASI_SYSROOT_PATH="${SWIFT_WASM_SDK_SYSROOT}" \
  -DSWIFT_INCLUDE_TOOLS=ON \
  -DSWIFT_BUILD_STDLIB=OFF \
  -DSWIFT_BUILD_DYNAMIC_STDLIB=OFF \
  -DSWIFT_BUILD_STATIC_STDLIB=OFF \
  -DSWIFT_BUILD_REMOTE_MIRROR=OFF \
  -DSWIFT_BUILD_SOURCEKIT=OFF \
  -DSWIFT_INCLUDE_TESTS=OFF \
  -DSWIFT_INCLUDE_DOCS=OFF \
  -DSWIFT_BUILD_SWIFT_SYNTAX=OFF \
  -DSWIFT_ENABLE_SWIFT_IN_SWIFT=ON \
  -DBOOTSTRAPPING_MODE=BOOTSTRAPPING \
  -DSWIFT_NATIVE_SWIFT_TOOLS_PATH="${NATIVE_SWIFT_BIN}" \
  -DSWIFT_NATIVE_CLANG_TOOLS_PATH="${NATIVE_SWIFT_BIN}" \
  -DCMAKE_Swift_COMPILER="${NATIVE_SWIFT_BIN}/swiftc" \
  -DCMAKE_CXX_FLAGS="${WASI_EMULATION_DEFINES} -fno-exceptions" \
  -DCMAKE_EXE_LINKER_FLAGS="${WASI_EMULATION_LIBS} -Wl,-z,stack-size=${STACK_SIZE}"

log "building swift-frontend"
ninja -C "$SWIFT_BUILD" -j "$JOBS" swift-frontend

install -D "${SWIFT_BUILD}/bin/swift-frontend" "${YUKIBANA_OUT}/swift-frontend.wasm"
log "wrote ${YUKIBANA_OUT}/swift-frontend.wasm ($(du -h "${YUKIBANA_OUT}/swift-frontend.wasm" | cut -f1))"
