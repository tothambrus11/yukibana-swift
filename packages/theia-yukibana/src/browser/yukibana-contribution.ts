import { inject, injectable } from "@theia/core/shared/inversify";
import { Command, CommandContribution, CommandRegistry, MessageService } from "@theia/core/lib/common";
import { MenuContribution, MenuModelRegistry } from "@theia/core/lib/common/menu";
import { CommonMenus } from "@theia/core/lib/browser";
import { EditorManager } from "@theia/editor/lib/browser";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { OutputChannelManager, OutputChannelSeverity } from "@theia/output/lib/browser/output-channel";
import { VirtualFS, runWasi } from "@yukibana/runtime";
import type { CompilerBackend } from "@yukibana/runtime";
import type {
  CompileWorkerRequest,
  CompileWorkerResponse,
} from "@yukibana/runtime/dist/compile-worker";

export const BuildAndRunSwift: Command = {
  id: "yukibana.buildAndRun",
  // The category already prefixes this in the palette; repeating it reads as a stutter.
  label: "Build and Run Swift File",
  category: "Yukibana",
};

/**
 * Compiles the active editor's Swift file and runs the resulting wasm, both inside the
 * browser tab, streaming the program's stdout and stderr into a Theia output channel.
 *
 * The IDE never talks to a compiler directly: it talks to a `CompilerBackend`, so the
 * in-browser toolchain and a remote native one are interchangeable here.
 */
@injectable()
export class YukibanaContribution implements CommandContribution, MenuContribution {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
  @inject(FileService) protected readonly fileService!: FileService;
  @inject(OutputChannelManager) protected readonly outputChannels!: OutputChannelManager;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(Symbol.for("YukibanaCompilerBackend")) protected readonly backend!: CompilerBackend;

