import { chromium } from "playwright-core";
import { globSync } from "node:fs";
const exe = globSync("/opt/pw-browsers/chromium-*/chrome-linux/chrome")[0];
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
page.on("pageerror", e => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded" });
// Theia boots asynchronously; wait for the shell.
await page.waitForSelector("#theia-app-shell", { timeout: 120000 });
console.log("Theia shell loaded. Title:", await page.title());
await page.waitForTimeout(6000);
// Open the demo file from the workspace via the file navigator.
await page.keyboard.press("Control+Shift+P");
await page.waitForTimeout(1500);
await page.keyboard.type("Yukibana");
await page.waitForTimeout(2500);
const paletteText = await page.textContent(".quick-input-list") .catch(() => "(no list)");
console.log("command palette shows:", JSON.stringify(paletteText.slice(0, 300)));
await page.screenshot({ path: "/tmp/theia-yukibana.png", fullPage: false });
await browser.close();
