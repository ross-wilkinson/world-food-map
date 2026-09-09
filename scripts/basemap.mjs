/**
 * Build the basemap, splitting out territories the atlas merges into a parent country
 * but FAOSTAT reports separately.
 *
 * Natural Earth draws French Guiana as one of the three polygons of "France", so on a
 * raw world-atlas basemap a chunk of South America is hit-tested as France and shaded
 * with metropolitan France's food balance. FAOSTAT accounts it separately (M49 254),
 * so painting France's numbers over it asserts something untrue about that territory.
 * Split it into its own feature: with no FAOSTAT record of its own it renders as
 * no-data, which is the honest answer.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { feature } from "topojson-client";
import { geoCentroid } from "d3-geo";

const SRC = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const CACHE = "data/interim/countries-110m.raw.json";
const OUT = "web/public/data/countries-110m.json";

/** Polygons to lift out of a parent feature, matched on where they sit. */
const SPLITS = [
  {
    from: "250", to: "254", name: "French Guiana",
    inside: ([lon, lat]) => lon < -30 && lat > -20 && lat < 20,
  },
];

let raw;
if (existsSync(CACHE)) {
  raw = readFileSync(CACHE, "utf8");
} else {
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`${SRC} -> HTTP ${res.status}`);
  raw = await res.text();
  writeFileSync(CACHE, raw);
}
const topo = JSON.parse(raw);
const geoms = topo.objects.countries.geometries;

for (const split of SPLITS) {
  const g = geoms.find((x) => String(x.id) === split.from);
  if (!g) throw new Error(`no feature ${split.from} to split`);
  if (g.type !== "MultiPolygon") throw new Error(`${split.from} is ${g.type}, expected MultiPolygon`);

  const keep = [], move = [];
  for (const polyArcs of g.arcs) {
    const centre = geoCentroid(feature(topo, { type: "Polygon", arcs: polyArcs }));
    (split.inside(centre) ? move : keep).push(polyArcs);
  }
  if (!move.length) throw new Error(`nothing matched for ${split.name}`);
  if (!keep.length) throw new Error(`${split.from} would be left empty`);

  g.arcs = keep;
  if (keep.length === 1) { g.type = "Polygon"; g.arcs = keep[0]; }
  geoms.push({
    type: move.length > 1 ? "MultiPolygon" : "Polygon",
    arcs: move.length > 1 ? move : move[0],
    id: split.to,
    properties: { name: split.name },
  });
  console.log(`split ${split.name} (${split.to}) out of ${split.from}: ` +
              `${move.length} polygon(s) moved, ${keep.length} kept`);
}

writeFileSync(OUT, JSON.stringify(topo));
console.log(`wrote ${OUT}, ${geoms.length} features`);
