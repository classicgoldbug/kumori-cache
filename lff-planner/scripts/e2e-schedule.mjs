/** E2E: seed real selections into localStorage, compute a schedule in the app,
 *  and check the timeline, diagnostics, and screening map render. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const selections = readFileSync(join(root, "data/sample/selections-example.json"), "utf-8");

const chrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
const page = await browser.newPage();
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };

await page.goto("http://localhost:4173/#/browse");
await page.waitForSelector(".film-row");
await page.evaluate((data) => localStorage.setItem("lff-selections-2025", data), selections);
await page.goto("http://localhost:4173/#/schedule");
await page.reload();
await page.waitForSelector(".schedule-header button");

await page.locator(".schedule-header button", { hasText: "Compute schedule" }).click();
await page.waitForSelector(".schedule-day", { timeout: 15000 });

const text = await page.locator(".schedule").textContent();
for (const needle of [
  "proven optimal",
  "Surprise Film",           // manual event scheduled
  "The Glass Harbour",       // gala moved off the clashing RFH slot
  "Royal Festival Hall",
  "min travel",              // gap annotations
  "Screening map",
]) {
  if (!text.includes(needle)) fail(`schedule view missing: ${needle}`);
}

// The RFH gala screening of Glass Harbour clashes with the Surprise Film →
// it must appear as blocked in the map, and Friday's Vue screening as chosen.
const blocked = await page.locator(".map-chips .map-chip.blocked").allTextContents();
if (!blocked.some((t) => t.includes("Thu 9 Oct"))) fail(`expected the Thu 9 Oct gala chip blocked, got: ${blocked}`);
const chosen = await page.locator(".map-chips .map-chip.chosen").allTextContents();
if (!chosen.some((t) => t.includes("Fri 10 Oct") && t.includes("Vue West End")))
  fail(`expected Fri Vue chip chosen, got: ${chosen}`);

// Clicking the blocked chip explains the conflict.
await page.locator(".map-chips .map-chip.blocked").first().click();
const explain = await page.locator(".map-explain").textContent();
if (!explain.includes("Surprise Film")) fail(`conflict explanation missing Surprise Film: ${explain}`);

// Amy day-target chips render.
const amyChip = await page.locator(".amy-target").first().textContent();
if (!/Amy \d\/\d/.test(amyChip)) fail(`amy target chip malformed: ${amyChip}`);

console.log(process.exitCode ? "SCHEDULE E2E FAILED" : "SCHEDULE E2E PASSED — compute, timeline, travel gaps, screening map, conflict explanations, Amy targets all OK");
await browser.close();
