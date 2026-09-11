# Yukibana Swift

An online Swift IDE, built on [Theia](https://theia-ide.org/), where **both the compiler and the
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
| 3 | `swift-frontend` cross-built for a wasm host | **compiles Swift in the browser** |
| 4 | Theia IDE shell | **works** — compiles and runs Swift from the IDE |

A browser tab compiles Swift with `swift-frontend.wasm`, links it with `wasm-ld.wasm`,
and runs the result — no server involved:

```swift
struct Point: CustomStringConvertible {
  var x: Int, y: Int
  var description: String { "(\(x), \(y))" }
}
let points = (1...3).map { Point(x: $0, y: $0 * $0) }
print("points: \(points)")  // points: [(1, 1), (2, 4), (3, 9)]
```

That compiles in about two seconds in the tab and runs in 34 ms. Structs, protocol
conformances, generics, string interpolation, dictionaries and `print()` all work; the
tests assert the program's actual output rather than just an exit code.

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
