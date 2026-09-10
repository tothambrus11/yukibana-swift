import type { CompileRequest, CompileResult, CompilerBackend } from "@yukibana/runtime";
import { VirtualFS, frontendArgs, linkArgs, parseDiagnostics, runWasi, untar } from "@yukibana/runtime";

/**
 * Compiles Swift entirely inside the browser tab by driving the wasm toolchain.
 *
 * The pipeline mirrors what a native `swiftc` does, minus the driver: there is no
 * fork/exec under WASI, so each tool is invoked as its own wasm module against a shared
 * VirtualFS, and the frontend is given an explicit argument vector rather than being
 * spawned.
 *
 *   swift-frontend.wasm  -frontend -c main.swift  ->  /build/main.o
 *   wasm-ld.wasm         /build/main.o + stdlib   ->  /build/program.wasm
 *
 * Those argument vectors live in @yukibana/runtime's pipeline module, captured from a
 * real `swiftc -v` run and verified by replaying them against the packed sysroot.
 *
 * Until `swift-frontend.wasm` exists (Stage 3 of the pipeline), `ready()` rejects and
 * the IDE falls back to whichever other backend is registered.
 */
export class WasmBackend implements CompilerBackend {
  readonly id = "wasm";
  readonly description: string;

  private toolchain?: Promise<Toolchain>;

  constructor(
    private readonly swiftVersion: string,
    private readonly toolchainUrl: string,
  ) {
    this.description = `in-browser (Swift ${swiftVersion})`;
  }

  ready(): Promise<void> {
    return this.load().then(() => undefined);
  }

  private load(): Promise<Toolchain> {
    // Fetch and compile once per tab: for modules this size, compilation dominates, and
    // the sysroot is tens of megabytes that must not be re-unpacked per build.
    this.toolchain ??= (async () => {
      const [frontend, linker, sysrootArchive] = await Promise.all([
        WebAssembly.compileStreaming(fetch(`${this.toolchainUrl}/swift-frontend.wasm`)),
        WebAssembly.compileStreaming(fetch(`${this.toolchainUrl}/wasm-ld.wasm`)),
        fetch(`${this.toolchainUrl}/swift-sysroot-core.tar`).then((r) => r.arrayBuffer()),
      ]);
      return { frontend, linker, sysroot: new Uint8Array(sysrootArchive) };
    })();
    return this.toolchain;
  }

  async compile(request: CompileRequest): Promise<CompileResult> {
    const started = Date.now();
    const { frontend, linker, sysroot } = await this.load();

    const fs = new VirtualFS();
    untar(sysroot, fs, { prefix: "/sysroot", stripComponents: 0, readonly: true });
    for (const [path, contents] of Object.entries(request.sources)) {
      fs.writeFile(path, contents);
    }
    fs.mkdirp("/build");

    const sources = Object.keys(request.sources);
    const objects: string[] = [];
    const log: string[] = [];

    for (const source of sources) {
      const object = `/build/${basename(source)}.o`;
      const run = await runWasi(frontend, {
        args: frontendArgs({
          sources,
          primary: source,
          moduleName: "main",
          output: object,
          extraArgs: request.extraArgs,
        }),
        fs,
      });
      log.push(run.stderr);
      if (run.exitCode !== 0) {
        return {
          success: false,
          diagnostics: parseDiagnostics(log.join("")),
          log: log.join(""),
          durationMs: Date.now() - started,
        };
      }
      objects.push(object);
    }

    const link = await runWasi(linker, {
      args: linkArgs({ objects, output: "/build/program.wasm" }),
      fs,
    });
    log.push(link.stderr);

    return {
      success: link.exitCode === 0,
      wasm: link.exitCode === 0 ? fs.readFile("/build/program.wasm") : undefined,
      diagnostics: parseDiagnostics(log.join("")),
      log: log.join(""),
      durationMs: Date.now() - started,
    };
  }
}

interface Toolchain {
  frontend: WebAssembly.Module;
  linker: WebAssembly.Module;
  sysroot: Uint8Array;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
