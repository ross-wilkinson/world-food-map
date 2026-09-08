/** Drive the built site in a real browser, capture screenshots and surface errors. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.REVIEW_URL ?? "http://localhost:4173";
const OUT = process.env.SHOT_DIR ?? "shots";
mkdirSync(OUT, { recursive: true });

const problems = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

async function shot(name, waitMs = 900) {
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  shot ${name}`);
}

/** Drive the app's own toggle until it lands on the wanted theme, so the canvas
    colours are re-read through the same path a real user triggers. */
async function setTheme(theme) {
  for (let i = 0; i < 3; i++) {
    const now = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    if (now === theme) return;
    await page.click("#theme-toggle");
    await page.waitForTimeout(120);
  }
  const got = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (got !== theme) problems.push(`theme toggle stuck: wanted ${theme}, got ${got}`);
}

console.log("loading", BASE);
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("#loading.gone", { state: "attached", timeout: 20000 });

// ---- 1. world view, dark
await setTheme("dark");
await shot("01-world-dark", 1400);

// ---- 2. world view ranked by exports
await page.click('#world-metric button[data-m="exports"]');
await shot("02-world-exports");

// ---- 3. pick-a-country state
await page.click('#direction button[data-dir="imports"]');
await shot("03-pick-country");

// ---- 4. a country's imports
await page.fill("#country-search", "Egypt");
await page.press("#country-search", "Enter");
await shot("04-egypt-imports", 1600);

const egypt = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#panel-body .rank li")].slice(0, 5)
    .map((li) => li.querySelector(".nm")?.textContent?.trim() + " " + li.querySelector(".pc")?.textContent?.trim());
  return {
    heading: document.querySelector("#panel-body h2")?.textContent,
    tiles: [...document.querySelectorAll(".tile")].map((t) =>
      `${t.querySelector(".tile-label")?.textContent?.trim()} = ${t.querySelector(".tile-value")?.textContent?.trim()}`),
    rows,
    legend: document.querySelector("#legend .legend-title")?.textContent,
  };
});
console.log("\nEGYPT PANEL:", JSON.stringify(egypt, null, 2));

// ---- 5. exports view for a big exporter
await page.fill("#country-search", "Brazil");
await page.press("#country-search", "Enter");
await page.click('#direction button[data-dir="exports"]');
await page.selectOption("#commodity", "soybeans");
await page.waitForSelector("#loading.gone", { state: "attached" });
await shot("05-brazil-soy-exports", 1800);

const brazil = await page.evaluate(() => ({
  heading: document.querySelector("#panel-body h2")?.textContent,
  tiles: [...document.querySelectorAll(".tile")].map((t) =>
    `${t.querySelector(".tile-label")?.textContent?.trim()} = ${t.querySelector(".tile-value")?.textContent?.trim()}`),
  rows: [...document.querySelectorAll("#panel-body .rank li")].slice(0, 5)
    .map((li) => li.querySelector(".nm")?.textContent?.trim() + " " + li.querySelector(".pc")?.textContent?.trim()),
  note: document.querySelector("#panel-body .note")?.textContent?.trim().slice(0, 200),
}));
console.log("\nBRAZIL PANEL:", JSON.stringify(brazil, null, 2));

// ---- 6. flat map
await page.click("#projection");
await shot("06-flat-exports", 1600);

// ---- 7. light theme
await setTheme("light");
await shot("07-flat-light", 1400);

// ---- 8. back to globe, world view, light
await page.click("#projection");
await page.click('#direction button[data-dir="world"]');
await shot("08-world-light", 1400);

// ---- 9. year scrub
await page.click("#projection");
await page.fill("#country-search", "Egypt");
await page.press("#country-search", "Enter");
await page.click('#direction button[data-dir="imports"]');
await page.selectOption("#commodity", "wheat");
await page.waitForSelector("#loading.gone", { state: "attached" });
await setTheme("dark");
const early = await page.evaluate(() => {
  const r = document.querySelector("#year");
  r.value = "3"; r.dispatchEvent(new Event("input", { bubbles: true }));
  return document.querySelector("#year-out")?.textContent;
});
await shot("09-egypt-2013", 1600);
const early2013 = await page.evaluate(() => [...document.querySelectorAll("#panel-body .rank li")].slice(0, 4)
  .map((li) => li.querySelector(".nm")?.textContent?.trim() + " " + li.querySelector(".pc")?.textContent?.trim()));
console.log(`\nEGYPT ${early} wheat sources:`, early2013);

// ---- 10. methodology dialog
await page.click("#open-method");
await shot("10-method", 600);
await page.keyboard.press("Escape");

// ---- 11. narrow viewport
await page.setViewportSize({ width: 420, height: 850 });
await shot("11-mobile", 1400);

// ---- layout overflow check
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => ({
  bodyScrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
if (overflow.bodyScrollW > overflow.clientW + 1) {
  problems.push(`horizontal overflow: ${overflow.bodyScrollW} > ${overflow.clientW}`);
}

await browser.close();

console.log("\n=== PROBLEMS ===");
if (!problems.length) console.log("none");
else for (const p of [...new Set(problems)]) console.log(" -", p);
