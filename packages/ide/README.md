# Yukibana IDE (Theia)

The Theia browser application that hosts Yukibana. It bundles the standard editing
surface — Monaco, explorer, outline, problems, output — plus
[`@yukibana/theia-extension`](../theia-yukibana), which contributes the
"Build and Run Swift File" command and binds a `CompilerBackend`.

```sh
cd ../theia-yukibana && npm install && npm run build   # the extension must be compiled first
cd ../ide && npm install && npm run build && npm start
```

The build is large (Theia pulls in Monaco and webpacks the whole frontend), so it is not
part of the default test loop; the extension itself typechecks and tests independently.

## No backend at all

The app targets Theia's `browser-only` mode: the entire IDE is static files, and the
workspace lives in the browser's own storage (OPFS). There is no Node process, which
means it deploys to any static host or CDN, and "your code never leaves the tab" is true
of the editor as well as the compiler.

```sh
npm run build     # -> lib/frontend, static
npm run serve     # a server that can only hand over bytes, to prove the point
```

A first visit is seeded with a `/workspace/main.swift` sample so there is something to
build immediately; it is never overwritten once the visitor has edited it.
