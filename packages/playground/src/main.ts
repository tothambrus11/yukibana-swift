import { VirtualFS, runWasi } from "@yukibana/runtime";
import type { ParseRequest, ParseResponse } from "./parse-worker.js";

const editor = document.getElementById("editor") as HTMLTextAreaElement;
const parseStatus = document.getElementById("parse-status") as HTMLSpanElement;
const diagnosticsList = document.getElementById("diagnostics") as HTMLUListElement;
const outlineList = document.getElementById("outline") as HTMLUListElement;
const outputEl = document.getElementById("output") as HTMLPreElement;
const runStatus = document.getElementById("run-status") as HTMLSpanElement;
const runButton = document.getElementById("run") as HTMLButtonElement;

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

async function main(): Promise<void> {
  editor.value = await fetch("/hello.swift").then((r) => r.text());
  requestParse();
  await loadProgram();
}

main().catch((error: unknown) => {
  runStatus.textContent = "failed";
  outputEl.textContent = String(error);
});
