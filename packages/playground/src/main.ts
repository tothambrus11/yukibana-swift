import { VirtualFS, runWasi } from "@yukibana/runtime";

const sourceEl = document.getElementById("source") as HTMLPreElement;
const outputEl = document.getElementById("output") as HTMLPreElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const runButton = document.getElementById("run") as HTMLButtonElement;

const decoder = new TextDecoder();
const append = (chunk: Uint8Array) => {
  outputEl.textContent += decoder.decode(chunk, { stream: true });
};

async function main(): Promise<void> {
  statusEl.textContent = "fetching program…";
  const [source, wasm] = await Promise.all([
    fetch("/hello.swift").then((r) => r.text()),
    fetch("/hello.wasm").then((r) => r.arrayBuffer()),
  ]);
  sourceEl.textContent = source;

  // Compile once, run many: WebAssembly.Module is reusable across runs, which is what
  // makes re-running a program in the IDE instant.
  const module = await WebAssembly.compile(wasm);
  statusEl.textContent = `${(wasm.byteLength / 1024).toFixed(0)} KiB module ready`;
  runButton.disabled = false;

  runButton.addEventListener("click", async () => {
    runButton.disabled = true;
    outputEl.textContent = "";
    const result = await runWasi(module, {
      args: ["hello.wasm", "browser"],
      fs: new VirtualFS(),
      onStdout: append,
      onStderr: append,
    });
    statusEl.textContent = `exit ${result.exitCode} in ${result.durationMs} ms`;
    runButton.disabled = false;
  });

  runButton.click();
}

main().catch((error: unknown) => {
  statusEl.textContent = "failed";
  outputEl.textContent = String(error);
});
