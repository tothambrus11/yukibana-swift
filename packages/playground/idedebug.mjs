import { chromium } from "playwright-core";
import { globSync } from "node:fs";
const exe = globSync("/opt/pw-browsers/chromium-*/chrome-linux/chrome")[0];
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
page.on("console", m => { const t = m.text(); if (m.type()==="error" || /worker|toolchain|fail/i.test(t)) console.log("[c]", t.slice(0,200)); });
page.on("pageerror", e => console.log("[pageerror]", String(e).slice(0,200)));
page.on("requestfailed", r => console.log("[reqfail]", r.url().slice(0,90), r.failure()?.errorText));
await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#theia-app-shell", { timeout: 120000 });
await page.waitForTimeout(6000);
await page.keyboard.press("Control+Shift+P");
await page.waitForSelector(".quick-input-box input", { timeout: 20000 });
await (await page.$(".quick-input-box input")).click();
await page.keyboard.type("Build and Run Swift", { delay: 50 });
await page.waitForTimeout(1500);
await page.keyboard.press("Enter");
for (let i = 1; i <= 10; i++) {
  await new Promise(r => setTimeout(r, 20000));
  const t = await page.evaluate(() => document.body.innerText || "").catch(() => "");
  const j = t.indexOf("Compiling");
  console.log(`t=${i*20}s output:`, JSON.stringify(j >= 0 ? t.slice(j, j+200).replace(/\s+/g," ") : "(no Compiling line)"));
}
await browser.close();