  registerCommands(commands: CommandRegistry): void {
    // Deliberately always enabled: Theia hides disabled commands from the palette, so
    // gating on "a .swift editor is open" made the command look as though the extension
    // had not loaded at all. buildAndRun() explains the situation instead.
    commands.registerCommand(BuildAndRunSwift, {
      execute: () => this.buildAndRun(),
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.EDIT_FIND, {
      commandId: BuildAndRunSwift.id,
      label: BuildAndRunSwift.label,
    });
  }

  protected currentSwiftEditor() {
    const editor = this.editorManager.currentEditor?.editor;
    if (!editor) return undefined;
    return editor.uri.path.ext === ".swift" ? editor : undefined;
  }

  /**
   * What to build: the focused .swift editor, or — when nothing relevant is focused —
   * the first .swift file in the workspace. "Run" should work right after opening a
   * project, before anything has been clicked.
   */
  protected async resolveSource(): Promise<{ path: string; text: string } | undefined> {
    const editor = this.currentSwiftEditor();
    if (editor) {
      return { path: editor.uri.path.toString(), text: editor.document.getText() };
    }

    for (const root of this.workspaceService.tryGetRoots()) {
      const dir = await this.fileService.resolve(root.resource);
      const swift = dir.children?.find((child) => child.resource.path.ext === ".swift");
      if (swift) {
        const contents = await this.fileService.read(swift.resource);
        return { path: swift.resource.path.toString(), text: contents.value };
      }
    }
    return undefined;
  }

  /**
   * Compilation runs in a worker, never on the UI thread.
   *
   * The toolchain is a 146 MiB module to compile and a 99 MiB sysroot to unpack. Doing
   * that inline does not merely jank the shell — it starves rendering badly enough that
   * the work appears never to finish. The worker is a single pre-bundled file because
   * Theia's bundler does not handle `new Worker(new URL(...))`.
   */
  protected worker?: Worker;
  protected nextRequestId = 0;

  /**
   * Where the toolchain is served from.
   *
   * The artifacts are far too large for a static host's per-file limits (Cloudflare
   * caps individual assets at 25 MiB; swift-frontend.wasm is 146 MiB), so a real
   * deployment keeps them in object storage instead. deploy/toolchain.json carries that
   * URL, which means the bucket can move without rebuilding the app. Same-origin
   * /toolchain is the fallback, and is what a local static server serves.
   */
  protected toolchainUrl?: Promise<string>;

  protected resolveToolchainUrl(): Promise<string> {
    this.toolchainUrl ??= fetch("/toolchain.json")
      .then((response) => (response.ok ? response.json() : undefined))
      .then((config?: { baseUrl?: string }) => config?.baseUrl || "/toolchain")
      .catch(() => "/toolchain");
    return this.toolchainUrl;
  }

  protected async compileInWorker(path: string, text: string) {
    this.worker ??= new Worker("/compile-worker.js", { type: "module" });
    const worker = this.worker;
    const id = this.nextRequestId++;

    return new Promise<{
      success: boolean;
      wasm?: Uint8Array;
      diagnostics: CompileWorkerResponse["diagnostics"];
      log: string;
      durationMs: number;
      unavailable?: string;
    }>((resolve) => {
      // A worker that fails to load never answers, and without this the command would
      // sit on "Compiling…" indefinitely. That is how a stale CommonJS bundle of the
      // worker presented itself: silence, rather than the error it actually was.
      const onError = (event: ErrorEvent | Event) => {
        worker.removeEventListener("error", onError);
        this.worker = undefined; // Let the next attempt build a fresh one.
        const detail = "message" in event && event.message ? `: ${event.message}` : "";
        resolve({
          success: false,
          diagnostics: [],
          log: "",
          durationMs: 0,
          unavailable: `the compile worker failed to start${detail}`,
        });
      };
      worker.addEventListener("error", onError);

      const onMessage = (event: MessageEvent<CompileWorkerResponse>) => {
        if (event.data.id !== id) return;
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        const data = event.data;
        resolve({
          success: data.ok,
          wasm: data.wasm ? new Uint8Array(data.wasm) : undefined,
          diagnostics: data.diagnostics,
          log: data.log,
          durationMs: data.durationMs,
          unavailable: data.unavailable,
        });
      };
      worker.addEventListener("message", onMessage);
      void this.resolveToolchainUrl().then((toolchainUrl) => {
        const request: CompileWorkerRequest = { id, sources: { [path]: text }, toolchainUrl };
        worker.postMessage(request);
      });
    });
  }

  protected async buildAndRun(): Promise<void> {
    const source = await this.resolveSource();
    if (!source) {
      this.messages.warn("No .swift file to build: open one, or add one to the workspace.");
      return;
    }

    const channel = this.outputChannels.getChannel("Yukibana");
    channel.show({ preserveFocus: true });
    channel.clear();

    const path = source.path;
    channel.appendLine(`Compiling ${path} with the ${this.backend.description} backend…`);

    const result = await this.compileInWorker(path, source.text);

    if (result.unavailable) {
      channel.appendLine(result.unavailable, OutputChannelSeverity.Error);
      channel.appendLine(
        "Build the toolchain (see the swift-toolchain-wasm repository) and serve it at /toolchain.",
      );
      return;
    }

    for (const diagnostic of result.diagnostics) {
      const where =
        diagnostic.line === undefined
          ? ""
          : `${diagnostic.file ?? path}:${diagnostic.line}:${diagnostic.column ?? 0}: `;
      channel.appendLine(
        `${where}${diagnostic.severity}: ${diagnostic.message}`,
        diagnostic.severity === "error"
          ? OutputChannelSeverity.Error
          : diagnostic.severity === "warning"
            ? OutputChannelSeverity.Warning
            : OutputChannelSeverity.Info,
      );
    }

    if (!result.success || !result.wasm) {
      channel.appendLine(`Compilation failed in ${result.durationMs} ms.`, OutputChannelSeverity.Error);
      return;
    }

    channel.appendLine(
      `Compiled in ${result.durationMs} ms (${(result.wasm.byteLength / 1024).toFixed(0)} KiB). Running:`,
    );

    const decoder = new TextDecoder();
    let line = "";
    const emit = (chunk: Uint8Array, severity: OutputChannelSeverity) => {
      line += decoder.decode(chunk, { stream: true });
      const parts = line.split("\n");
      line = parts.pop() ?? "";
      for (const part of parts) channel.appendLine(part, severity);
    };

    const run = await runWasi(result.wasm, {
      args: [path.split("/").pop() ?? "program.wasm"],
      fs: new VirtualFS(),
      onStdout: (chunk) => emit(chunk, OutputChannelSeverity.Info),
      onStderr: (chunk) => emit(chunk, OutputChannelSeverity.Error),
    });
    if (line.length > 0) channel.appendLine(line);

    channel.appendLine(`Program exited with ${run.exitCode} after ${run.durationMs} ms.`);
  }
}
