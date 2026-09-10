import { VirtualFS, runWasi } from "@yukibana/runtime";
import type { ParseRequest, ParseResponse } from "./parse-worker.js";
import type { CompileRequestMessage, CompileResponseMessage } from "./compile-worker.js";

const editor = document.getElementById("editor") as HTMLTextAreaElement;
const parseStatus = document.getElementById("parse-status") as HTMLSpanElement;
const diagnosticsList = document.getElementById("diagnostics") as HTMLUListElement;
const outlineList = document.getElementById("outline") as HTMLUListElement;
const outputEl = document.getElementById("output") as HTMLPreElement;
const runStatus = document.getElementById("run-status") as HTMLSpanElement;
const runButton = document.getElementById("run") as HTMLButtonElement;
const compileButton = document.getElementById("compile") as HTMLButtonElement;
const backendNote = document.getElementById("backend-note") as HTMLParagraphElement;

interface ParseOutput {
  ok: boolean;
  diagnostics: Array<{
    severity: string;
    message: string;
    position: { line: number; column: number };
    fixIts: string[];
  }>;
  declarations: Array<{ kind: string; name: string; position: { line: number } }>;
  statistics: { tokens: number; nodes: number; parseMilliseconds: number };
}

// --- language service ---------------------------------------------------------

const worker = new Worker(new URL("./parse-worker.ts", import.meta.url), { type: "module" });
let nextRequestId = 0;
let pendingRequestId = -1;
let debounce: ReturnType<typeof setTimeout> | undefined;

function li(className?: string): HTMLLIElement {
  const element = document.createElement("li");
  if (className) element.className = className;
  return element;
}

function renderEmpty(list: HTMLUListElement, message: string): void {
  list.replaceChildren(Object.assign(li("empty"), { textContent: message }));
}

function render(parse: ParseOutput): void {
  if (parse.diagnostics.length === 0) {
    renderEmpty(diagnosticsList, "No syntax errors.");
  } else {
    diagnosticsList.replaceChildren(
      ...parse.diagnostics.map((diagnostic) => {
        const item = li();
        const where = document.createElement("span");
        where.className = "where";
        where.textContent = `${diagnostic.position.line}:${diagnostic.position.column} `;
        const message = document.createElement("span");
        message.className = diagnostic.severity;
        message.textContent = `${diagnostic.severity}: ${diagnostic.message}`;
        item.append(where, message);
        for (const fixIt of diagnostic.fixIts) {
          const hint = document.createElement("div");
          hint.className = "fixit";
          hint.textContent = `fix-it: ${fixIt}`;
          item.append(hint);
        }
        return item;
      }),
    );
  }

  if (parse.declarations.length === 0) {
    renderEmpty(outlineList, "Nothing declared yet.");
  } else {
    outlineList.replaceChildren(
      ...parse.declarations.map((declaration) => {
        const item = li();
        const kind = document.createElement("span");
        kind.className = "kind";
        kind.textContent = `${declaration.kind} `;
        const name = document.createElement("span");
        name.textContent = declaration.name;
        const where = document.createElement("span");
        where.className = "where";
        where.textContent = `  line ${declaration.position.line}`;
        item.append(kind, name, where);
        return item;
      }),
    );
  }
}

worker.addEventListener("message", (event: MessageEvent<ParseResponse>) => {
  const response = event.data;
  // Ignore results for keystrokes the user has already typed past.
  if (response.id !== pendingRequestId) return;
  if (!response.ok) {
    parseStatus.textContent = `parser failed: ${response.error ?? "unknown error"}`;
    return;
  }
  const parse = response.result as ParseOutput;
  parseStatus.textContent =
    `${parse.statistics.tokens} tokens, ${parse.statistics.nodes} nodes` +
    ` — parsed in ${response.durationMs} ms`;
  render(parse);
});

function requestParse(): void {
  pendingRequestId = nextRequestId++;
  const request: ParseRequest = { id: pendingRequestId, source: editor.value };
  parseStatus.textContent = "parsing…";
  worker.postMessage(request);
}

