import { test } from "node:test";
import assert from "node:assert/strict";
import { globSync } from "node:fs";
import { chromium } from "playwright-core";
import { preview } from "vite";

/** Chromium ships preinstalled in this environment; find it without a download. */
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  return globSync(`${root}/chromium-*/chrome-linux/chrome`)[0];
}

/**
 * End-to-end proof of the output half: a Swift program, compiled to
 * wasm32-wasip1 by the official Swift SDK, executing inside a real browser tab
 * with no server involvement beyond serving static files.
 */
test("Swift-compiled wasm runs in a browser tab", { timeout: 180_000 }, async (t) => {
  const server = await preview({
    root: new URL("..", import.meta.url).pathname,
    preview: { port: 4173, strictPort: true },
  });
  t.after(() => server.close());

  const browser = await chromium.launch({
    executablePath: findChromium(),
    // The container runs as root, where Chromium's sandbox refuses to start.
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());

  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(server.resolvedUrls.local[0], { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.getElementById("run-status")?.textContent?.includes("exit"),
    { timeout: 120_000 },
  );

  const output = await page.textContent("#output");
  const status = await page.textContent("#run-status");

  assert.deepEqual(pageErrors, []);
  assert.match(output, /Hello from Swift on WebAssembly, browser!/);
  assert.match(output, /fib: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34/);
  assert.match(output, /caught: empty/);
  assert.match(status, /^exit 0 /);
});

/**
 * Proof of the language-service half: swift-syntax, cross-compiled to wasm, producing
 * real diagnostics and an outline for text typed into the page — in a worker, with no
 * server round-trip.
 */
test("swift-syntax parses edited source in-tab", { timeout: 180_000 }, async (t) => {
  const server = await preview({
    root: new URL("..", import.meta.url).pathname,
    preview: { port: 4174, strictPort: true },
  });
  t.after(() => server.close());

  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
  t.after(() => browser.close());

  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0], { waitUntil: "domcontentloaded" });

  // The seeded example is valid Swift.
  await page.waitForFunction(
    () => document.getElementById("diagnostics")?.textContent?.includes("No syntax errors"),
    { timeout: 120_000 },
  );

  // Break it, and the real parser should say so, with a fix-it.
  await page.fill("#editor", "struct Point {\n  var x: Int\n}\nlet p = Point(x: 3\n");
  await page.waitForFunction(
    () => document.getElementById("diagnostics")?.textContent?.includes("error:"),
    { timeout: 60_000 },
  );

  const diagnostics = await page.textContent("#diagnostics");
  assert.match(diagnostics, /4:19 error: expected '\)' to end function call/);
  assert.match(diagnostics, /fix-it: insert '\)'/);

  const outline = await page.textContent("#outline");
  assert.match(outline, /struct\s*Point/);
  assert.match(outline, /var\s*x/);
});
