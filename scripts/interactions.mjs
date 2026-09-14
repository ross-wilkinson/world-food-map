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

// --- the exposure view -------------------------------------------------------
await page.click('#direction button[data-dir="world"]');
await page.selectOption("#commodity", "wheat");
await page.waitForSelector("#loading.gone", { state: "attached" });
await page.click('#world-metric button[data-m="risk"]');
await page.waitForTimeout(400);

const quad = await page.evaluate(() => {
  const key = [...document.querySelectorAll(".qm-cell")].map((el) => ({
    label: el.querySelector(".lab").textContent.trim(),
    n: Number(el.querySelector("b").textContent),
  }));
  const tile = document.querySelectorAll(".tile-value")[1].textContent.replace(/\s+/g, " ").trim();
  return { key, tile, body: document.querySelector("#panel-body").textContent };
});
check("the drawn quadrant fills all four cells", quad.key.length === 4 && quad.key.every((k) => k.n > 0),
  quad.key.map((k) => `${k.label}=${k.n}`).join(", "));
const cellTotal = quad.key.reduce((a, k) => a + k.n, 0);
check("the tile total matches the drawn cells", quad.tile.endsWith(`of ${cellTotal}`),
  `tile "${quad.tile}", cells sum ${cellTotal}`);
const shape = await page.evaluate(() => {
  const cells = [...document.querySelectorAll(".qm-cell")].map((e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), label: e.querySelector(".lab").textContent.trim() };
  });
  const cols = new Set(cells.map((c) => c.x)).size;
  const rows = new Set(cells.map((c) => c.y)).size;
  const axes = [...document.querySelectorAll(".qm-x span, .qm-y")].map((e) => e.textContent.trim());
  return { cols, rows, axes, order: cells.map((c) => c.label) };
});
check("the quadrant is laid out as a real 2x2 with both axes labelled",
  shape.cols === 2 && shape.rows === 2 && shape.axes.length === 4,
  `${shape.cols} cols x ${shape.rows} rows, axes: ${shape.axes.join(" / ")}`);
check("the worst cell sits bottom-right", shape.order[3] === "Most exposed",
  `reading order: ${shape.order.join(" -> ")}`);

check("exposure view has no undefined/NaN", !/undefined|NaN/.test(quad.body),
  quad.body.replace(/\s+/g, " ").trim().slice(0, 80));

// The separation the view exists to make: equally import-reliant, opposite ends.
const placed = await page.evaluate(() => {
  const out = {};
  let head = null;
  for (const li of document.querySelectorAll(".rank li")) {
    if (li.classList.contains("head")) head = li.querySelector(".lab").textContent.split("·")[0].trim();
    else if (li.dataset.id) out[li.querySelector(".nm").textContent.trim().replace(/ not on map$/, "")] = head;
  }
  return out;
});
check("Tunisia reads as most exposed on wheat", placed["Tunisia"] === "Most exposed",
  `Tunisia -> ${placed["Tunisia"]}`);
const wealthy = ["United Arab Emirates", "Qatar", "Norway", "Saudi Arabia"];
check("a wealthy importer is separated from it",
  wealthy.some((c) => placed[c] === "Exposed, can pay"),
  wealthy.map((c) => `${c} -> ${placed[c]}`).join(", "));

// --- the map key names every colour, on one line each ------------------------
// The first version was four bare swatches with axis captions that could not be
// aligned to the rows they described, so a reader had to decode colours against a
// key in the other panel. A wrapped label is what made it unreadable, so the line
// count is asserted, not just the text. The key names the colours and defers the
// rest to the panel, so the two must agree on both wording and order.
const key = await page.evaluate(() => {
  const cells = [...document.querySelectorAll("#legend .legend-cats li span")].map((span) => {
    const lh = parseFloat(getComputedStyle(span).lineHeight);
    return { label: span.textContent.trim(), lines: Math.round(span.getBoundingClientRect().height / lh) };
  });
  const panel = [...document.querySelectorAll(".qm-cell .lab")].map((e) => e.textContent.trim());
  const legend = document.querySelector("#legend");
  return { cells, panel, pointsToPanel: /panel/i.test(legend.textContent),
           width: Math.round(legend.getBoundingClientRect().width) };
});
check("the key names all four cells", key.cells.length === 4,
  key.cells.map((c) => c.label).join(", "));
check("no key label wraps to a second line", key.cells.every((c) => c.lines === 1),
  key.cells.map((c) => `${c.label}=${c.lines}ln`).join(", "));
check("key and panel use one wording per category",
  key.cells.every((c) => key.panel.includes(c.label)),
  `key [${key.cells.map((c) => c.label)}] vs matrix [${key.panel}]`);
check("the key points at the panel rather than re-explaining", key.pointsToPanel,
  `legend is ${key.width}px wide`);
// The matrix is laid out spatially, so its order is the quadrant's, not the key's.
// What has to hold is that both name the same four things.
check("key and matrix cover the same four categories",
  [...key.cells.map((c) => c.label)].sort().join("|") === [...key.panel].sort().join("|"),
  `key [${key.cells.map((c) => c.label)}] vs matrix [${key.panel}]`);

// --- "little exposure" must not read as "no data" ---------------------------
// This regressed once: the first dark --q-clear was the same blue-grey as --land
// a few steps lighter, and on the globe the two were indistinguishable. Lightness
// alone is not enough at low luminance, so the check is that they lean opposite
// ways on the warm/cool axis, and that both actually reach the canvas.
for (let i = 0; i < 3; i++) {
  const t = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (t === "dark") break;
  await page.click("#theme-toggle");
  await page.waitForTimeout(150);
}
await page.waitForTimeout(900);
const contrast = await page.evaluate(() => {
  const rgb = (t) => {
    const n = parseInt(getComputedStyle(document.documentElement).getPropertyValue(t).trim().slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const clear = rgb("--q-clear"), land = rgb("--land");
  const cv = document.querySelector("#globe");
  const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
  let nClear = 0, nLand = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === clear[0] && d[i + 1] === clear[1] && d[i + 2] === clear[2]) nClear++;
    else if (d[i] === land[0] && d[i + 1] === land[1] && d[i + 2] === land[2]) nLand++;
  }
  const lean = (c) => Math.sign(c[0] - c[2]);   // warm (+1) vs cool (-1)
  return { nClear, nLand, clear, land, opposed: lean(clear) !== lean(land) };
});
check("no-exposure is distinguishable from no-data on the globe",
  contrast.nClear > 500 && contrast.nLand > 500 && contrast.opposed,
  `clear rgb(${contrast.clear}) x${contrast.nClear}, land rgb(${contrast.land}) x${contrast.nLand}, opposed=${contrast.opposed}`);

// A feed crop must say why it looks empty rather than just looking empty.
await page.selectOption("#commodity", "soybeans");
await page.waitForSelector("#loading.gone", { state: "attached" });
await page.waitForTimeout(400);
const soy = await page.textContent("#panel-body");
check("feed/oil crops explain their low exposure", /eaten directly by people/i.test(soy),
  (soy.match(/Only [^.]+\./) || ["not found"])[0].slice(0, 90));

await browser.close();
console.log("\n=== PROBLEMS ===");
console.log(problems.length ? [...new Set(problems)].map((p) => " - " + p).join("\n") : "none");
process.exit(problems.length ? 1 : 0);
