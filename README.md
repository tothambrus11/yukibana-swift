# Yukibana

An online Swift IDE in the shape of [abiexplorer.org](https://abiexplorer.org) ("clang in
your browser"), built on [Theia](https://theia-ide.org/), where **both the compiler and the
compiled program are WebAssembly running in the user's browser tab** — no compile server.

See [docs/pipeline.md](docs/pipeline.md) for how to build it,
[docs/architecture.md](docs/architecture.md) for the design, and
[docs/prior-art.md](docs/prior-art.md) for what already existed.

## Status

| Stage | What | State |
| --- | --- | --- |
| 0 | Swift source → `wasm32-wasip1`, executed in a browser tab | **works**, browser-tested |
| 1 | swift-syntax → wasm: parsing, diagnostics, outline in-tab | **works**, browser-tested |
| 2 | LLVM + clang + lld cross-built for a wasm host | building |
| 3 | `swift-frontend` cross-built for a wasm host | configures; C++ compiles; link pending Stage 2 |
| 4 | Theia IDE shell | extension written and typechecked; app not yet launched |

The compile pipeline itself — the exact `swift-frontend` and `wasm-ld` argument vectors
the browser replays — is captured and tested against a packed sysroot, so it is not
waiting on Stage 3: only the executor changes when `swift-frontend.wasm` exists.

Getting Swift's compiler to build for a wasm host surfaced three upstream bugs, written
up in [docs/pipeline.md](docs/pipeline.md): `LLVM_ABI`/`CLANG_ABI` vanish on wasm because
the export-macro chain tests `__WASM__`, which no compiler defines; Swift requires libuuid
on every non-Darwin, non-Windows host and silently finds the build machine's; and C++
interop is broken for `wasm32-unknown-wasip1` in the stock Swift 6.3.3 SDK.

## Layout

| Path | What |
| --- | --- |
| `docs/` | research and architecture notes |
| `packages/runtime/` | virtual filesystem, WASI runner, compiler-backend interface |
| `packages/playground/` | smallest end-to-end demo page |
| `packages/theia-yukibana/` | Theia extension: build-and-run command, in-browser compiler backend |
| `packages/ide/` | the Theia browser application |
| `tools/swift-parse/` | swift-syntax parser, cross-compiled to wasm |
| `toolchain/` | the build pipeline that produces the `.wasm` toolchain artifacts |
| `examples/` | Swift fixtures used by the pipeline tests |

## Quick start

```sh
cd packages/runtime && npm install && npm test
```
