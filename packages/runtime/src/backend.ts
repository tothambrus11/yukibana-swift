/**
 * The seam between the IDE and however Swift actually gets compiled.
 *
 * Two implementations are planned: `WasmBackend`, which drives `swift-frontend.wasm`
 * and `wasm-ld.wasm` inside a worker, and `RemoteBackend`, which posts sources to a
 * server running the native toolchain. The IDE only ever sees this interface, so the
 * in-browser compiler can land incrementally without touching the editor layer.
 */
export interface CompilerBackend {
  readonly id: string;
  /** Human-readable, e.g. "in-browser (Swift 6.3.3)". Shown in the IDE status bar. */
  readonly description: string;
  /** Resolves once the backend is ready to accept compiles (toolchain fetched, etc.). */
  ready(): Promise<void>;
  compile(request: CompileRequest): Promise<CompileResult>;
}

export interface CompileRequest {
  /** Source files by path, e.g. `{"/src/main.swift": "print(1)"}`. */
  sources: Record<string, string>;
  /** Extra arguments forwarded to the Swift frontend. */
  extraArgs?: string[];
  /** Cancellation for long compiles. */
  signal?: AbortSignal;
}

export interface CompileResult {
  success: boolean;
  /** The linked program, when compilation succeeded. */
  wasm?: Uint8Array;
  diagnostics: Diagnostic[];
  /** Raw compiler output, for the build log pane. */
  log: string;
  durationMs: number;
}

export interface Diagnostic {
  file?: string;
  line?: number;
  column?: number;
  severity: "error" | "warning" | "note" | "remark";
  message: string;
}
