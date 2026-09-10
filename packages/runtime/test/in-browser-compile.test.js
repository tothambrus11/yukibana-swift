import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  VirtualFS,
  runWasi,
  untar,
  frontendArgs,
  linkArgs,
  parseDiagnostics,
} from "../dist/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const out = `${repoRoot}/toolchain/out`;
const frontendPath = `${out}/swift-frontend.wasm`;
const linkerPath = `${out}/wasm-ld.wasm`;
const sysrootPath = `${out}/swift-sysroot-core.tar`;

const missing = [frontendPath, linkerPath, sysrootPath].filter((p) => !existsSync(p));

/**
 * The whole point of the project, in one test: Swift source compiled to wasm and then
 * executed, with every tool in the chain being itself a wasm module running under the
 * same WASI shim the browser uses. No native compiler is involved at any step.
 *
 * The frontend and the linker are separate modules invoked over a shared VirtualFS,
 * because WASI cannot spawn processes — the same reason the driver is bypassed and the
 * argument vectors are constructed explicitly.
 */
test(
  "Swift compiles and runs with an all-wasm toolchain",
  {
    skip:
      missing.length === 0
        ? false
        : `missing ${missing.map((p) => p.replace(`${repoRoot}/`, "")).join(", ")} ` +
          "(build with toolchain/scripts/20-llvm-wasm.sh, 30-swift-frontend-wasm.sh, 40-sysroot-pack.sh)",
    timeout: 900_000,
  },
  async () => {
    const fs = new VirtualFS();
    untar(new Uint8Array(await readFile(sysrootPath)), fs, {
      prefix: "/sysroot",
      readonly: true,
    });
    // Deliberately conformance-free: mangling protocol conformances still traps on a
    // 32-bit host, so print() and array literals are out (see the toolchain repo's
    // docs/status.md). What this test proves is the pipeline, not the language subset.
    fs.writeFile(
      "/src/main.swift",
      "let a = 6\nlet b = 7\nlet product = a * b\n",
    );
    fs.mkdirp("/build");
    fs.mkdirp("/build/modulecache");

    const [frontend, linker] = await Promise.all([
      WebAssembly.compile(await readFile(frontendPath)),
      WebAssembly.compile(await readFile(linkerPath)),
    ]);

    const compile = await runWasi(frontend, {
      args: frontendArgs({
        sources: ["/src/main.swift"],
        primary: "/src/main.swift",
        moduleName: "main",
        output: "/build/main.o",
        // Clang builds the SwiftShims module implicitly and needs somewhere to put it.
        extraArgs: ["-module-cache-path", "/build/modulecache"],
      }),
      fs,
      env: ["TMPDIR=/tmp", "HOME=/tmp"],
    });
    assert.equal(
      compile.exitCode,
      0,
      `swift-frontend.wasm failed:\n${compile.stderr}\n` +
        JSON.stringify(parseDiagnostics(compile.stderr), null, 2),
    );
    assert.ok(fs.exists("/build/main.o"), "the frontend produced no object file");

    const link = await runWasi(linker, {
      args: linkArgs({
        objects: ["/build/main.o"],
        output: "/build/program.wasm",
        // No main(): export the function instead and call it from the host.
      }),
      fs,
    });
    assert.equal(link.exitCode, 0, `wasm-ld.wasm failed:\n${link.stderr}`);

    // And the program the all-wasm pipeline produced actually runs.
    const program = await runWasi(fs.readFile("/build/program.wasm"), {
      args: ["program.wasm"],
      fs: new VirtualFS(),
    });
    assert.equal(program.exitCode, 0, `program failed: ${program.stderr}`);
  },
);
