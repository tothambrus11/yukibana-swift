#!/usr/bin/env node
// A static file server for checking that a build really needs no backend.
//
// The IDE targets Theia's browser-only mode, so the whole application is static files
// plus a filesystem in OPFS. Serving it with this — a server that can do nothing but
// hand over bytes — is the proof: if it works here, it works on any CDN.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";

const root = process.argv[2] ?? "lib/frontend";
const port = Number(process.argv[3] ?? 3000);

const types = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".tar": "application/x-tar", ".svg": "image/svg+xml", ".png": "image/png",
  ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json",
};

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  // Contain the path: this is a demo server, but a path-traversal hole is never a demo.
  const candidate = join(root, normalize(url).replace(/^(\.\.[/\\])+/, ""));
  let file = candidate;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(root, "index.html"); // SPA fallback
  }
  try {
    const { size } = statSync(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Content-Length": size,
      // What a CDN would send for immutable, content-addressed assets.
      "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=31536000",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`static server on http://127.0.0.1:${port} (root: ${root})`));
