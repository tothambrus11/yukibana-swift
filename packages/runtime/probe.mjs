import { readFile } from "node:fs/promises";
import { VirtualFS, runWasi, untar, frontendArgs } from "./dist/index.js";
const bin = "/home/user/yukibana-swift/toolchain/build/wasm-swift/bin/swift-frontend";
const sys = "/home/user/yukibana-swift/toolchain/out/swift-sysroot-core.tar";
const fs = new VirtualFS();
untar(new Uint8Array(await readFile(sys)), fs, { prefix: "/sysroot" });
fs.writeFile("/src/main.swift", process.env.SRC ?? 'print("hello")\n');
fs.mkdirp("/build"); fs.mkdirp("/build/modulecache"); fs.mkdirp("/tmp");
const args = frontendArgs({ sources: ["/src/main.swift"], primary: "/src/main.swift",
  moduleName: "main", output: "/build/main.o",
  extraArgs: ["-module-cache-path", "/build/modulecache"] });
try {
  const r = await runWasi(await readFile(bin), { args, fs, env: ["TMPDIR=/tmp","HOME=/tmp"] });
  console.log("exit", r.exitCode, "| object:", fs.exists("/build/main.o"));
  if (r.stderr) console.log(r.stderr.slice(0, 500));
} catch (e) { console.log("TRAP:", String(e).split("\n")[0]); }
