import { chromium } from "playwright";

const chrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
const page = await browser.newPage();
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };

await page.goto("http://localhost:4173/#/browse");
await page.waitForSelector(".film-row");

// 1. Toggle flags on The Glass Harbour via its row buttons (T + P).
const row = page.locator(".film-row", { hasText: "The Glass Harbour" });
await row.locator(".flag-tristan").click();
await row.locator(".flag-priority").click();

// 2. Keyboard triage: focus list, toggle Amy on the first film (Cold Lacquer).
await page.keyboard.press("j");
await page.keyboard.press("a");

// 3. Search filter narrows the list.
await page.keyboard.press("/");
await page.keyboard.type("mother");
await page.waitForTimeout(100);
const count = await page.locator(".film-row").count();
if (count !== 2) fail(`search 'mother' showed ${count} rows, expected 2`);

// 4. Flag filter chip: clear search, filter to Tristan=on.
await page.fill(".search", "");
await page.locator(".chip-tristan").click();
await page.waitForTimeout(100);
const tristanRows = await page.locator(".film-row").allTextContents();
if (tristanRows.length !== 1 || !tristanRows[0].includes("The Glass Harbour"))
  fail(`tristan filter showed: ${JSON.stringify(tristanRows)}`);
await page.locator(".chip-tristan").click(); // -> off
await page.locator(".chip-tristan").click(); // -> any

// 5. Reload: selections must survive.
await page.reload();
await page.waitForSelector(".film-row");
const glass = page.locator(".film-row", { hasText: "The Glass Harbour" });
for (const [flag, expected] of [["tristan", "true"], ["priority", "true"], ["amy", "false"]]) {
  const pressed = await glass.locator(`.flag-${flag}`).getAttribute("aria-pressed");
  if (pressed !== expected) fail(`after reload, glass-harbour ${flag} aria-pressed=${pressed}, want ${expected}`);
}
const cold = page.locator(".film-row", { hasText: "Cold Lacquer" });
if ((await cold.locator(".flag-amy").getAttribute("aria-pressed")) !== "true")
  fail("after reload, cold-lacquer amy flag lost");

// 6. Progress counter reflects two triaged films.
const progress = await page.locator(".progress").textContent();
if (!progress.includes("2/10")) fail(`progress shows '${progress}', want 2/10`);

// 7. Detail view: pin a screening, add a note; verify after reload.
await page.goto("http://localhost:4173/#/film/the-glass-harbour");
await page.waitForSelector(".screening");
await page.locator(".screening").first().locator("button", { hasText: "Pin" }).click();
await page.fill(".notes", "book premium seats");
await page.locator(".notes").blur();
await page.waitForTimeout(400);
await page.reload();
await page.waitForSelector(".screening");
if ((await page.locator(".screening.pinned").count()) !== 1) fail("pin lost after reload");
if ((await page.inputValue(".notes")) !== "book premium seats") fail("notes lost after reload");

// 8. Manual event: add Surprise Film, check it appears in Browse and Schedule.
await page.goto("http://localhost:4173/#/browse");
await page.waitForSelector(".film-row");
await page.locator("button", { hasText: "+ Event" }).click();
await page.fill(".manual-event-form input[placeholder='Surprise Film']", "Surprise Film");
await page.locator(".manual-event-form input[type=date]").fill("2025-10-09");
await page.locator(".manual-event-form input[type=time]").fill("20:45");
await page.selectOption(".manual-event-form select", "royal-festival-hall");
await page.locator(".checkbox", { hasText: "Priority" }).locator("input").check();
await page.locator("button.primary", { hasText: "Add event" }).click();
await page.waitForSelector(".film-row.manual");
const manualText = await page.locator(".film-row.manual").textContent();
if (!manualText.includes("Surprise Film") || !manualText.includes("Thu 9 Oct"))
  fail(`manual event row: ${manualText}`);

await page.goto("http://localhost:4173/#/schedule");
await page.waitForSelector(".schedule-row");
const schedText = await page.locator(".schedule").textContent();
for (const needle of ["Surprise Film", "The Glass Harbour", "Royal Festival Hall", "Cold Lacquer"]) {
  if (!schedText.includes(needle)) fail(`schedule view missing: ${needle}`);
}

// 9. Export produces a valid selections file.
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.goto("http://localhost:4173/#/browse").then(async () => {
    await page.waitForSelector(".film-row");
    await page.locator("button", { hasText: "Export" }).click();
  }),
]);
const path = await download.path();
const { readFileSync } = await import("node:fs");
const exported = JSON.parse(readFileSync(path, "utf-8"));
if (exported.festivalYear !== 2025) fail("export festivalYear wrong");
if (!exported.films["the-glass-harbour"]?.tristan) fail("export missing glass-harbour tristan flag");
if (exported.manualEvents.length !== 1) fail("export missing manual event");

console.log(process.exitCode ? "SMOKE TEST FAILED" : "SMOKE TEST PASSED — flags, keyboard, search, filters, persistence, pin/notes, manual event, schedule view, export all OK");
await browser.close();
