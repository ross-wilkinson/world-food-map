/** Checks the behaviours a screenshot cannot show: hover, play, edge-case countries. */
import { chromium } from "playwright";

const BASE = process.env.REVIEW_URL ?? "http://localhost:4173";
const problems = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text()}`); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("#loading.gone", { state: "attached" });

const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) problems.push(`${label}: ${detail}`);
};

// --- hover tooltip over the globe -------------------------------------------
const box = await page.locator("#globe").boundingBox();
let tip = null;
for (let dx = -160; dx <= 160 && !tip; dx += 20) {
  for (let dy = -120; dy <= 120 && !tip; dy += 20) {
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await page.waitForTimeout(45);
    const t = await page.evaluate(() => {
      const el = document.querySelector("#tooltip");
      return el?.classList.contains("on") ? el.textContent.trim() : null;
    });
    if (t) tip = t;
  }
}
check("hover tooltip appears over a country", !!tip, tip ?? "never shown");

// --- play button advances the year ------------------------------------------
await page.evaluate(() => {
  const r = document.querySelector("#year");
  r.value = "0"; r.dispatchEvent(new Event("input", { bubbles: true }));
});
const y0 = await page.textContent("#year-out");
await page.click("#play");
await page.waitForTimeout(2600);
const y1 = await page.textContent("#year-out");
await page.click("#play");
check("play advances the year", y0 !== y1, `${y0} -> ${y1}`);

const stopped = await page.evaluate(() => document.querySelector("#play").classList.contains("playing"));
check("play toggles back off", !stopped);

// --- a country whose flows are mirrored from partner reports -----------------
await page.selectOption("#commodity", "rice");
await page.waitForSelector("#loading.gone", { state: "attached" });
await page.evaluate(() => {
  const r = document.querySelector("#year");
  r.value = String(r.max); r.dispatchEvent(new Event("input", { bubbles: true }));
});
const mirrored = await page.evaluate(async () => {
  const meta = await (await fetch("./data/meta.json")).json();
  const d = await (await fetch("./data/flows/rice.json")).json();
  const yr = meta.years[meta.years.length - 1];
  const slice = d.years[String(yr)];
  const hit = Object.entries(slice.c).find(([, r]) => r.iM && r.i && r.i.length > 3);
  return hit ? { id: hit[0], name: meta.countries[hit[0]]?.name } : null;
});
if (mirrored) {
  await page.fill("#country-search", mirrored.name);
  await page.press("#country-search", "Enter");
  await page.click('#direction button[data-dir="imports"]');
  await page.waitForTimeout(300);
  const note = await page.textContent("#panel-body .note");
  check(`mirrored data is disclosed (${mirrored.name})`, /mirrored/i.test(note), note.trim().slice(0, 110));
} else {
  check("found a mirrored country to test", false, "none in latest rice year");
}

// --- the folded-up "Other partners" tail renders and is not clickable --------
const other = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#panel-body .rank li")]
    .find((x) => x.textContent.includes("Other partners"));
  return li ? { cls: li.className, txt: li.textContent.replace(/\s+/g, " ").trim() } : null;
});
check("Other-partners tail renders when present", other === null || other.cls.includes("other"),
  other ? other.txt : "not present for this country (fine)");

// --- selecting a country with no data for the year --------------------------
await page.fill("#country-search", "Iceland");
await page.press("#country-search", "Enter");
await page.waitForTimeout(300);
const iceland = await page.textContent("#panel-body");
check("no-data country degrades gracefully", iceland.length > 20 && !/undefined|NaN/.test(iceland),
  iceland.replace(/\s+/g, " ").trim().slice(0, 90));

// --- percentages sum sensibly ------------------------------------------------
await page.selectOption("#commodity", "wheat");
await page.waitForSelector("#loading.gone", { state: "attached" });
await page.fill("#country-search", "Japan");
await page.press("#country-search", "Enter");
await page.click('#direction button[data-dir="imports"]');
await page.waitForTimeout(300);
const sum = await page.evaluate(() => [...document.querySelectorAll("#panel-body .rank .pc")]
  .map((e) => parseFloat(e.textContent)).filter(Number.isFinite).reduce((a, b) => a + b, 0));
check("import shares sum to ~100%", Math.abs(sum - 100) < 3, `sum = ${sum.toFixed(1)}%`);

// --- keyboard: Escape clears the selection ----------------------------------
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
const cleared = await page.inputValue("#country-search");
check("Escape clears the selected country", cleared === "", `search = "${cleared}"`);

await browser.close();
console.log("\n=== PROBLEMS ===");
console.log(problems.length ? [...new Set(problems)].map((p) => " - " + p).join("\n") : "none");
process.exit(problems.length ? 1 : 0);
