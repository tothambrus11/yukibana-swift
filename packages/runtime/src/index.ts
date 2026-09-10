export { VirtualFS } from "./vfs.js";
export { runWasi } from "./run.js";
export { untar } from "./tar.js";
export { WasmBackend } from "./wasm-backend.js";
export type { UntarOptions, UntarResult } from "./tar.js";
export type { RunOptions, RunResult } from "./run.js";
export {
  frontendArgs,
  linkArgs,
  parseDiagnostics,
  SYSROOT_ROOT,
  WASI_SYSROOT,
  SWIFT_RESOURCE_DIR,
  wasiSysroot,
  swiftResourceDir,
  STDLIB_LIBRARIES,
  TARGET_TRIPLE,
} from "./pipeline.js";
export type { FrontendOptions, LinkOptions } from "./pipeline.js";
export type { CompilerBackend, CompileRequest, CompileResult } from "./backend.js";
export type { Diagnostic } from "./pipeline.js";
