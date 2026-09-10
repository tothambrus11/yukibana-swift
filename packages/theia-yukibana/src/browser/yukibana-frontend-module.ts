import { ContainerModule } from "@theia/core/shared/inversify";
import { CommandContribution } from "@theia/core/lib/common";
import { MenuContribution } from "@theia/core/lib/common/menu";
import type { CompilerBackend } from "@yukibana/runtime";
import { YukibanaContribution } from "./yukibana-contribution";
import { WasmBackend } from "./wasm-backend";

export const YukibanaCompilerBackend = Symbol.for("YukibanaCompilerBackend");

export default new ContainerModule((bind) => {
  bind<CompilerBackend>(YukibanaCompilerBackend)
    .toConstantValue(new WasmBackend("6.3.3", "/toolchain"));
  bind(YukibanaContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(YukibanaContribution);
  bind(MenuContribution).toService(YukibanaContribution);
});
