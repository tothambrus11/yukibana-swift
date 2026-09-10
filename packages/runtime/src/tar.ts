import { VirtualFS } from "./vfs.js";

/**
 * Minimal USTAR reader.
 *
 * The Swift SDK for WebAssembly ships as a tarball, and the browser needs its contents
 * as files in the VirtualFS before the compiler can see the standard library. Shipping
 * one tar and unpacking it in the tab beats thousands of individual fetches, and the
 * archive can be served pre-compressed. Only the record types the SDK bundle actually
 * uses are handled: regular files, directories, symlinks, and the GNU long-name record.
 */

const BLOCK = 512;

function readString(block: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && block[end] !== 0) end++;
  return new TextDecoder().decode(block.subarray(offset, end));
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
  const text = readString(block, offset, length).trim();
  return text.length === 0 ? 0 : parseInt(text, 8);
}

export interface UntarOptions {
  /** Strip this many leading path components, like `tar --strip-components`. */
  stripComponents?: number;
  /** Prefix every extracted path with this directory. */
  prefix?: string;
  /** Mark extracted files read-only (used for the stdlib sysroot). */
  readonly?: boolean;
}

export interface UntarResult {
  fs: VirtualFS;
  /** Paths of extracted files, in archive order. */
  files: string[];
  /** Symlinks the archive contained, as `link -> target`; resolved eagerly by copying. */
  symlinks: Array<{ path: string; target: string }>;
}

/** Unpack a (already decompressed) tar archive into `fs`. */
export function untar(
  archive: Uint8Array,
  fs: VirtualFS = new VirtualFS(),
  options: UntarOptions = {},
): UntarResult {
  const strip = options.stripComponents ?? 0;
  const prefix = (options.prefix ?? "").replace(/\/$/, "");
  const files: string[] = [];
  const symlinks: Array<{ path: string; target: string }> = [];

  let offset = 0;
  let longName: string | undefined;

  while (offset + BLOCK <= archive.byteLength) {
    const header = archive.subarray(offset, offset + BLOCK);
    // Two consecutive zero blocks end the archive; one is enough to stop.
    if (header.every((byte) => byte === 0)) break;

    const rawName = longName ?? readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const linkName = readString(header, 157, 100);
    const namePrefix = readString(header, 345, 155);
    longName = undefined;

    const fullName = namePrefix.length > 0 && typeFlag !== "L" ? `${namePrefix}/${rawName}` : rawName;
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;

    if (typeFlag === "L") {
      // GNU long name: the next header's name lives in this record's payload.
      longName = new TextDecoder().decode(archive.subarray(dataStart, dataEnd)).replace(/\0+$/, "");
    } else {
      const stripped = fullName.split("/").filter((p) => p.length > 0).slice(strip).join("/");
      if (stripped.length > 0) {
        const path = prefix.length > 0 ? `${prefix}/${stripped}` : `/${stripped}`;
        if (typeFlag === "5") {
          fs.mkdirp(path);
        } else if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "7") {
          fs.writeFile(path, archive.slice(dataStart, dataEnd), { readonly: options.readonly });
          files.push(path);
        } else if (typeFlag === "2" || typeFlag === "1") {
          symlinks.push({ path, target: linkName });
        }
      }
    }

    offset = dataEnd + ((BLOCK - (size % BLOCK)) % BLOCK);
  }

  // The VirtualFS has no symlink inode, so links are materialised as copies. Archive
  // order is not guaranteed to place targets first, so this runs as a second pass.
  for (const { path, target } of symlinks) {
    const base = path.slice(0, path.lastIndexOf("/"));
    const resolved = target.startsWith("/") ? target : `${base}/${target}`;
    try {
      fs.writeFile(path, fs.readFile(resolved), { readonly: options.readonly });
      files.push(path);
    } catch {
      // Dangling link (or a link to a directory): skip rather than fail the unpack.
    }
  }

  return { fs, files, symlinks };
}
