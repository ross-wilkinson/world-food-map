/** Measures real load time, and confirms what happens on a file:// open. */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const browser = await chromium.launch();

async function timeLoad(url, label, throttle) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("requestfailed", (r) => errs.push(`FAILED ${r.url().split("/").pop()} :: ${r.failure()?.errorText}`));

  if (throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false, latency: throttle.latency,
      downloadThroughput: throttle.kbps * 1024 / 8,
      uploadThroughput: throttle.kbps * 1024 / 8,
    });
  }

  const t0 = Date.now();
  let ms = null, state = "";
  try {
    await page.goto(url, { waitUntil: "commit", timeout: 20000 });
    await page.waitForFunction(
      () => document.querySelector("#loading")?.classList.contains("gone"),
      { timeout: 20000 });
    ms = Date.now() - t0;
  } catch {
    state = await page.evaluate(() => document.querySelector("#loading")?.textContent?.trim() ?? "(no #loading)")
      .catch(() => "(page did not run)");
  }
  console.log(`\n${label}`);
  console.log(ms !== null ? `  loaded in ${ms} ms` : `  NEVER FINISHED -- shows: "${state}"`);
  if (errs.length) for (const e of [...new Set(errs)].slice(0, 3)) console.log(`  ! ${e.slice(0, 150)}`);
  await ctx.close();
}

await timeLoad("http://localhost:4173/", "A. Local preview server (npm run preview)");
await timeLoad("http://localhost:4173/", "B. Same, throttled to 5 Mbps / 60 ms latency (typical broadband)",
  { kbps: 5000, latency: 60 });
await timeLoad("http://localhost:4173/", "C. Same, throttled to 1.5 Mbps / 150 ms (slow connection)",
  { kbps: 1500, latency: 150 });
await timeLoad(pathToFileURL(resolve("dist/index.html")).href, "D. Opening dist/index.html directly (file://)");
await timeLoad(pathToFileURL(resolve("web/index.html")).href, "E. Opening web/index.html directly (file://)");

await browser.close();
