import { ContainerModule } from "@theia/core/shared/inversify";
import { CommandContribution } from "@theia/core/lib/common";
import { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { MenuContribution } from "@theia/core/lib/common/menu";
import type { CompilerBackend } from "@yukibana/runtime";
import { YukibanaContribution } from "./yukibana-contribution";
import { WasmBackend } from "./wasm-backend";
import { SwiftLanguageContribution } from "./swift-language";

export const YukibanaCompilerBackend = Symbol.for("YukibanaCompilerBackend");

export default new ContainerModule((bind) => {
  bind<CompilerBackend>(YukibanaCompilerBackend)
    .toConstantValue(new WasmBackend("6.3.3", "/toolchain"));
  // Swift is not a language Monaco knows; register it so .swift is not "Plain Text".
  bind(SwiftLanguageContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SwiftLanguageContribution);

  bind(YukibanaContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(YukibanaContribution);
  bind(MenuContribution).toService(YukibanaContribution);
});
