# The Yukibana build pipeline

Everything Yukibana ships is produced by scripts in `toolchain/` and `scripts/`. Each
stage is independently runnable, idempotent, and cached, because the later stages take
hours and nobody should have to rerun the earlier ones to retry them.

## Prerequisites

* Linux x86_64, ~40 GB free disk, and patience (Stage 2+ are LLVM-sized builds).
* `cmake`, `ninja`, `git`, `curl`, a host C++ compiler.
* Node 22+ for the runtime and playground packages.
* A Swift toolchain, for Stage 0 and Stage 1 only:

```sh
curl -fsSL https://download.swift.org/swiftly/linux/swiftly-x86_64.tar.gz | tar xz
./swiftly init -y --skip-install
swiftly install 6.3.3 --use
swift sdk install \
  https://download.swift.org/swift-6.3.3-release/wasm-sdk/swift-6.3.3-RELEASE/swift-6.3.3-RELEASE_wasm.artifactbundle.tar.gz \
  --checksum cabfa08b73bb8ac783927ecd15fa386e99d0c139c5f232445067bcf58379cae7
```

The toolchain and SDK versions must match exactly; Swift enforces this from 6.1 onward.

## Stage 0 — Swift source to wasm (the output half)

```sh
./scripts/build-example.sh
cd packages/playground && npm install && npm test
```

Compiles `examples/hello` with the official Swift SDK for WebAssembly, stages the module
for the playground, and drives a real Chromium against it. This half needs no custom
toolchain at all — it is stock Swift.

## Stage 1 — Swift tooling to wasm (parsing in the browser)

```sh
./scripts/build-swift-parse.sh
```

Cross-compiles `tools/swift-parse` — a swift-syntax based parser that reads Swift on
stdin and writes JSON diagnostics and an outline on stdout — to `wasm32-wasip1`. Because
swift-syntax is itself written in Swift, this needs nothing but the same stock SDK, and
it gives the editor real Swift diagnostics before the full compiler exists.

## Stage 2 — LLVM and lld on a wasm host (the compiler half)

```sh
cd toolchain
./scripts/00-fetch-sources.sh   # wasi-sdk + swiftlang/llvm-project @ swift-6.3.3-RELEASE
./scripts/05-apply-patches.sh   # the wasi-host patch series
./scripts/10-host-tools.sh      # native llvm-tblgen (a cross build always needs these)
./scripts/20-lld-wasm.sh        # -> toolchain/out/wasm-ld.wasm
```

This is the first stage that produces a *compiler tool that itself runs as wasm*, and it
is deliberately the smallest such tool. `wasm-ld` exercises every hard part of the cross
build — no threads, no `fork`, no signals, WASI's filesystem, LLVM's platform layer on
wasi-libc — at a size that finishes in under an hour rather than most of a day.

### The patch series

`toolchain/patches/llvm/` holds the changes LLVM needs to build for a wasm host. They all
have the same cause: a POSIX facility that does not exist on `wasm32-wasip1`.

| Area | Why |
| --- | --- |
| `ADT/bit.h` | wasi-libc has `<endian.h>`; LLVM's list of platforms that do simply omits wasi |
| `CrashRecoveryContext` | no `setjmp`/`longjmp` without the EH proposal, and no signals. A wasm trap tears down the instance, so crash recovery cannot work anyway |
| `LockFileManager` | no `getsid` |
| `ProgramStack` | no `getrlimit` |
| `Unix/Unix.h` | no `<sys/wait.h>` — nothing to wait for without processes |
| `Unix/Watchdog.inc` | no `alarm` |
| `raw_socket_stream` | `sockaddr_un` exists but has no `sun_path`; nothing in a browser listens on a socket |

Each is guarded on `__wasi__`, so a native build of the same tree is unaffected and the
patches stay small enough to upstream. Regenerate them after editing the checkout with
`toolchain/scripts/regenerate-patches.sh`.

### Notable configuration choices

* `-DUNIX=1` — LLVM's platform detection knows only Win32, Unix and "Generic", and
  wasi-sdk's CMake platform module sets none of them. wasi-libc is POSIX-shaped, which is
  what `LLVM_ON_UNIX` actually selects.
* `LLVM_ENABLE_THREADS=OFF` — keeps the build to plain `wasm32-wasip1`, so the page needs
  no `SharedArrayBuffer` and therefore no COOP/COEP headers.
* `-Wl,-z,stack-size=16777216` — the wasm default stack is 64 KiB; LLVM's recursive
  passes overflow it immediately.
* `_WASI_EMULATED_MMAN/SIGNAL/PROCESS_CLOCKS/GETPID` — wasi-libc ships these only as
  opt-in emulation libraries, and LLVM's Support layer uses all four.

## Stage 3 — `swift-frontend` on a wasm host

Not yet implemented. It builds on Stage 2's LLVM and adds the Swift frontend; the driver
is deliberately not used, because there is no `fork`/`exec` under WASI — see
[architecture.md](architecture.md).
