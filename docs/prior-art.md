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

## Sources

* <https://www.swift.org/documentation/articles/wasm-getting-started.html>
* <https://swiftwasm.org/> and <https://book.swiftwasm.org/>
* <https://github.com/swiftwasm/swift/releases>
* <https://forums.swift.org/t/swift-sdks-for-webassembly-now-available-on-swift-org/80405>
* <https://abiexplorer.org>
* <https://github.com/tbfleming/cib>
* <https://wasmer.io/posts/clang-in-browser>
