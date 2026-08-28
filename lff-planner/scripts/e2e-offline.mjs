/** E2E: install the service worker, go offline, and confirm the app still
 *  browses films, shows write-ups and images, and records flag changes.
 *  "Offline" is real: this test runs its own preview server on port 4174 and
 *  kills it mid-test (CDP offline emulation is unreliable with service
 *  workers), so every request after that point can only be answered by the
 *  service worker's caches. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const server = spawn("npx", ["vite", "preview", "app", "--port", "4174", "--strictPort"], { stdio: "ignore" });
const BASE = "http://localhost:4174";
for (let i = 0; i < 40; i++) {
  try {
    await fetch(BASE);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
const killServer = () => server.kill("SIGKILL");

const chrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
const context = await browser.newContext();
const page = await context.newPage();
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };

await page.goto("http://localhost:4174/#/browse");
await page.waitForSelector(".film-row");

// Wait for the service worker to be active and controlling.
await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  }
  return reg.active?.state;
});

// Download the offline pack (warms the image cache through the SW).
await page.locator(".sync-badge").click();
await page.locator(".sync-menu button", { hasText: "Download for offline" }).click();
await page.waitForTimeout(1500);

// Go offline for real: stop the server, then reload from scratch.
killServer();
await new Promise((r) => setTimeout(r, 500));
await page.reload();
await page.waitForSelector(".film-row", { timeout: 10000 }).catch(() => fail("film list did not render offline"));

// Open a film with an image and a write-up.
await page.locator(".film-row", { hasText: "The Glass Harbour" }).click();
await page.waitForSelector(".writeup");
const writeup = await page.locator(".writeup").textContent();
if (!writeup.includes("molten glass")) fail("write-up text missing offline");
const imgOk = await page.locator(".detail-image").evaluate((img) => img.complete && img.naturalWidth > 0);
if (!imgOk) fail("detail image did not load offline");

// Flag changes still persist offline.
await page.locator(".flag-buttons.large .flag-maybe").click();
await page.waitForTimeout(600); // let the debounced localStorage write flush
await page.reload();
await page.waitForSelector(".flag-buttons.large");
const pressed = await page.locator(".flag-buttons.large .flag-maybe").getAttribute("aria-pressed");
if (pressed !== "true") fail("offline flag change lost after reload");

console.log(process.exitCode ? "OFFLINE E2E FAILED" : "OFFLINE E2E PASSED — shell, films, write-ups, images, and flag persistence all work offline");
await browser.close();
