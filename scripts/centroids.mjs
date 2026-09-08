// Emit a lon/lat anchor per country for drawing trade arcs.
// Whole-feature centroids misplace countries with distant territories (France ->
// pulled toward French Guiana, US -> toward Alaska/Hawaii, Ecuador -> Galapagos),
// so we anchor on each country's largest polygon by spherical area instead.
import { readFileSync, writeFileSync } from "node:fs";
import { geoCentroid, geoArea } from "d3-geo";
import { feature } from "topojson-client";

const topo = JSON.parse(readFileSync("web/public/data/countries-110m.json", "utf8"));
const fc = feature(topo, topo.objects.countries);

// Only for cases the largest-polygon rule still gets wrong.
const OVERRIDES = { "643": [93, 62] }; // Russia: spans the antimeridian

const out = {};
for (const f of fc.features) {
  const id = String(f.id);
  let anchor;
  if (OVERRIDES[id]) {
    anchor = OVERRIDES[id];
  } else if (f.geometry?.type === "MultiPolygon") {
    let best = null, bestArea = -1;
    for (const coords of f.geometry.coordinates) {
      const poly = { type: "Polygon", coordinates: coords };
      const a = geoArea(poly);
      if (a > bestArea) { bestArea = a; best = poly; }
    }
    anchor = geoCentroid(best);
  } else if (f.geometry) {
    anchor = geoCentroid(f);
  } else {
    continue;
  }
  if (!Number.isFinite(anchor[0]) || !Number.isFinite(anchor[1])) continue;
  out[id] = { name: f.properties?.name ?? id, lon: +anchor[0].toFixed(3), lat: +anchor[1].toFixed(3) };
}
writeFileSync("data/interim/centroids.json", JSON.stringify(out, null, 1));
console.log(`wrote ${Object.keys(out).length} centroids`);
for (const id of ["250", "840", "620", "218", "152", "578", "643", "156", "554"])
  console.log(" ", id, out[id]);
