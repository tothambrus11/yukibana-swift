import type {
  CompileRequest,
  CompileResult,
  CompilerBackend,
  Diagnostic,
} from "@yukibana/runtime";
import { VirtualFS, runWasi } from "@yukibana/runtime";

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
 * Until `swift-frontend.wasm` exists (Stage 3 of the pipeline), `ready()` rejects and
 * the IDE falls back to whichever other backend is registered.
 *
 * SPECULATIVE: the argument vectors below — the `-sdk` path, the `crt1.o` location, the
 * `-lswiftCore` link line — are written from how a native `swiftc` invokes these tools,
 * NOT verified against the Swift SDK artifact bundle's actual layout. They are a sketch
 * of the shape, and every path here must be checked against the real bundle before this
 * backend is trusted.
 */
export class WasmBackend implements CompilerBackend {
  readonly id = "wasm";
  readonly description: string;

  private toolchain?: Promise<{ frontend: WebAssembly.Module; linker: WebAssembly.Module }>;

  constructor(
    private readonly swiftVersion: string,
    private readonly toolchainUrl: string,
  ) {
    this.description = `in-browser (Swift ${swiftVersion})`;
  }

  ready(): Promise<void> {
    return this.load().then(() => undefined);
  }

  private load(): Promise<{ frontend: WebAssembly.Module; linker: WebAssembly.Module }> {
    // Compile the tools once per tab: for modules this size, compilation dominates.
    this.toolchain ??= (async () => {
      const [frontend, linker] = await Promise.all([
        WebAssembly.compileStreaming(fetch(`${this.toolchainUrl}/swift-frontend.wasm`)),
        WebAssembly.compileStreaming(fetch(`${this.toolchainUrl}/wasm-ld.wasm`)),
      ]);
      return { frontend, linker };
    })();
    return this.toolchain;
  }

  async compile(request: CompileRequest): Promise<CompileResult> {
    const started = Date.now();
    const { frontend, linker } = await this.load();

    const fs = new VirtualFS();
    for (const [path, contents] of Object.entries(request.sources)) {
      fs.writeFile(path, contents);
    }
    fs.mkdirp("/build");

    const sourcePaths = Object.keys(request.sources);
    const objects = sourcePaths.map((path) => `/build/${basename(path)}.o`);
    const log: string[] = [];

    for (const [index, source] of sourcePaths.entries()) {
      const frontendRun = await runWasi(frontend, {
        args: [
          "swift-frontend",
          "-frontend",
          "-c",
          ...sourcePaths,
          "-primary-file",
          source,
          "-target",
          "wasm32-unknown-wasip1",
          "-sdk",
          "/usr/share/wasi-sysroot",
          "-o",
          objects[index] as string,
          ...(request.extraArgs ?? []),
        ],
        fs,
      });
      log.push(frontendRun.stderr);
      if (frontendRun.exitCode !== 0) {
        return {
          success: false,
          diagnostics: parseDiagnostics(frontendRun.stderr),
          log: log.join(""),
          durationMs: Date.now() - started,
        };
      }
    }

    const linkRun = await runWasi(linker, {
      args: [
        "wasm-ld",
        "-o",
        "/build/program.wasm",
        "/usr/lib/swift/wasi/wasm32/crt1.o",
        ...objects,
        "-L/usr/lib/swift/wasi/wasm32",
        "-lswiftCore",
        "-lc",
        "--export-if-defined=main",
      ],
      fs,
    });
    log.push(linkRun.stderr);

    return {
      success: linkRun.exitCode === 0,
      wasm: linkRun.exitCode === 0 ? fs.readFile("/build/program.wasm") : undefined,
      diagnostics: parseDiagnostics(log.join("")),
      log: log.join(""),
      durationMs: Date.now() - started,
    };
  }
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `file:line:col: severity: message`, the format both the frontend and lld emit. */
export function parseDiagnostics(output: string): Diagnostic[] {
  const pattern = /^(.*?):(\d+):(\d+): (error|warning|note|remark): (.*)$/gm;
  const diagnostics: Diagnostic[] = [];
  for (const match of output.matchAll(pattern)) {
    diagnostics.push({
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
      severity: match[4] as Diagnostic["severity"],
      message: match[5] as string,
    });
  }
  return diagnostics;
}
