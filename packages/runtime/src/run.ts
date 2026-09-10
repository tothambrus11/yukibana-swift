import { ConsoleStdout, File, OpenFile, WASI, WASIProcExit } from "@bjorn3/browser_wasi_shim";
import { VirtualFS } from "./vfs.js";

export interface RunOptions {
  /** argv, including argv[0]. */
  args?: string[];
  /** Environment as `KEY=value` strings. */
  env?: string[];
  /** Filesystem the module sees at `/`. Created empty when omitted. */
  fs?: VirtualFS;
  /** Bytes fed to the module's stdin. */
  stdin?: Uint8Array | string;
  /** Called with each raw stdout chunk, in addition to being captured. */
  onStdout?: (chunk: Uint8Array) => void;
  /** Called with each raw stderr chunk, in addition to being captured. */
  onStderr?: (chunk: Uint8Array) => void;
  /** Extra imports merged into the instance, e.g. a JavaScriptKit bridge. */
  imports?: WebAssembly.Imports;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The filesystem after the run, so callers can pick up produced artifacts. */
  fs: VirtualFS;
  /** Wall-clock duration of instantiate + start, in milliseconds. */
  durationMs: number;
}

class Collector {
  private readonly chunks: Uint8Array[] = [];
  constructor(private readonly forward?: (chunk: Uint8Array) => void) {}
  push(chunk: Uint8Array): void {
    // The shim hands out views over wasm memory, which is reused after the call.
    this.chunks.push(chunk.slice());
    this.forward?.(chunk);
  }
  text(): string {
    const total = this.chunks.reduce((n, c) => n + c.byteLength, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(joined);
  }
}

/**
 * Run one `wasm32-wasip1` command module to completion.
 *
 * This is the single execution primitive in Yukibana: the Swift frontend, `wasm-ld`
 * and the user's own program are all just WASI command modules invoked through here,
 * differing only in argv and in which filesystem they are handed.
 */
export async function runWasi(
  wasm: BufferSource | WebAssembly.Module,
  options: RunOptions = {},
): Promise<RunResult> {
  const fs = options.fs ?? new VirtualFS();
  const stdinBytes =
    typeof options.stdin === "string" ? new TextEncoder().encode(options.stdin) : options.stdin;

  const out = new Collector(options.onStdout);
  const err = new Collector(options.onStderr);

  const fds = [
    new OpenFile(new File(stdinBytes ?? new Uint8Array())),
    new ConsoleStdout((chunk: Uint8Array) => out.push(chunk)),
    new ConsoleStdout((chunk: Uint8Array) => err.push(chunk)),
    fs.preopen("/"),
  ];

  const wasi = new WASI(options.args ?? ["main.wasm"], options.env ?? [], fds, { debug: false });

  const started = Date.now();
  const module =
    wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm as BufferSource);
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
    ...(options.imports ?? {}),
  });

  let exitCode = 0;
  try {
    exitCode = wasi.start(instance as never);
  } catch (e) {
    if (e instanceof WASIProcExit) exitCode = e.code;
    else throw e;
  }

  return {
    exitCode,
    stdout: out.text(),
    stderr: err.text(),
    fs,
    durationMs: Date.now() - started,
  };
}
