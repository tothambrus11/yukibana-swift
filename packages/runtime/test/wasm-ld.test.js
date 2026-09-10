import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VirtualFS, runWasi } from "../dist/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const linkerPath = `${repoRoot}/toolchain/out/wasm-ld.wasm`;
const wasiSdk = process.env.WASI_SDK_PATH ?? `${repoRoot}/toolchain/src/wasi-sdk-34.0-x86_64-linux`;
const sysroot = `${wasiSdk}/share/wasi-sysroot`;

/**
 * The Stage 2 payoff: LLVM's linker, itself compiled to wasm, links a real object file
 * into a real program — and that program then runs. Both steps happen inside this
 * process through the same WASI runner the browser uses, with no native tool involved
 * beyond producing the input object.
 */
test(
  "wasm-ld.wasm links an object file into a runnable program",
  {
    skip: existsSync(linkerPath)
      ? false
      : "toolchain/out/wasm-ld.wasm not built (run toolchain/scripts/20-lld-wasm.sh)",
    timeout: 300_000,
  },
  async () => {
    // Produce the input object natively; only the *linking* is under test here.
    const objectPath = "/tmp/yukibana-link-fixture.o";
    const sourcePath = "/tmp/yukibana-link-fixture.c";
    await writeFile(
      sourcePath,
      '#include <stdio.h>\nint main(void) { printf("linked by wasm-ld running as wasm\\n"); return 0; }\n',
    );
    execFileSync(`${wasiSdk}/bin/clang`, [
      "--target=wasm32-wasip1",
      "-O2",
      "-c",
      sourcePath,
      "-o",
      objectPath,
    ]);

    // The linker sees a filesystem holding its input, the C runtime and libc.
    const fs = new VirtualFS();
    fs.writeFile("/work/main.o", await readFile(objectPath));
    for (const lib of ["crt1.o", "libc.a"]) {
      fs.writeFile(`/lib/${lib}`, await readFile(`${sysroot}/lib/wasm32-wasip1/${lib}`));
    }
    const builtins = `${wasiSdk}/lib/clang`;
    const [clangVersion] = await readdir(builtins);
    fs.writeFile(
      "/lib/libclang_rt.builtins.a",
      await readFile(
        `${builtins}/${clangVersion}/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a`,
      ),
    );

    const link = await runWasi(await readFile(linkerPath), {
      args: [
        "wasm-ld",
        "/lib/crt1.o",
        "/work/main.o",
        "-L/lib",
        "-lc",
        "/lib/libclang_rt.builtins.a",
        "-o",
        "/work/program.wasm",
      ],
      fs,
    });

    assert.equal(link.exitCode, 0, `wasm-ld failed:\n${link.stderr}`);
    assert.ok(fs.exists("/work/program.wasm"), "linker produced no output");

    // And the linked program actually runs.
    const program = await runWasi(fs.readFile("/work/program.wasm"), {
      args: ["program.wasm"],
      fs: new VirtualFS(),
    });
    assert.equal(program.exitCode, 0, program.stderr);
    assert.equal(program.stdout, "linked by wasm-ld running as wasm\n");
  },
);
