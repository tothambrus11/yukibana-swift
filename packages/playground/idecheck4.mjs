import { chromium } from "playwright-core";
import { globSync } from "node:fs";
const exe = globSync("/opt/pw-browsers/chromium-*/chrome-linux/chrome")[0];
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#theia-app-shell", { timeout: 120000 });
await page.waitForTimeout(6000);
await page.keyboard.press("Control+Shift+P");
await page.waitForSelector(".quick-input-box input", { timeout: 20000 });
await (await page.$(".quick-input-box input")).click();
await page.keyboard.type("Build and Run Swift", { delay: 50 });
await page.waitForTimeout(2000);
await page.keyboard.press("Enter");
// The extension compiles on the main thread, so rAF-based waiting starves. Poll instead.
for (let i = 0; i < 120; i++) {
  await new Promise(r => setTimeout(r, 10000));
  const text = await page.evaluate(() => document.body.innerText || "").catch(() => "");
  if (text.includes("Program exited") || text.includes("Compilation failed")) {
    const i0 = text.indexOf("Compiling");
    console.log("IDE_OUTPUT:", JSON.stringify(text.slice(i0, i0 + 300).replace(/\s+/g, " ")));
    await page.screenshot({ path: "/tmp/theia-print.png", fullPage: false });
    break;
  }
  if (i % 6 === 0) console.log(`  …${i * 10}s`);
}
await browser.close();
