/// <reference lib="webworker" />
import { WasmBackend } from "./wasm-backend.js";

/**
 * A self-contained compile worker, bundled to a single file so any page can run it as
 * `new Worker("/compile-worker.js", { type: "module" })`.
 *
 * Compiling has to happen off the UI thread. The toolchain is a 146 MiB module to
 * compile and a 99 MiB sysroot to unpack, and doing that inline does not merely jank the
 * interface — in a heavy page like the Theia shell it starves rendering badly enough that
 * the work appears never to finish.
 */

export interface CompileWorkerRequest {
  id: number;
  /** Source files by path; the first is treated as the primary. */
  sources: Record<string, string>;
  /** Where the toolchain artifacts are served from. Defaults to "/toolchain". */
  toolchainUrl?: string;
  swiftVersion?: string;
}

export interface CompileWorkerResponse {
  id: number;
  ok: boolean;
  /** Transferred, not copied, when compilation succeeded. */
  wasm?: ArrayBuffer;
  diagnostics: Array<{
    file?: string;
    line?: number;
    column?: number;
    severity: string;
    message: string;
  }>;
  log: string;
  durationMs: number;
  /** Set when the toolchain itself could not be loaded. */
  unavailable?: string;
}

let backend: WasmBackend | undefined;

self.addEventListener("message", async (event: MessageEvent<CompileWorkerRequest>) => {
  const { id, sources, toolchainUrl = "/toolchain", swiftVersion = "6.3.3" } = event.data;
  // One backend per worker: it caches the compiled tools and the unpacked sysroot.
  backend ??= new WasmBackend(swiftVersion, toolchainUrl);

  const fail = (message: string, unavailable = false): void => {
    const response: CompileWorkerResponse = {
      id,
      ok: false,
      diagnostics: [],
      log: unavailable ? "" : message,
      durationMs: 0,
      ...(unavailable ? { unavailable: message } : {}),
    };
    self.postMessage(response);
  };

  try {
    await backend.ready();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), true);
    return;
  }

  try {
    const result = await backend.compile({ sources });
    const wasm = result.wasm;
    const buffer = wasm
      ? (wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer)
      : undefined;
    const response: CompileWorkerResponse = {
      id,
      ok: result.success,
      wasm: buffer,
      diagnostics: result.diagnostics,
      log: result.log,
      durationMs: result.durationMs,
    };
    self.postMessage(response, buffer ? [buffer] : []);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
});
