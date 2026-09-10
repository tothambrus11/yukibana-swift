# The toolchain lives in its own repository

Building the Swift compiler for a wasm host — `swift-frontend.wasm`, `wasm-ld.wasm` and
the browser sysroot — is hours of LLVM and clang cross-compilation with its own patch
series, and it moves on a completely different schedule from this IDE. It lives here:

**<https://github.com/tothambrus11/swift-toolchain-wasm>**

To get a working in-browser compiler without building one:

```sh
./scripts/fetch-toolchain.sh
```

That downloads the published artifacts into `packages/playground/public/toolchain/`,
which is where the page's `WasmBackend` looks for them.

To iterate on the compiler itself, build the toolchain repo and point this one at it:

```sh
git clone https://github.com/tothambrus11/swift-toolchain-wasm
cd swift-toolchain-wasm && ./scripts/build-all.sh
LOCAL_TOOLCHAIN_OUT=$PWD/out /path/to/yukibana-swift/scripts/fetch-toolchain.sh
```

The argument vectors this IDE replays to drive those tools are in
`packages/runtime/src/pipeline.ts`, and the toolchain repo documents them from the other
side in `docs/consuming.md`. They are captured from a real `swiftc -v` run and tested, so
the two stay honest about the same contract.