editor.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(requestParse, 150);
});

// --- program execution --------------------------------------------------------

const decoder = new TextDecoder();
const appendOutput = (chunk: Uint8Array) => {
  outputEl.textContent += decoder.decode(chunk, { stream: true });
};

async function loadProgram(): Promise<void> {
  const wasm = await fetch("/hello.wasm").then((r) => r.arrayBuffer());
  // Compile once, instantiate per run: re-running a program is then instant.
  const module = await WebAssembly.compile(wasm);
  runStatus.textContent = `${(wasm.byteLength / 1024 / 1024).toFixed(1)} MiB module ready`;
  runButton.disabled = false;

  const run = async () => {
    runButton.disabled = true;
    outputEl.textContent = "";
    const result = await runWasi(module, {
      args: ["hello.wasm", "browser"],
      fs: new VirtualFS(),
      onStdout: appendOutput,
      onStderr: appendOutput,
    });
    runStatus.textContent = `exit ${result.exitCode} in ${result.durationMs} ms`;
    runButton.disabled = false;
  };

  runButton.addEventListener("click", run);
  await run();
}

// --- in-browser compilation ---------------------------------------------------

const compileWorker = new Worker(new URL("./compile-worker.ts", import.meta.url), {
  type: "module",
});
let nextCompileId = 0;
let pendingCompile: ((response: CompileResponseMessage) => void) | undefined;

compileWorker.addEventListener("message", (event: MessageEvent<CompileResponseMessage>) => {
  pendingCompile?.(event.data);
  pendingCompile = undefined;
});

function compile(source: string): Promise<CompileResponseMessage> {
  return new Promise((resolve) => {
    pendingCompile = resolve;
    const request: CompileRequestMessage = { id: nextCompileId++, source };
    compileWorker.postMessage(request);
  });
}

async function compileAndRun(): Promise<void> {
  compileButton.disabled = true;
  runButton.disabled = true;
  outputEl.textContent = "";
  runStatus.textContent = "compiling in this tab…";

  const result = await compile(editor.value);

  if (result.unavailable) {
    // The toolchain has not been built yet; say exactly that rather than failing oddly.
    runStatus.textContent = "toolchain not available";
    backendNote.textContent = result.unavailable;
    outputEl.textContent =
      "The in-browser toolchain is not built yet.\n" +
      "Run toolchain/scripts/20-llvm-wasm.sh, 30-swift-frontend-wasm.sh and\n" +
      "40-sysroot-pack.sh, then serve their output at /toolchain.\n\n" +
      '"Run prebuilt" still works — it needs no toolchain.';
    compileButton.disabled = false;
    runButton.disabled = false;
    return;
  }

  for (const diagnostic of result.diagnostics) {
    const where =
      diagnostic.line === undefined ? "" : `${diagnostic.line}:${diagnostic.column ?? 0}: `;
    outputEl.textContent += `${where}${diagnostic.severity}: ${diagnostic.message}\n`;
  }

  if (!result.ok || !result.wasm) {
    runStatus.textContent = `compilation failed in ${result.durationMs} ms`;
    if (result.diagnostics.length === 0) outputEl.textContent += result.log;
    compileButton.disabled = false;
    runButton.disabled = false;
    return;
  }

  runStatus.textContent = `compiled in ${result.durationMs} ms, running…`;
  const program = await runWasi(new Uint8Array(result.wasm), {
    args: ["main.wasm"],
    fs: new VirtualFS(),
    onStdout: appendOutput,
    onStderr: appendOutput,
  });
  runStatus.textContent =
    `compiled in ${result.durationMs} ms, exit ${program.exitCode} in ${program.durationMs} ms`;
  compileButton.disabled = false;
  runButton.disabled = false;
}

compileButton.addEventListener("click", () => {
  void compileAndRun();
});

async function main(): Promise<void> {
  editor.value = await fetch("/hello.swift").then((r) => r.text());
  requestParse();
  await loadProgram();
}

main().catch((error: unknown) => {
  runStatus.textContent = "failed";
  outputEl.textContent = String(error);
});
