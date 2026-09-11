# Deploying Yukibana

Both apps are static — the IDE targets Theia's `browser-only` mode, so there is no Node
backend anywhere. What makes deployment non-obvious is size: the toolchain is about
300 MiB in three files, and static hosts cap individual assets far below that.

## The split

| What | Size | Where it goes |
| --- | --- | --- |
| The app (`bundle.js`, CSS, workers, HTML) | ~54 MiB, largest file 11 MiB | static host / CDN |
| `swift-frontend.wasm` | 146 MiB | object storage (R2, S3, …) |
| `swift-sysroot-core.tar` | 99 MiB | object storage |
| `wasm-ld.wasm` | 57 MiB | object storage |

Cloudflare Workers caps [individual static assets at 25 MiB](https://developers.cloudflare.com/workers/platform/limits/),
so the toolchain cannot be uploaded with the app, and neither can source maps (44 MiB).
`scripts/prepare-deploy.sh` assembles a directory with both excluded and **fails if
anything left in it exceeds the cap**, so this is caught before a deploy rather than
during one.

The app reads the toolchain's location from `toolchain.json` at startup, which means the
bucket can move without rebuilding.

## Deploying to Cloudflare

Wrangler refuses to run at the root of an npm workspace:

```
✘ [ERROR] The Cloudflare application detection logic has been run in the root of a
  workspace instead of targeting a specific project.
```

Run it from the app directory, not the repository root:

```sh
cd packages/ide
npm run build:prod                                   # theia build --mode production
TOOLCHAIN_BASE_URL="https://toolchain.example.com" \
  npm run prepare-deploy                             # -> packages/ide/deploy
npx wrangler deploy                                  # reads packages/ide/wrangler.jsonc
```

`npm run deploy` chains all three.

## The toolchain bucket

```sh
# From the swift-toolchain-wasm release (or a local build).
./scripts/fetch-toolchain.sh
cd packages/playground/public/toolchain
for f in swift-frontend.wasm wasm-ld.wasm swift-sysroot-core.tar; do
  npx wrangler r2 object put "yukibana-toolchain/$f" --file "$f" --remote
done
```

Two things the bucket must do, or the browser will refuse the files:

* **CORS.** The app fetches them from another origin, so the bucket needs
  `Access-Control-Allow-Origin` for the site's origin. Without it
  `WebAssembly.compileStreaming` fails.
* **Content types.** `.wasm` must be served as `application/wasm`, otherwise
  `compileStreaming` rejects it and the fallback path wastes a copy of the module.

Set a long `Cache-Control` (`public, max-age=31536000, immutable`) — the artifacts are
content-addressed by release, and a returning visitor should not pay 300 MiB twice.

## Verified

The exact split above was tested end to end: the assembled `deploy/` directory served
from one origin, the toolchain from another with CORS, in Chromium. The IDE compiled
`/workspace/main.swift` in 2325 ms and ran it in 39 ms, with no page errors, using both
origins.

## Still worth doing

* **Precompression.** `swift-frontend.wasm` is 146 MiB raw, 36 MiB gzipped. Serve
  `.br`/`.gz` with `Content-Encoding` rather than compressing on the fly.
* **Client-side persistence.** The HTTP cache is not obliged to keep a 146 MiB entry;
  storing the toolchain in OPFS or the Cache API makes a second visit instant.
* **Browser matrix.** Only Chromium has been tested. Safari, Firefox and phones are
  unknown, and wasm32's 4 GiB ceiling leaves less headroom than a desktop suggests.
