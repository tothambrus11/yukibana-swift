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

## Stages 2 and 3 — the compiler itself, in its own repository

Cross-building LLVM, clang and `swift-frontend` for a wasm host moved to
**<https://github.com/tothambrus11/swift-toolchain-wasm>**, which builds and publishes
`swift-frontend.wasm`, `wasm-ld.wasm` and the browser sysroot. It carries the patch
series, the resumable CI, and the write-ups of the three upstream bugs the port surfaced
(`LLVM_ABI`/`CLANG_ABI` vanishing on wasm, Swift's libuuid requirement finding the build
machine's library, and C++ interop being broken for `wasm32-unknown-wasip1`).

To use the published artifacts here:

```sh
./scripts/fetch-toolchain.sh
```

## The compile pipeline, captured

`packages/runtime/src/pipeline.ts` holds the argument vectors the browser replays. They
were captured from a real `swiftc -target wasm32-unknown-wasip1 -v` run and verified by
replaying them by hand — frontend, then `wasm-ld`, no driver in between — against the
sysroot `40-sysroot-pack.sh` produces. Two things the driver does that Yukibana drops:

* `swift-autolink-extract`, which reads the object file's autolink section to decide
  which libraries to link. Its answer for a wasm target is a fixed list, which is inlined.
* `-plugin-path` / `-in-process-plugin-server-path`, the macro plumbing above.

One correction the capture forced: sources are listed **once**, with `-primary-file`
marking the one being compiled. Listing the primary twice is a duplicate-input error.
