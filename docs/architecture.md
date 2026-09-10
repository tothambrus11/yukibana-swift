# Yukibana architecture

Yukibana is an online Swift IDE in the shape of [abiexplorer.org](https://abiexplorer.org)
("clang in your browser"), built on the [Theia](https://theia-ide.org/) framework, where
**both the compiler and the compiled program are WebAssembly running in the user's tab**.

No compile server. A cold page load fetches a toolchain; everything after that is local.

## Target picture

```
┌───────────────────────────── browser tab ──────────────────────────────┐
│  Theia IDE shell (Monaco editor, explorer, terminal, problems view)     │
│      │                                                                 │
│      │ LSP-ish messages over postMessage                               │
│      ▼                                                                 │
│  ┌──────────── Worker: language services ────────────┐                 │
│  │  swift-syntax.wasm — parse, diagnostics, format   │  ← Stage 1      │
│  └───────────────────────────────────────────────────┘                 │
│      │                                                                 │
│  ┌──────────── Worker: compile pipeline ─────────────┐                 │
│  │  swift-frontend.wasm  ──emits──▶  object files    │  ← Stage 3      │
│  │  wasm-ld.wasm         ──links──▶  program.wasm    │  ← Stage 2      │
│  │  backed by VirtualFS (stdlib artifact bundle +    │                 │
│  │  user sources), persisted in OPFS/IndexedDB       │                 │
│  └───────────────────────────────────────────────────┘                 │
│      │                                                                 │
│  ┌──────────── Worker: program sandbox ──────────────┐                 │
│  │  program.wasm under a WASI shim; stdout/stderr →  │  ← Stage 0      │
│  │  IDE terminal; same VirtualFS, read-only mount    │                 │
│  └───────────────────────────────────────────────────┘                 │
└────────────────────────────────────────────────────────────────────────┘
```

## Design decisions

**Use the real Swift compiler, not a reimplementation.** A Swift-subset compiler written
from scratch would ship sooner and then diverge forever on semantics, diagnostics, generics
and stdlib coverage. Yukibana cross-compiles the upstream `swift-frontend` to a wasm host.
That is the harder path and the reason the pipeline is prototyped first.

**Drive the frontend in-process; never the driver.** `swiftc` is a driver that `fork`/`exec`s
`swift-frontend` and a linker. There is no `fork` under WASI. Yukibana calls the frontend
entry point directly with an explicit argument vector (`-frontend -c ...`), and invokes
`wasm-ld` as a *separate* wasm module. This mirrors how clang-in-browser projects work.

**One virtual filesystem, three consumers.** The compiler workers, the language-service
worker and the program sandbox all address the same `VirtualFS` (an in-memory tree, backed
by OPFS for persistence). The Swift SDK artifact bundle — stdlib `.swiftmodule`s, `.a`
archives, wasi-libc, `libclang_rt` — is mounted read-only under `/usr/lib/swift`. This is
also what makes "compile in the browser" cheap after the first load: the toolchain and
stdlib are cached, only user files change.

**Target `wasm32-unknown-wasip1` for user programs**, threads variant only when a program
needs concurrency. It is the target the official Swift SDK ships, so user output uses a
stock, supported configuration.

**Graceful degradation.** Every stage is useful on its own, and the IDE is written against
a `CompilerBackend` interface with two implementations: `WasmBackend` (in-tab) and
`RemoteBackend` (a server running the native toolchain). Until Stage 3 lands, the IDE is
fully usable on the remote backend, and the wasm backend is swapped in behind the same
interface. This also keeps a fallback for compiles that exceed wasm32's 4 GiB ceiling.

## Repository layout

```
docs/            research + architecture notes
toolchain/       the wasm build pipeline (Docker + scripts) that produces the .wasm tools
packages/
  runtime/       TypeScript: VirtualFS, WASI shim, program runner, compiler backends
  playground/    minimal Vite app — the smallest thing that proves the pipeline end to end
  ide/           Theia-based IDE (added once the backends are stable)
examples/        Swift sample programs used as fixtures by the pipeline tests
```

## Staging

| Stage | Deliverable | Risk |
| --- | --- | --- |
| 0 | Swift → `wasm32-wasip1`, executed in a browser tab via WASI shim | low — stock toolchain |
| 1 | `swift-syntax` compiled to wasm; parse/diagnose/format in-tab | low |
| 2 | `wasm-ld.wasm` — LLVM/lld cross-built for a wasm host | **high** — validates the whole approach |
| 3 | `swift-frontend.wasm` | **highest** — see below |
| 4 | Theia IDE shell wired to the backends | medium |

Stage 3 is larger than "Stage 2 plus the Swift frontend", and the scope should be
stated plainly rather than hidden behind the word "risk":

* `swift-frontend` embeds **ClangImporter**, so clang has to be cross-built for the wasm
  host too. Stage 2 builds only lld and the WebAssembly target; Stage 3 multiplies the
  build.
* Modern `swift-frontend` contains **Swift-implemented components**, so building it for a
  wasm host needs a Swift compiler that targets a wasi *host*. The Swift SDK for
  WebAssembly plausibly supplies this, but nothing in the prior art confirms anyone has
  done it.
* wasm32 caps a module at **4 GiB of address space**. Single-file compiles should fit;
  whole-module builds of large packages may not, which is the other reason the
  `RemoteBackend` fallback exists.

Stages 2 and 3 are long builds (hours of CPU). The pipeline is therefore written as
reproducible scripts + a Dockerfile that run identically on a laptop, in this container,
and on a CI runner, with each stage's output cached as a release artifact.
