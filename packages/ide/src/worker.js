/**
 * Serves the app, and proxies the wasm toolchain from GitHub Releases.
 *
 * GitHub release assets cannot be fetched by a page directly: they carry no
 * Access-Control-Allow-Origin (verified — a cross-origin fetch fails with "Failed to
 * fetch"), and they are served as application/octet-stream, which
 * WebAssembly.compileStreaming rejects. Proxying them through this Worker fixes both,
 * because the browser then sees them on the site's own origin, with headers we choose.
 *
 * It also means the artifacts live in exactly one place — the release that built them —
 * instead of being copied into a bucket that can drift from it.
 */

const CONTENT_TYPES = {
  wasm: "application/wasm",
  tar: "application/x-tar",
  gz: "application/gzip",
};

// The release artifacts never change, so they can be cached forever.
const IMMUTABLE = "public, max-age=31536000, immutable";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/toolchain/")) {
      return env.ASSETS.fetch(request);
    }

    const name = url.pathname.slice("/toolchain/".length);
    // Only ever fetch a plain file name from the configured release: no traversal, no
    // turning this route into an open proxy.
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".")) {
      return new Response("invalid artifact name\n", { status: 400 });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed\n", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const upstream = await fetch(`${env.TOOLCHAIN_RELEASE}/${name}`, {
      // Hold it at the edge: the origin fetch happens once per location per TTL,
      // not once per visitor downloading 146 MiB.
      cf: { cacheEverything: true, cacheTtl: 31536000 },
      headers: request.headers.has("range") ? { range: request.headers.get("range") } : {},
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(`toolchain artifact not available (${upstream.status})\n`, {
        status: upstream.status === 404 ? 404 : 502,
      });
    }

    const headers = new Headers();
    const extension = name.split(".").pop() ?? "";
    headers.set("Content-Type", CONTENT_TYPES[extension] ?? "application/octet-stream");
    headers.set("Cache-Control", IMMUTABLE);
    for (const header of ["content-length", "content-range", "accept-ranges", "etag"]) {
      const value = upstream.headers.get(header);
      if (value) headers.set(header, value);
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
