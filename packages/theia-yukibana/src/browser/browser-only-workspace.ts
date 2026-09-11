import { injectable } from "@theia/core/shared/inversify";
import URI from "@theia/core/lib/common/uri";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { DefaultOPFSInitialization } from "@theia/filesystem/lib/browser-only/opfs-filesystem-initialization";
import type { OPFSFileSystemProvider } from "@theia/filesystem/lib/browser-only/opfs-filesystem-provider";

/**
 * Browser-only Yukibana keeps its files in the browser's own storage (OPFS), so a first
 * visit starts with an empty disk and nothing to compile. These two pieces give a fresh
 * tab a workspace that is ready to build, without a server ever being involved.
 *
 * They live in a browser-only module because they import Theia's OPFS layer, which only
 * exists in that target.
 */

export const WORKSPACE_ROOT = "file:///workspace";

const SAMPLE = `// Welcome to Yukibana — a Swift compiler that runs in your browser tab.
//
// Nothing here is sent to a server: swift-frontend.wasm compiles this file,
// wasm-ld.wasm links it, and the result runs beside them.
//
// Press Ctrl/Cmd+Shift+P and run "Yukibana: Build and Run Swift File".

struct Point: CustomStringConvertible {
    var x: Int
    var y: Int

    var description: String { "(\\(x), \\(y))" }
}

let points = (1...3).map { Point(x: $0, y: $0 * $0) }
print("points: \\(points)")

let counts = ["swift": 1, "wasm": 2]
for (name, count) in counts.sorted(by: { $0.key < $1.key }) {
    print("\\(name) -> \\(count)")
}
`;

/** Seeds the OPFS workspace on first run, and never overwrites the user's edits. */
@injectable()
export class YukibanaOPFSInitialization extends DefaultOPFSInitialization {
    override async initializeFS(provider: OPFSFileSystemProvider): Promise<void> {
        const root = new URI(WORKSPACE_ROOT);
        if (!(await this.exists(provider, root))) {
            await provider.mkdir(root);
        }

        const sample = root.resolve("main.swift");
        if (await this.exists(provider, sample)) {
            return; // The visitor has been here before; their file wins.
        }
        await provider.writeFile(sample, new TextEncoder().encode(SAMPLE), {
            create: true,
            overwrite: false,
        });
    }

    private async exists(provider: OPFSFileSystemProvider, uri: URI): Promise<boolean> {
        try {
            await provider.stat(uri);
            return true;
        } catch {
            return false;
        }
    }
}

/** Opens that workspace by default, so the explorer is not empty on arrival. */
@injectable()
export class YukibanaWorkspaceService extends WorkspaceService {
    protected override getDefaultWorkspaceUri(): Promise<string> {
        return Promise.resolve(WORKSPACE_ROOT);
    }
}
