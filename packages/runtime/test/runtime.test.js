import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { VirtualFS, runWasi } from "../dist/index.js";

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

test("VirtualFS round-trips files and directories", () => {
  const fs = VirtualFS.from({ "/src/main.swift": "print(1)", "/src/util/a.swift": "let a = 1" });
  assert.equal(fs.readTextFile("/src/main.swift"), "print(1)");
  assert.deepEqual(fs.readDir("/src"), ["main.swift", "util"]);
  assert.deepEqual(fs.walk("/src"), ["/src/main.swift", "/src/util/a.swift"]);
  assert.ok(fs.isDirectory("/src/util"));
  fs.unlink("/src/main.swift");
  assert.equal(fs.exists("/src/main.swift"), false);
});

test("runWasi executes a wasip1 command module and captures its streams", async () => {
  const fs = new VirtualFS();
  fs.mkdirp("/out");
  const result = await runWasi(await readFile(fixture("hello-c.wasm")), {
    args: ["hello.wasm", "yukibana"],
    fs,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello from yukibana\n");
  assert.equal(result.stderr, "stderr works\n");
  // Files the module wrote are visible to the host afterwards: this is how compiled
  // object files and the linked program come back out of the compiler workers.
  assert.equal(fs.readTextFile("/out/greeting.txt"), "written by wasm\n");
});

test("runWasi reports a non-zero exit status instead of throwing", async () => {
  const result = await runWasi(await readFile(fixture("hello-c.wasm")), {
    args: ["hello.wasm"],
    fs: new VirtualFS(), // no /out, so the program's fopen fails
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /fopen/);
});
