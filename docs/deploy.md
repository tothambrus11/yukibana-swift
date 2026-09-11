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
./scripts/fetch-toolchain.sh                                  # from a release, or a local build
BUCKET=yukibana-toolchain ./scripts/upload-toolchain.sh
```

The script uploads each artifact **gzipped, under its plain name**, with
`Content-Encoding: gzip` and the right `Content-Type`. That matters more than it looks:

| | raw | gzipped |
| --- | --- | --- |
| `swift-frontend.wasm` | 146 MB | 35 MB |
| `swift-sysroot-core.tar` | 99 MB | 20 MB |
| `wasm-ld.wasm` | 57 MB | 14 MB |
| **total per cold visitor** | **302 MB** | **69 MB** |

The browser decompresses transparently and still sees `application/wasm`, so
`WebAssembly.compileStreaming` works on it directly — verified in Chromium: a
gzip-encoded `wasm-ld.wasm` streamed in 14 MB and compiled in 953 ms. Uploading the
artifacts as `*.gz` instead would force the app to decompress them itself, wasting a
full extra copy of a 146 MiB module in memory.

Two things the bucket must do, or the browser will refuse the files:

* **CORS.** The app fetches them from another origin, so the bucket needs
  `Access-Control-Allow-Origin` for the site's origin. Without it
  `WebAssembly.compileStreaming` fails.
* **Content types.** `.wasm` must be `application/wasm`; `compileStreaming` rejects
  anything else.

The script sets `Cache-Control: public, max-age=31536000, immutable` — the artifacts are
fixed for a given release, and a returning visitor should not pay for them twice.

## Verified

The exact split above was tested end to end: the assembled `deploy/` directory served
from one origin, the toolchain from another with CORS, in Chromium. The IDE compiled
`/workspace/main.swift` in 2325 ms and ran it in 39 ms, with no page errors, using both
origins.

## Still worth doing

* **Brotli.** gzip already cuts the cold load from 302 MB to 69 MB; brotli would do
  better still, at the cost of a slower upload-time compression step.
* **Client-side persistence.** The HTTP cache is not obliged to keep a 146 MiB entry;
  storing the toolchain in OPFS or the Cache API makes a second visit instant.
* **Browser matrix.** Only Chromium has been tested. Safari, Firefox and phones are
  unknown, and wasm32's 4 GiB ceiling leaves less headroom than a desktop suggests.
