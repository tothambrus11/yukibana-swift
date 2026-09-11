# Prior art: Swift, WebAssembly, and compilers-in-the-browser

Research notes gathered while scoping Yukibana. Two independent problems have to be
solved, and the prior art for each is very different:

1. **Output half** — Swift *source* compiled to wasm that runs in a browser tab.
2. **Compiler half** — the Swift *compiler* itself running as wasm in a browser tab.

## 1. Output half — solved, upstream

| Effort | Status |
| --- | --- |
| [SwiftWasm](https://swiftwasm.org/) (community, 2019–) | Merged upstream; the org still ships snapshots and `carton` |
| [Swift SDKs for WebAssembly on swift.org](https://www.swift.org/documentation/articles/wasm-getting-started.html) | **Official since Swift 6.2**; artifact bundles installed with `swift sdk install` |
| Targets | `wasm32-unknown-wasip1` and `wasm32-unknown-wasip1-threads` (renamed from `wasm32-unknown-wasi`) |
| [JavaScriptKit](https://github.com/swiftwasm/JavaScriptKit) | Swift ↔ JS bridge for DOM access from wasm |
| [swiftwasm/carton](https://github.com/swiftwasm/carton) | Dev-server/bundler for SwiftWasm apps |

Consequences for us:

* We do **not** need to fork or patch anything to make user programs run in the browser.
  A stock `swift build --swift-sdk swift-6.3.x-RELEASE_wasm` produces a `wasm32-wasip1`
  module, and a JS WASI shim runs it.
* The toolchain and the Swift SDK versions must match **exactly** (6.1 onward enforces this).
* The Swift SDK artifact bundle is also the source of the prebuilt **target** stdlib
  (`.swiftmodule` + `.a` + `wasi-libc` + `libclang_rt`) that the in-browser compiler will
  need mounted in its virtual filesystem. This is a large, reusable asset — the same bytes
  serve the native cross-compile and the browser compile.

## 2. Compiler half — the actual research problem

### Reference implementation of the shape we want

[abiexplorer.org](https://abiexplorer.org) — "clang in your browser": a Vite + Monaco SPA
that loads **clang compiled to WebAssembly** and does all compilation client-side, no
server round-trip. That is exactly the UX target, but for C/C++.

Earlier work in the same lineage:

* [tbfleming/cib](https://github.com/tbfleming/cib) — clang + lld running in the browser (Emscripten era).
* [Wasmer: running Clang in the browser](https://wasmer.io/posts/clang-in-browser) — WASI-based clang.
* `wasi-sdk` itself is a clang that can be, and has been, retargeted to run *on* wasi.

So: **an LLVM-based compiler frontend can be built for a wasm host.** The C/C++ case is
proven repeatedly. Nothing about the Swift frontend makes it categorically different — it
is the same LLVM/Clang codebase plus the Swift frontend on top.

### What is *not* published (as of this research)

Searches across swift.org forums, the SwiftWasm org, and general web search surface **no
prebuilt `swift-frontend` targeting a wasm host**, and no "swiftc in the browser" project
built on the real compiler. Everything found compiles Swift *to* wasm from a native host:

* SwiftWasm Pad, SwiftFiddle, and swift.org's own playground all compile **server-side**.
* One Medium post describes a from-scratch Swift-subset compiler written in ~71k lines of C
  (no LLVM, no clang) that emits wasm in-browser. Impressive, but it is a reimplementation,
  not the real compiler — it will diverge on semantics, diagnostics, and stdlib coverage.
  We want the real `swift-frontend`, so this is not a base to build on.

**Conclusion: the compiler half is unexplored territory and is the load-bearing risk of
this project.** It should therefore be prototyped first (this is what the pipeline work
below does), not last.

### Known technical obstacles for `swift-frontend` on wasm32-wasip1

| Obstacle | Notes / mitigation |
| --- | --- |
| 4 GiB address space (wasm32) | LLVM/Swift are memory-hungry. Single-file compiles should fit; whole-module builds of large packages may not. Memory64 is not broadly shippable yet. |
| C++ exceptions | Swift/LLVM build with `-fno-exceptions` mostly, but LLVM's `Error` machinery and some deps need care; wasm EH is available in modern wasi-sdk. |
| Threads | Build single-threaded first (`LLVM_ENABLE_THREADS=OFF`); wasip1-threads only if needed. |
| `fork`/`exec` | The driver spawns `swift-frontend` and `wasm-ld` as subprocesses. In-browser we must drive `swift-frontend` **in-process** (frontend entry point, not the driver) and call `wasm-ld` as a separate wasm module. |
| Filesystem | WASI preopens backed by a JS in-memory FS holding the stdlib + user sources. |
| Build system | Swift's `build-script` assumes a native host. A wasm-host build is a **cross build**: native tblgen/host tools first, then the wasm-targeted compiler. |
| Binary size | clang.wasm is tens of MiB; `swift-frontend` will be larger. Needs compression + caching (`Cache-Control`, brotli, Origin Private FS). |

### Strategy that follows from the above

Build the pipeline bottom-up, smallest-risky-thing-first, so each stage is independently
demonstrable:

* **Stage 0** — stock Swift → wasm, run in the browser. Proves the output half end to end.
* **Stage 1** — a Swift-implemented tool (swift-syntax parser) compiled to wasm. Proves
  *Swift code that is compiler-adjacent* runs in the browser, and immediately powers
  editor features (syntax tree, diagnostics, formatting) with no server.
* **Stage 2** — cross-build LLVM + `lld` (`wasm-ld`) for a wasm host with wasi-sdk.
  `wasm-ld.wasm` is the smallest useful artifact of the compiler half and validates the
  whole cross-build approach before committing to the much bigger Swift frontend build.
* **Stage 3** — cross-build `swift-frontend` for a wasm host against that LLVM.
* **Stage 4** — Theia IDE wired to whichever stages are done, degrading gracefully to a
  server-side compile when the in-browser compiler is unavailable.

## Update — 2026-09-11: what changed after the prototype worked

A re-audit of upstream found that two of the claims above are now out of date. Both are
recorded here rather than edited away, because the original reasoning still explains why
the project was sequenced the way it was.

**"An LLVM-based compiler frontend can be built for a wasm host" understated the prior
art.** LLVM has a long-open PR for exactly this —
[llvm/llvm-project#92677, "Conditionalize use of POSIX features missing on
WASI/WebAssembly"](https://github.com/llvm/llvm-project/pull/92677) (whitequark, open
since May 2024, approved in principle, stalled on a design question about where WASI code
should live). The same author ships LLVM/clang/lld for `wasm32-wasip1` out of tree as
[YoWASP](https://www.npmjs.com/package/@yowasp/clang), currently LLVM 22.1.0, used by
Compiler Explorer among others. Ten of the nineteen LLVM files this project patches are
the same files that PR touches.

**"The compiler half is unexplored territory" is no longer true — for a different wasm
host.** In July 2026 upstream Swift landed an **Emscripten-hosted** toolchain effort on
`main` ([Swift for Wasm July 2026
updates](https://forums.swift.org/t/swift-for-wasm-july-2026-updates/88673)): 32-bit-safe
compiler data structures ([swift#90326](https://github.com/swiftlang/swift/pull/90326)),
optional immediate mode ([swift#90329](https://github.com/swiftlang/swift/pull/90329)),
an Emscripten libc module fix under C++ interop
([swift#90332](https://github.com/swiftlang/swift/pull/90332)), and CMake/build-script
support ([swift#90334](https://github.com/swiftlang/swift/pull/90334),
[swift#90337](https://github.com/swiftlang/swift/pull/90337)). Their host triple is
`wasm32-unknown-emscripten`; this project's is `wasm32-unknown-wasip1`, and Emscripten
emulates the POSIX process model that WASI simply does not have. So the two efforts
converge on the same 32-bit and alignment bugs and diverge completely on process, signal
and libc handling. A `wasm32-unknown-wasip1`-hosted `swift-frontend` still appears to be
without precedent, and none of the upstream work is on `release/6.3`, this project's base.

The full per-file audit — what is fixed upstream, what is reported, and what this project
found that nobody has reported — lives in the toolchain repository at
`docs/upstream-status.md`.

Also worth noting: the from-scratch Swift-subset compiler mentioned above now has a
forum thread, [MiniSwift](https://forums.swift.org/t/miniswift-swift-compiler-that-runs-in-the-browser-via-webassembly/85808).
The assessment stands — it is a reimplementation, not the real frontend.

## Sources

* <https://www.swift.org/documentation/articles/wasm-getting-started.html>
* <https://swiftwasm.org/> and <https://book.swiftwasm.org/>
* <https://github.com/swiftwasm/swift/releases>
* <https://forums.swift.org/t/swift-sdks-for-webassembly-now-available-on-swift-org/80405>
* <https://abiexplorer.org>
* <https://github.com/tbfleming/cib>
* <https://wasmer.io/posts/clang-in-browser>
* <https://forums.swift.org/t/swift-for-wasm-july-2026-updates/88673>
* <https://github.com/llvm/llvm-project/pull/92677>
* <https://www.npmjs.com/package/@yowasp/clang>
