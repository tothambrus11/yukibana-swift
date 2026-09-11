# Deploying Yukibana

Both apps are static — the IDE targets Theia's `browser-only` mode, so there is no Node
backend anywhere. What makes deployment non-obvious is size: the toolchain is about
300 MiB in three files, and static hosts cap individual assets far below that.

## The split

| What | Size | Where it goes |
| --- | --- | --- |
| The app (`bundle.js`, CSS, workers, HTML) | ~38 MiB, largest file 11 MiB | static assets |
| `swift-frontend.wasm` | 146 MiB | its GitHub release, proxied |
| `swift-sysroot-core.tar` | 99 MiB | its GitHub release, proxied |
| `wasm-ld.wasm` | 57 MiB | its GitHub release, proxied |

Cloudflare caps [individual static assets at 25 MiB](https://developers.cloudflare.com/workers/platform/limits/),
so the toolchain cannot be uploaded with the app, and neither can source maps (44 MiB).
`scripts/prepare-deploy.sh` assembles a directory with both excluded and **fails if
anything left in it exceeds the cap**, so this is caught before a deploy rather than
during one.

## Serving the toolchain from its GitHub release

The artifacts stay in the release that produced them, and the Worker in
`packages/ide/src/worker.js` serves them under `/toolchain/*`. Nothing else is needed —
no bucket, no upload step, no second copy that can drift from the release.

A page cannot fetch release assets directly, which is why the proxy exists:

* GitHub sends **no `Access-Control-Allow-Origin`** on release assets — verified, a
  cross-origin `fetch` fails outright with "Failed to fetch", and `OPTIONS` returns 405.
* They are served as `application/octet-stream`, which `WebAssembly.compileStreaming`
  rejects.

Through the Worker the browser sees them on the site's own origin, so there is no CORS
at all, with `application/wasm` and `Cache-Control: immutable` set by us. The upstream
fetch uses `cacheEverything` with a year-long TTL, so GitHub is hit once per edge
location rather than once per visitor; [the 512 MB cacheable-object limit](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
is well above the 146 MiB of the largest artifact.

Point it at a release with the `TOOLCHAIN_RELEASE` var in `packages/ide/wrangler.jsonc`;
it defaults to `releases/latest/download`. `TOOLCHAIN_BASE_URL` can then be left unset,
since `/toolchain` is the app's default.

Verified end to end in Chromium: `WebAssembly.compileStreaming(fetch("/toolchain/wasm-ld.wasm"))`
through the Worker compiled a real 57 MiB module in 2021 ms, with path traversal
rejected (400) and a missing artifact returning 404.

### If you would rather use R2

Object storage is still an option, and `scripts/setup-r2.sh` plus
`scripts/upload-toolchain.sh` set it up — see [the R2 section below](#the-r2-alternative).
It costs an upload step and a second copy of the artifacts, but serves them
pre-compressed (69 MiB instead of 302 MiB), which the GitHub proxy cannot do because the
release stores them uncompressed.

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
npm run prepare-deploy                               # -> packages/ide/deploy
npx wrangler deploy                                  # reads packages/ide/wrangler.jsonc
```

`npm run deploy` chains all three.

## The R2 alternative

There is no URL until a bucket exists and has public access enabled:

```sh
BUCKET=yukibana-toolchain ./scripts/setup-r2.sh   # create, set CORS, print the URL
BUCKET=yukibana-toolchain ./scripts/upload-toolchain.sh
```

`setup-r2.sh` prints an `https://pub-<hash>.r2.dev` URL. That is fine for a first test,
but Cloudflare [rate-limits r2.dev and documents it as development-only](https://developers.cloudflare.com/r2/buckets/public-buckets/),
and a cold visit pulls ~69 MiB from this bucket, so production wants a custom domain:

```sh
npx wrangler r2 bucket domain add yukibana-toolchain --domain toolchain.yourdomain.com
```

Whichever you use becomes `TOOLCHAIN_BASE_URL` in the site's build settings.

`upload-toolchain.sh` stores each artifact **gzipped, under its plain name**, with
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
