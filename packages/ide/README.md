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

## Why an IDE shell needs a server, when compiling does not

Theia's browser target has a Node backend for the workspace, filesystem and preferences.
That backend serves the IDE — it never compiles anything. Compilation happens in the tab,
in a worker, against the wasm toolchain; the code the user writes never leaves the
browser. The two facts are independent, and conflating them is the usual reason people
assume an online IDE must upload your source.
