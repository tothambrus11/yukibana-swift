import { ContainerModule } from "@theia/core/shared/inversify";
import { CommandContribution } from "@theia/core/lib/common";
import { MenuContribution } from "@theia/core/lib/common/menu";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { OPFSInitialization } from "@theia/filesystem/lib/browser-only/opfs-filesystem-initialization";
import type { CompilerBackend } from "@yukibana/runtime";
import { YukibanaContribution } from "./yukibana-contribution";
import { WasmBackend } from "./wasm-backend";
import { YukibanaCompilerBackend } from "./yukibana-frontend-module";
import { YukibanaOPFSInitialization, YukibanaWorkspaceService } from "./browser-only-workspace";

/**
 * The frontend module for Theia's `browser-only` target: the whole IDE is static files
 * plus a filesystem in OPFS, with no Node backend anywhere. That is what makes Yukibana
 * deployable to a CDN, and what makes "your code never leaves the tab" true of the
 * editor as well as the compiler.
 */
export default new ContainerModule((bind, unbind, isBound, rebind) => {
    bind<CompilerBackend>(YukibanaCompilerBackend)
        .toConstantValue(new WasmBackend("6.3.3", "/toolchain"));
    bind(YukibanaContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(YukibanaContribution);
    bind(MenuContribution).toService(YukibanaContribution);

    // Seed and open a workspace, so a first visit has something to build.
    rebind(OPFSInitialization).to(YukibanaOPFSInitialization).inSingletonScope();
    rebind(WorkspaceService).to(YukibanaWorkspaceService).inSingletonScope();
});
