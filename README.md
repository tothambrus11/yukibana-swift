# Yukibana

An online Swift IDE in the shape of [abiexplorer.org](https://abiexplorer.org) ("clang in
your browser"), built on [Theia](https://theia-ide.org/), where **both the compiler and the
compiled program are WebAssembly running in the user's browser tab** — no compile server.

Status: **prototyping the wasm build pipeline.** See [docs/architecture.md](docs/architecture.md)
for the target design and [docs/prior-art.md](docs/prior-art.md) for what already exists.

## Layout

| Path | What |
| --- | --- |
| `docs/` | research and architecture notes |
| `packages/runtime/` | virtual filesystem, WASI runner, compiler-backend interface |
| `toolchain/` | the build pipeline that produces the `.wasm` toolchain artifacts |
| `examples/` | Swift fixtures used by the pipeline tests |

## Quick start

```sh
cd packages/runtime && npm install && npm test
```
