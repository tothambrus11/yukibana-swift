#!/usr/bin/env bash
# Stage 20 — cross-build LLVM + lld so that `wasm-ld` itself runs on a wasm host.
#
# This is the smallest useful piece of the compiler half, and it is deliberately the
# first thing built: it exercises every hard part of the cross build (no threads, no
# fork/exec, WASI filesystem, C++ on wasi-libc, LLVM's platform layer) on a target that
# takes tens of minutes rather than hours. If wasm-ld.wasm links a real object file,
# the same approach carries the Swift frontend.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"

BUILD_DIR="${YUKIBANA_BUILD}/wasm-lld"
HOST_BIN="${YUKIBANA_BUILD}/host/bin"

[[ -x "${HOST_BIN}/llvm-tblgen" ]] || die "run 10-host-tools.sh first"
[[ -x "${WASI_SDK_PATH}/bin/clang" ]] || die "run 00-fetch-sources.sh first"

# wasi-libc provides mman/signal/process-clocks/getpid only as opt-in emulation
# libraries; LLVM's Support layer uses all four.
WASI_EMULATION_DEFINES="-D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID"
WASI_EMULATION_LIBS="-lwasi-emulated-mman -lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-getpid"

# 16 MiB of stack: LLVM's recursive descent over IR and lld's graph walks overflow the
# 64 KiB wasm default long before they do anything interesting.
STACK_SIZE=16777216

# LLVM's platform detection only knows Win32/Unix/Generic, and wasi-sdk's CMake
# platform module sets neither, so configuration aborts with "Unable to determine
# platform". wasi-libc is POSIX-shaped, which is what LLVM_ON_UNIX actually means
# here, so declare it rather than patching HandleLLVMOptions.cmake.
log "configuring lld for ${WASM_TARGET}"
cmake -G Ninja -S "${LLVM_SRC}/llvm" -B "$BUILD_DIR" \
  -DCMAKE_TOOLCHAIN_FILE="${WASI_SDK_PATH}/share/cmake/wasi-sdk-p1.cmake" \
  -DWASI_SDK_PREFIX="${WASI_SDK_PATH}" \
  -DUNIX=1 \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_ENABLE_PROJECTS=lld \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_NATIVE_TOOL_DIR="${HOST_BIN}" \
  -DLLVM_DEFAULT_TARGET_TRIPLE="${WASM_TARGET}" \
  -DLLVM_HOST_TRIPLE="${WASM_TARGET}" \
  -DLLVM_ENABLE_THREADS=OFF \
  -DLLVM_ENABLE_PIC=OFF \
  -DLLVM_ENABLE_ZLIB=OFF \
  -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_ENABLE_TERMINFO=OFF \
  -DLLVM_ENABLE_LIBPFM=OFF \
  -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF \
  -DLLVM_ENABLE_BACKTRACES=OFF \
  -DLLVM_ENABLE_UNWIND_TABLES=OFF \
  -DLLVM_BUILD_TOOLS=OFF \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_UTILS=OFF \
  -DLLVM_TOOL_LLVM_DRIVER_BUILD=OFF \
  -DCMAKE_CXX_FLAGS="${WASI_EMULATION_DEFINES} -fno-exceptions" \
  -DCMAKE_C_FLAGS="${WASI_EMULATION_DEFINES}" \
  -DCMAKE_EXE_LINKER_FLAGS="${WASI_EMULATION_LIBS} -Wl,-z,stack-size=${STACK_SIZE}"

log "building lld with ${JOBS} jobs (expect tens of minutes)"
ninja -C "$BUILD_DIR" -j "$JOBS" lld

install -D "${BUILD_DIR}/bin/lld" "${YUKIBANA_OUT}/wasm-ld.wasm"
log "wrote ${YUKIBANA_OUT}/wasm-ld.wasm ($(du -h "${YUKIBANA_OUT}/wasm-ld.wasm" | cut -f1))"
