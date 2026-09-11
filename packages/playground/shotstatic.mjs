import { chromium } from "playwright-core";
import { globSync } from "node:fs";
const exe = globSync("/opt/pw-browsers/chromium-*/chrome-linux/chrome")[0];
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 940 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#theia-app-shell", { timeout: 120000 });
await page.waitForTimeout(9000);
await page.keyboard.press("Control+Shift+P");
await page.waitForSelector(".quick-input-box input", { timeout: 20000 });
await (await page.$(".quick-input-box input")).click();
await page.keyboard.type("Build and Run Swift", { delay: 40 });
await page.waitForTimeout(1500);
await page.keyboard.press("Enter");
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const t = await page.evaluate(() => document.body.innerText || "").catch(() => "");
  if (t.includes("Program exited")) break;
}
await page.screenshot({ path: "/tmp/theia-static.png" });
await browser.close();
console.log("captured");
