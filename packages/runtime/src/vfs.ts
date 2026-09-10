import { Directory, File, Inode, PreopenDirectory } from "@bjorn3/browser_wasi_shim";

/**
 * An in-memory POSIX-ish filesystem shared by every wasm module Yukibana runs:
 * the Swift frontend, the linker, and the user's compiled program.
 *
 * The shim's `Directory`/`File` are the storage; this class is the path-oriented
 * API on top of them, because the shim only exposes single-component lookups.
 */
export class VirtualFS {
  readonly root: Directory;

  constructor(root: Directory = new Directory([])) {
    this.root = root;
  }

  /** Split a path into components, tolerating leading/trailing/duplicate slashes. */
  private static split(path: string): string[] {
    return path.split("/").filter((part) => part.length > 0 && part !== ".");
  }

  /** Create `path` and every missing parent, and return the deepest directory. */
  mkdirp(path: string): Directory {
    let dir = this.root;
    for (const part of VirtualFS.split(path)) {
      const existing = dir.contents.get(part);
      if (existing instanceof Directory) {
        dir = existing;
      } else if (existing === undefined) {
        const created = new Directory([]);
        dir.contents.set(part, created);
        dir = created;
      } else {
        throw new Error(`cannot mkdir ${path}: ${part} exists and is a file`);
      }
    }
    return dir;
  }

  private lookup(path: string): Inode | undefined {
    const parts = VirtualFS.split(path);
    let node: Inode | undefined = this.root;
    for (const part of parts) {
      if (!(node instanceof Directory)) return undefined;
      node = node.contents.get(part);
      if (node === undefined) return undefined;
    }
    return node;
  }

  exists(path: string): boolean {
    return this.lookup(path) !== undefined;
  }

  isDirectory(path: string): boolean {
    return this.lookup(path) instanceof Directory;
  }

  writeFile(path: string, data: Uint8Array | string, options: { readonly?: boolean } = {}): void {
    const parts = VirtualFS.split(path);
    if (parts.length === 0) throw new Error("cannot write to the filesystem root");
    const name = parts.pop() as string;
    const dir = this.mkdirp(parts.join("/"));
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    dir.contents.set(name, new File(bytes, { readonly: options.readonly ?? false }));
  }

  readFile(path: string): Uint8Array {
    const node = this.lookup(path);
    if (node instanceof File) return node.data;
    if (node === undefined) throw new Error(`no such file: ${path}`);
    throw new Error(`not a file: ${path}`);
  }

  readTextFile(path: string): string {
    return new TextDecoder().decode(this.readFile(path));
  }

  readDir(path: string): string[] {
    const node = this.lookup(path);
    if (!(node instanceof Directory)) throw new Error(`not a directory: ${path}`);
    return [...node.contents.keys()].sort();
  }

  unlink(path: string): void {
    const parts = VirtualFS.split(path);
    const name = parts.pop();
    if (name === undefined) throw new Error("cannot unlink the filesystem root");
    const parent = this.lookup(parts.join("/"));
    if (parent instanceof Directory) parent.contents.delete(name);
  }

  /** Every file path under `path`, depth-first. Useful for tests and for diffing build output. */
  walk(path = "/"): string[] {
    const out: string[] = [];
    const node = this.lookup(path);
    const prefix = path === "/" ? "" : path.replace(/\/$/, "");
    if (node instanceof File) return [prefix];
    if (!(node instanceof Directory)) return out;
    for (const [name, child] of [...node.contents.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const childPath = `${prefix}/${name}`;
      if (child instanceof Directory) out.push(...this.walk(childPath));
      else out.push(childPath);
    }
    return out;
  }

  /** Populate from a plain object, for terse test fixtures. */
  static from(entries: Record<string, Uint8Array | string>): VirtualFS {
    const fs = new VirtualFS();
    for (const [path, data] of Object.entries(entries)) fs.writeFile(path, data);
    return fs;
  }

  /** The `/` preopen handed to a WASI instance. */
  preopen(name = "/"): PreopenDirectory {
    return new PreopenDirectory(name, this.root.contents);
  }
}
