#!/usr/bin/env node
// Headless screenshot capture for audit evidence. Standalone Chromium — never
// touches the user's browser or the Playwright MCP instance.
//   node capture.mjs <run-dir>            (reads <run-dir>/spec.json, writes <run-dir>/shots/*.jpeg)
//
// spec.json:
// {
//   "baseUrl": "http://localhost:3100",
//   "viewport": { "width": 1440, "height": 900 },     // optional
//   "deviceScaleFactor": 1.5,                          // optional
//   "loginSelectors": { "email": "#email", "password": "#password", "submit": "button[type=submit]", "landedUrl": "**/dashboard" },
//   "logins": { "client": { "email": "priya@app.com", "password": "password123" } },
//   "shots": [
//     { "name": "dashboard", "login": "client", "url": "/dashboard" },
//     { "name": "dialog", "login": "client", "url": "/reviews/<id>",
//       "clickText": "Approve",                        // optional: click element by visible text before shooting
//       "clickRole": ["button", "Approve"],           // optional alternative: role + accessible name
//       "screenshotSelector": "[role='alertdialog']", // optional: element shot instead of viewport
//       "scrollTo": "bottom" | 700,                    // optional
//       "waitMs": 800, "fullPage": false }
//   ]
// }
// Shots are grouped by login; each login is one browser context, sequential.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";

const runDir = path.resolve(process.argv[2] || ".");
const spec = JSON.parse(fs.readFileSync(path.join(runDir, "spec.json"), "utf8"));
const shotsDir = path.join(runDir, "shots");
fs.mkdirSync(shotsDir, { recursive: true });

// ---- bootstrap playwright-core into a shared tools dir (one-time ~10s) ----
const toolsDir = path.join(runDir, "..", ".tools");
const req = createRequire(path.join(toolsDir, "node_modules", "x.js"));
let chromium;
try {
  ({ chromium } = req("playwright-core"));
} catch {
  console.log("installing playwright-core into " + toolsDir + " …");
  fs.mkdirSync(toolsDir, { recursive: true });
  execSync(`npm install playwright-core --prefix "${toolsDir}" --no-audit --no-fund --silent`, { stdio: "inherit" });
  ({ chromium } = req("playwright-core"));
}

// ---- locate a chromium headless shell (playwright browser cache) ----
function findExe() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXE) return process.env.PLAYWRIGHT_CHROMIUM_EXE;
  const roots = [
    path.join(os.homedir(), "AppData", "Local", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => d.startsWith("chromium_headless_shell-")).sort();
    for (const d of dirs.reverse()) {
      for (const sub of ["chrome-headless-shell-win64/chrome-headless-shell.exe", "chrome-headless-shell-linux64/chrome-headless-shell", "chrome-headless-shell-mac-x64/chrome-headless-shell", "chrome-headless-shell-mac-arm64/chrome-headless-shell"]) {
        const p = path.join(root, d, sub);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error("No chromium headless shell found. Run: npx playwright install chromium --only-shell  (or set PLAYWRIGHT_CHROMIUM_EXE)");
}

const browser = await chromium.launch({ executablePath: findExe(), headless: true });
const results = { ok: [], fail: [] };
const byLogin = new Map();
for (const s of spec.shots) {
  const k = s.login || "_anon";
  if (!byLogin.has(k)) byLogin.set(k, []);
  byLogin.get(k).push(s);
}

const sel = { email: "#email", password: "#password", submit: "button[type=submit]", landedUrl: "**/dashboard", ...(spec.loginSelectors || {}) };

for (const [loginKey, shots] of byLogin) {
  const ctx = await browser.newContext({
    viewport: spec.viewport || { width: 1440, height: 900 },
    deviceScaleFactor: spec.deviceScaleFactor || 1.5,
  });
  const page = await ctx.newPage();
  try {
    if (loginKey !== "_anon") {
      const cred = spec.logins[loginKey];
      if (!cred) throw new Error(`login "${loginKey}" not in spec.logins`);
      await page.goto(spec.baseUrl + (spec.loginPath || "/sign-in"), { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector(sel.email, { timeout: 30000 });
      await page.fill(sel.email, cred.email);
      await page.fill(sel.password, cred.password);
      await page.click(sel.submit);
      await page.waitForURL(sel.landedUrl, { timeout: 30000 });
    }
    for (const s of shots) {
      try {
        await page.goto(spec.baseUrl + s.url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
        if (s.clickRole) await page.getByRole(s.clickRole[0], { name: s.clickRole[1] }).first().click({ timeout: 10000 });
        else if (s.clickText) await page.getByText(s.clickText).first().click({ timeout: 10000 });
        if (s.scrollTo === "bottom") await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        else if (typeof s.scrollTo === "number") await page.evaluate((y) => window.scrollBy(0, y), s.scrollTo);
        await page.waitForTimeout(s.waitMs ?? 800);
        const opts = { path: path.join(shotsDir, `${s.name}.jpeg`), type: "jpeg", quality: 78 };
        if (s.screenshotSelector) {
          const el = page.locator(s.screenshotSelector).first();
          await el.waitFor({ state: "visible", timeout: 8000 });
          await el.screenshot(opts);
        } else {
          await page.screenshot({ ...opts, fullPage: !!s.fullPage });
        }
        if (s.pressEscapeAfter) await page.keyboard.press("Escape");
        results.ok.push(s.name);
        console.log("OK   " + s.name);
      } catch (e) {
        results.fail.push(s.name + ": " + String(e.message || e).split("\n")[0]);
        console.log("FAIL " + s.name + ": " + String(e.message || e).split("\n")[0]);
      }
    }
  } catch (e) {
    for (const s of shots) results.fail.push(s.name + " (login failed: " + String(e.message || e).split("\n")[0] + ")");
    console.log("LOGIN FAIL " + loginKey + ": " + String(e.message || e).split("\n")[0]);
  }
  await ctx.close();
}
await browser.close();
console.log(`\nDONE ok=${results.ok.length} fail=${results.fail.length}`);
if (results.fail.length) { console.log(results.fail.join("\n")); process.exitCode = 2; }
