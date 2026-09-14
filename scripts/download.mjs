/**
 * Fetch the two FAOSTAT bulk archives the pipeline reads.
 *
 * The trade matrix is ~420 MB zipped and ~8.5 GB unzipped; nothing here unzips it,
 * the extract step streams rows straight out of the archive.
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SOURCES = [
  {
    name: "trade_matrix.zip",
    url: "https://bulks-faostat.fao.org/production/Trade_DetailedTradeMatrix_E_All_Data_(Normalized).zip",
  },
  {
    name: "fbs.zip",
    url: "https://bulks-faostat.fao.org/production/FoodBalanceSheets_E_All_Data_(Normalized).zip",
  },
  {
    // Tiny next to the other two. Carries the indicators FAO publishes and we
    // cannot derive: what a country's food import bill costs it, and what it
    // earns -- the difference between a country that imports everything and can
    // pay, and one that imports everything and cannot.
    name: "food_security.zip",
    url: "https://bulks-faostat.fao.org/production/Food_Security_Data_E_All_Data_(Normalized).zip",
  },
];

mkdirSync("data/raw", { recursive: true });

for (const { name, url } of SOURCES) {
  const dest = `data/raw/${name}`;
  if (existsSync(dest) && !process.argv.includes("--force")) {
    console.log(`${name}: already present (${(statSync(dest).size / 1e6).toFixed(0)} MB), skipping. --force to refetch`);
    continue;
  }
  console.log(`downloading ${name} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`  ${name}: ${(statSync(dest).size / 1e6).toFixed(0)} MB`);
}
console.log("done");
