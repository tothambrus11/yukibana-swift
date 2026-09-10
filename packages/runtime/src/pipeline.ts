/**
 * The exact tool invocations Yukibana replays in the browser.
 *
 * These argument vectors are not invented: they were captured from a real
 * `swiftc -target wasm32-unknown-wasip1 -v` run, then replayed by hand — frontend, then
 * `wasm-ld`, with no driver in between — to confirm they produce a program that runs.
 * The driver itself is unusable here: it works by `fork`/`exec`ing the frontend and the
 * linker, and WASI can spawn nothing.
 *
 * Two things the driver does that Yukibana deliberately drops:
 *
 *   * `swift-autolink-extract`, which reads the autolink section of the object file to
 *     discover which libraries to link. Its answer for a wasm target is the fixed list
 *     in `STDLIB_LIBRARIES`, so the step is replaced by that list.
 *   * `-plugin-path` / `-in-process-plugin-server-path`, the macro plumbing. Macros run
 *     as spawned plugin executables, which WASI cannot do at all.
 *
 * Paths refer to the sysroot produced by `toolchain/scripts/40-sysroot-pack.sh`, mounted
 * in the VirtualFS at `SYSROOT_ROOT`.
 */

export const SYSROOT_ROOT = "/sysroot";

/** The WASI sysroot: libc, crt1, C headers. */
export const wasiSysroot = (root: string = SYSROOT_ROOT) => `${root}/wasi-sysroot`;

/** Swift's static resource directory: stdlib modules, archives, swiftrt.o, compiler-rt. */
export const swiftResourceDir = (root: string = SYSROOT_ROOT) => `${root}/swift/lib/swift_static`;

export const WASI_SYSROOT = wasiSysroot();
export const SWIFT_RESOURCE_DIR = swiftResourceDir();

export const TARGET_TRIPLE = "wasm32-unknown-wasip1";

/**
 * What `swift-autolink-extract` would have discovered, in link order.
 * SwiftOnoneSupport appears twice in the driver's own line; once is enough given
 * wasm-ld's archive resolution, but the order matters.
 */
export const STDLIB_LIBRARIES = [
  "-lswiftSwiftOnoneSupport",
  "-lswiftCore",
  "-lswift_Concurrency",
  "-lswift_StringProcessing",
  "-lswift_RegexParser",
  "-ldl",
  "-lc++",
  "-lc++abi",
  "-lm",
  "-lwasi-emulated-mman",
  "-lwasi-emulated-signal",
  "-lwasi-emulated-process-clocks",
];

export interface FrontendOptions {
  /** All source files in the module. */
  sources: string[];
  /** The one file this invocation compiles; the rest are context. */
  primary: string;
  moduleName: string;
  output: string;
  /** Where the packed sysroot is mounted. Defaults to `SYSROOT_ROOT`. */
  sysrootRoot?: string;
  extraArgs?: string[];
}

/** `swift-frontend -frontend -c …` — one object file per primary source. */
export function frontendArgs(options: FrontendOptions): string[] {
  const sysroot = wasiSysroot(options.sysrootRoot);
  const resources = swiftResourceDir(options.sysrootRoot);
  return [
    "swift-frontend",
    "-frontend",
    "-c",
    // Every source is listed exactly once, with `-primary-file` marking the one this
    // invocation compiles; repeating the primary is rejected as a duplicate input.
    ...options.sources.flatMap((source) =>
      source === options.primary ? ["-primary-file", source] : [source],
    ),
    "-target",
    TARGET_TRIPLE,
    // wasm has no Objective-C runtime, and the driver always passes this for wasi.
    "-disable-objc-interop",
    "-sdk",
    sysroot,
    "-resource-dir",
    resources,
    "-use-static-resource-dir",
    // Colour escapes would have to be stripped again before display.
    "-no-color-diagnostics",
    "-Xcc",
    "-fno-color-diagnostics",
    "-empty-abi-descriptor",
    "-module-name",
    options.moduleName,
    "-o",
    options.output,
    ...(options.extraArgs ?? []),
  ];
}

export interface LinkOptions {
  objects: string[];
  output: string;
  /** Bytes of stack for the linked program; the wasm default of 64 KiB is far too small. */
  stackSize?: number;
  /** Where the packed sysroot is mounted. Defaults to `SYSROOT_ROOT`. */
  sysrootRoot?: string;
  extraArgs?: string[];
}

/** `wasm-ld …` — exactly what clang drives for this target. */
export function linkArgs(options: LinkOptions): string[] {
  const sysroot = wasiSysroot(options.sysrootRoot);
  const resources = swiftResourceDir(options.sysrootRoot);
  return [
    "wasm-ld",
    "-m",
    "wasm32",
    `-L${resources}/wasi`,
    `-L${sysroot}/lib/wasm32-wasip1`,
    `${sysroot}/lib/wasm32-wasip1/crt1-command.o`,
    `${resources}/wasi/wasm32/swiftrt.o`,
    ...options.objects,
    ...STDLIB_LIBRARIES,
    "--error-limit=0",
    // The toolchain is built without threads, and so is the output.
    "--threads=1",
    "--global-base=4096",
    "--table-base=4096",
    "-z",
    `stack-size=${options.stackSize ?? 131072}`,
    "-lc",
    `${resources}/clang/lib/wasip1/libclang_rt.builtins-wasm32.a`,
    "-o",
    options.output,
    ...(options.extraArgs ?? []),
  ];
}

/** `file:line:col: severity: message`, the format the frontend and lld both emit. */
export interface Diagnostic {
  file?: string;
  line?: number;
  column?: number;
  severity: "error" | "warning" | "note" | "remark";
  message: string;
}

export function parseDiagnostics(output: string): Diagnostic[] {
  const pattern = /^(.*?):(\d+):(\d+): (error|warning|note|remark): (.*)$/gm;
  const diagnostics: Diagnostic[] = [];
  for (const match of output.matchAll(pattern)) {
    diagnostics.push({
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
      severity: match[4] as Diagnostic["severity"],
      message: match[5] as string,
    });
  }
  return diagnostics;
}
