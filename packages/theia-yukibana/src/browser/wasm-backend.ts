// The in-browser compiler backend lives in @yukibana/runtime, so that it can be used
// without Theia — the playground drives the same class. Re-exported here for the
// extension's own imports.
export { WasmBackend } from "@yukibana/runtime";
