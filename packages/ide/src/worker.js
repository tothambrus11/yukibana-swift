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

    // Prefer a gzipped copy, stored under the plain name with a .gz suffix, and serve it
    // with Content-Encoding so the browser inflates it transparently. That is 69 MiB
    // over the wire for a cold visit instead of 302 MiB, and compileStreaming still sees
    // application/wasm, so the module streams straight into the compiler.
    const range = request.headers.get("range");
    const cf = { cacheEverything: true, cacheTtl: 31536000 };

    let upstream = await fetch(`${env.TOOLCHAIN_RELEASE}/${name}.gz`, { cf });
    let gzipped = upstream.ok;

    if (!gzipped) {
      // No compressed copy: fall back to the plain artifact, where ranges still work.
      upstream = await fetch(`${env.TOOLCHAIN_RELEASE}/${name}`, {
        cf,
        headers: range ? { range } : {},
      });
    }

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(`toolchain artifact not available (${upstream.status})\n`, {
        status: upstream.status === 404 ? 404 : 502,
      });
    }

    const headers = new Headers();
    const extension = name.split(".").pop() ?? "";
    headers.set("Content-Type", CONTENT_TYPES[extension] ?? "application/octet-stream");
    headers.set("Cache-Control", IMMUTABLE);

    if (gzipped) {
      // Inflate here rather than passing the bytes through with Content-Encoding: gzip.
      // Declaring that header on a constructed Response does not make the runtime treat
      // the body as encoded — Chromium receives the header, does not decode, and
      // compileStreaming fails on "expected magic word 00 61 73 6d, found 1f 8b".
      // DecompressionStream streams, so this costs no buffering, and the hop that
      // actually matters for cost — GitHub to the edge — still moves 35 MiB, cached.
    } else {
      for (const header of ["content-length", "content-range", "accept-ranges", "etag"]) {
        const value = upstream.headers.get(header);
        if (value) headers.set(header, value);
      }
    }

    if (request.method === "HEAD") {
      return new Response(null, { status: upstream.status, headers });
    }

    const body = gzipped
      ? upstream.body.pipeThrough(new DecompressionStream("gzip"))
      : upstream.body;

    return new Response(body, { status: upstream.status, headers });
  },
};
