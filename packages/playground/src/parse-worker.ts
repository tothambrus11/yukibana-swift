/// <reference lib="webworker" />
import { VirtualFS, runWasi } from "@yukibana/runtime";

/**
 * Language-service worker: keeps `swift-parse.wasm` compiled and answers parse
 * requests off the UI thread.
 *
 * The module is a WASI *command*, so each parse needs a fresh instance — but
 * `WebAssembly.Module` compilation, which is the expensive part for a 58 MiB module,
 * happens exactly once per tab.
 */

export interface ParseRequest {
  id: number;
  source: string;
}

export interface ParseResponse {
  id: number;
  ok: boolean;
  durationMs: number;
  result?: unknown;
  error?: string;
}

let modulePromise: Promise<WebAssembly.Module> | undefined;

function compiled(): Promise<WebAssembly.Module> {
  modulePromise ??= WebAssembly.compileStreaming(fetch("/swift-parse.wasm"));
  return modulePromise;
}

self.addEventListener("message", async (event: MessageEvent<ParseRequest>) => {
  const { id, source } = event.data;
  try {
    const module = await compiled();
    const run = await runWasi(module, {
      args: ["swift-parse.wasm"],
      fs: new VirtualFS(),
      stdin: source,
    });
    if (run.exitCode !== 0) {
      throw new Error(run.stderr.trim() || `swift-parse exited with ${run.exitCode}`);
    }
    const response: ParseResponse = {
      id,
      ok: true,
      durationMs: run.durationMs,
      result: JSON.parse(run.stdout),
    };
    self.postMessage(response);
  } catch (error) {
    const response: ParseResponse = {
      id,
      ok: false,
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
});
