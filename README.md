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
| 2 | LLVM + clang + lld cross-built for a wasm host | **works** — `wasm-ld.wasm` links and the program runs |
| 3 | `swift-frontend` cross-built for a wasm host | **compiles Swift in the browser**, for a language subset |
| 4 | Theia IDE shell | extension written and typechecked; app not yet launched |

A browser tab now compiles Swift with `swift-frontend.wasm` and links it with
`wasm-ld.wasm` in about 1.4 seconds, and runs the result in 20 ms — no server involved.

**The language subset is real and worth stating.** Integers, functions, structs and string
literals compile. `print()` and array literals do not: mangling protocol conformances
traps on a 32-bit host, almost certainly the same pointer-packing class as two bugs
already fixed. The toolchain repo's
[docs/status.md](https://github.com/tothambrus11/swift-toolchain-wasm/blob/main/docs/status.md)
records exactly where the line is and what has been ruled out.

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
