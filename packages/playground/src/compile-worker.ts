/// <reference lib="webworker" />
import { WasmBackend } from "@yukibana/runtime";

/**
 * Compile worker: drives swift-frontend.wasm and wasm-ld.wasm over a VirtualFS holding
 * the packed sysroot, off the UI thread.
 *
 * The toolchain is large — tens of megabytes of wasm plus a sysroot — so the backend
 * caches it for the lifetime of the worker and the page compiles once, then rebuilds
 * cheaply. When the artifacts have not been built, `ready()` rejects and the page says
 * so rather than failing silently.
 */

export interface CompileRequestMessage {
  id: number;
  source: string;
}

export interface CompileResponseMessage {
  id: number;
  ok: boolean;
  /** Present when compilation succeeded; transferred, not copied. */
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

const backend = new WasmBackend("6.3.3", "/toolchain");
const SOURCE_PATH = "/src/main.swift";

self.addEventListener("message", async (event: MessageEvent<CompileRequestMessage>) => {
  const { id, source } = event.data;
  const post = (message: CompileResponseMessage, transfer: Transferable[] = []) =>
    self.postMessage(message, transfer);

  try {
    await backend.ready();
  } catch (error) {
    post({
      id,
      ok: false,
      diagnostics: [],
      log: "",
      durationMs: 0,
      unavailable: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    const result = await backend.compile({ sources: { [SOURCE_PATH]: source } });
    const wasm = result.wasm;
    // Detach the buffer rather than copying a multi-megabyte module across the boundary.
    const buffer = wasm ? wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) : undefined;
    post(
      {
        id,
        ok: result.success,
        wasm: buffer as ArrayBuffer | undefined,
        diagnostics: result.diagnostics,
        log: result.log,
        durationMs: result.durationMs,
      },
      buffer ? [buffer as ArrayBuffer] : [],
    );
  } catch (error) {
    post({
      id,
      ok: false,
      diagnostics: [],
      log: error instanceof Error ? error.message : String(error),
      durationMs: 0,
    });
  }
});
