import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiagnostics } from "../lib/browser/wasm-backend.js";

test("parseDiagnostics reads the compiler's diagnostic format", () => {
  const output = [
    "/src/main.swift:3:9: error: cannot find 'foo' in scope",
    "/src/main.swift:7:1: warning: variable 'x' was never used",
    "wasm-ld: error: undefined symbol: bar",
    "/src/main.swift:9:5: note: did you mean 'far'?",
  ].join("\n");

  const diagnostics = parseDiagnostics(output);
  assert.equal(diagnostics.length, 3, "the linker line has no file:line:col and is skipped");
  assert.deepEqual(diagnostics[0], {
    file: "/src/main.swift",
    line: 3,
    column: 9,
    severity: "error",
    message: "cannot find 'foo' in scope",
  });
  assert.equal(diagnostics[1].severity, "warning");
  assert.equal(diagnostics[2].severity, "note");
});
