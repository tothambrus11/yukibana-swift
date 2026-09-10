import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VirtualFS, runWasi, frontendArgs, linkArgs, parseDiagnostics } from "../dist/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sysrootTar = `${repoRoot}/toolchain/out/swift-sysroot-core.tar`;
const nativeTools = `${process.env.HOME}/.local/share/swiftly/toolchains/6.3.3/usr/bin`;

test("parseDiagnostics reads the compiler's diagnostic format", () => {
  const output = [
    "/src/main.swift:3:9: error: cannot find 'foo' in scope",
    "/src/main.swift:7:1: warning: variable 'x' was never used",
    "wasm-ld: error: undefined symbol: bar",
  ].join("\n");
  const diagnostics = parseDiagnostics(output);
  assert.equal(diagnostics.length, 2, "the linker line has no file:line:col and is skipped");
  assert.deepEqual(diagnostics[0], {
    file: "/src/main.swift",
    line: 3,
    column: 9,
    severity: "error",
    message: "cannot find 'foo' in scope",
  });
});

test("frontendArgs and linkArgs carry the flags the driver actually passes", () => {
  const frontend = frontendArgs({
    sources: ["/src/main.swift"],
    primary: "/src/main.swift",
    moduleName: "main",
    output: "/build/main.o",
  });
  // wasm has no Objective-C runtime, and the stdlib in the SDK is the static one.
  assert.deepEqual(
    frontend.slice(0, 5),
    ["swift-frontend", "-frontend", "-c", "-primary-file", "/src/main.swift"],
    "each source appears once, with -primary-file marking the one being compiled",
  );
  assert.ok(frontend.includes("-disable-objc-interop"));
  assert.ok(frontend.includes("-use-static-resource-dir"));
  assert.ok(frontend.includes("-no-color-diagnostics"));
  // The driver's macro plumbing must NOT be here: plugins are spawned processes.
  assert.ok(!frontend.some((arg) => arg.startsWith("-plugin-path")));
  assert.ok(!frontend.includes("-in-process-plugin-server-path"));

  const link = linkArgs({ objects: ["/build/main.o"], output: "/build/program.wasm" });
  assert.ok(link.includes("-lswiftCore"));
  // swiftrt.o and crt1 are positional and must precede the objects.
  assert.ok(link.findIndex((a) => a.endsWith("crt1-command.o")) < link.indexOf("/build/main.o"));
  assert.ok(link.findIndex((a) => a.endsWith("swiftrt.o")) < link.indexOf("/build/main.o"));
  assert.ok(link.includes("--threads=1"), "the toolchain is built without threads");
});

/**
 * The argument vectors above are only worth anything if they really compile and link.
 * This runs them against the packed sysroot — the same files and the same layout the
 * browser mounts — driving the *native* frontend and linker. When swift-frontend.wasm
 * lands, only the executor changes: same argv, runWasi instead of execFile.
 */
test(
  "the captured pipeline compiles and links against the packed sysroot",
  {
    skip:
      existsSync(sysrootTar) && existsSync(`${nativeTools}/swift-frontend`)
        ? false
        : "needs toolchain/out/swift-sysroot-core.tar (40-sysroot-pack.sh) and a native Swift 6.3.3",
    timeout: 600_000,
  },
  async () => {
    const work = "/tmp/yukibana-pipeline-test";
    rmSync(work, { recursive: true, force: true });
    mkdirSync(`${work}/sysroot`, { recursive: true });
    mkdirSync(`${work}/build`, { recursive: true });
    execFileSync("tar", ["-xf", sysrootTar, "-C", `${work}/sysroot`]);

    const source = `${work}/main.swift`;
    await writeFile(source, 'let items = [3, 1, 2].sorted()\nprint("sorted: \\(items)")\n');

    const frontend = frontendArgs({
      sources: [source],
      primary: source,
      moduleName: "main",
      output: `${work}/build/main.o`,
      sysrootRoot: `${work}/sysroot`,
    });
    execFileSync(`${nativeTools}/swift-frontend`, frontend.slice(1), { stdio: "pipe" });

    const link = linkArgs({
      objects: [`${work}/build/main.o`],
      output: `${work}/build/program.wasm`,
      sysrootRoot: `${work}/sysroot`,
    });
    execFileSync(`${nativeTools}/wasm-ld`, link.slice(1), { stdio: "pipe" });

    // And the program the pipeline produced runs under the same WASI shim the IDE uses.
    const run = await runWasi(await readFile(`${work}/build/program.wasm`), {
      args: ["program.wasm"],
      fs: new VirtualFS(),
    });
    assert.equal(run.exitCode, 0, run.stderr);
    assert.equal(run.stdout, "sorted: [1, 2, 3]\n");
  },
);
