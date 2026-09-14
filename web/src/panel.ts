/** Side panel: stat tiles plus the ranked partner list that carries the percentages. */
import {
  METRICS, OTHER, PARTNER_BINS, QUADRANTS, RISK, binIndex, importedKcal, pct,
  quadrantColors, quadrantOf, scaleFor, tonnes, worldTotalFor,
} from "./model";
import type {
  CountryYear, Direction, Meta, Quadrant, Security, WorldMetric, YearSlice,
} from "./model";

export type { WorldMetric };

export interface PanelState {
  meta: Meta;
  slice: YearSlice;
  commodityName: string;
  commodityPrimary: string;
  commodityNote: string;
  year: number;
  direction: Direction;
  selected: string | null;
  worldMetric: WorldMetric;
  ramp: string[];
  flowRamp: string[];
  security: Security;
  secYearIdx: number;
}

export interface PanelHandlers {
  onSelect(id: string): void;
  onHoverPartner(id: string | null): void;
  onWorldMetric(m: WorldMetric): void;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const nameOf = (meta: Meta, id: string) =>
  id === OTHER ? "Other partners" : meta.countries[id]?.name ?? id;

export function renderPanel(el: HTMLElement, s: PanelState, h: PanelHandlers) {
  el.innerHTML = s.direction === "world" || !s.selected ? worldHtml(s) : countryHtml(s);
  wire(el, s, h);
}

/* ------------------------------------------------------------------ world view */

function worldHtml(s: PanelState): string {
  const { slice, meta } = s;
  const needsPick = s.direction !== "world" && !s.selected;
  const metric: WorldMetric = needsPick
    ? (s.direction === "imports" ? "imports" : "exports")
    : s.worldMetric;

  const spec = METRICS[metric];
  const denom = worldTotalFor(slice.world, metric);
  const absolute = spec.mode === "absolute";
  const quad = spec.mode === "quadrant";
  const placed = quad ? placeAll(s) : [];
  const atRisk = placed.filter((p) => p.q === "risk").length;

  const rows = Object.entries(slice.c)
    .filter(([, r]) => !spec.minSupply || (r.ds ?? 0) >= spec.minSupply)
    .map(([id, r]) => [id, spec.value(r), r.ds ?? 0] as const)
    .filter((kv): kv is readonly [string, number, number] =>
      kv[1] !== undefined && (spec.mode === "diverging" ? kv[1] >= 0 : kv[1] > 0))
    // ties at 0% are common (plenty of countries grow no wheat at all), so break
    // them by how much the country actually uses -- the biggest are the story
    .sort((a, b) => (spec.sort === "asc" ? a[1] - b[1] || b[2] - a[2] : b[1] - a[1]))
    .slice(0, 25);

  const traded = slice.world.production
    ? (slice.world.exports / slice.world.production) * 100 : NaN;
  const ratio = slice.world.exports ? slice.world.imports / slice.world.exports : NaN;
  const eatenShare = slice.world.production
    ? (slice.world.food / slice.world.production) * 100 : NaN;
  const rated = Object.values(slice.c).filter((r) => (r.ds ?? 0) >= 50000);
  const leaning = rated.filter((r) => ((r.p ?? 0) / r.ds!) * 100 < 50).length;

  const head = needsPick
    ? `<h2>Pick a country</h2>
       <p class="sub">Click any country on the map, or choose from the biggest
       ${s.direction === "imports" ? "importers" : "exporters"} below, to see its
       ${esc(s.commodityName.toLowerCase())} ${s.direction}.</p>`
    : `<h2>${esc(s.commodityName)} worldwide</h2>
       <p class="sub">${s.year} &middot; who grows it and who ships it</p>
       <div class="tiles">
         <div class="tile"><div class="tile-label">World production</div>
           <div class="tile-value">${tonnes(slice.world.production)}</div></div>
         ${metric === "risk"
           ? `<div class="tile"><div class="tile-label">Exposed and least able to absorb it</div>
              <div class="tile-value">${atRisk}<span style="font-size:13px;font-weight:400"> of ${placed.length}</span></div></div>`
           : metric === "reliance"
           ? `<div class="tile"><div class="tile-label">Grow under half what they use</div>
              <div class="tile-value">${leaning}<span style="font-size:13px;font-weight:400"> of ${rated.length}</span></div></div>`
           : metric === "percap"
           ? `<div class="tile"><div class="tile-label">World average, per person</div>
              <div class="tile-value">${slice.world.foodPerCapita.toFixed(0)} kg</div></div>`
           : metric === "food"
           ? `<div class="tile"><div class="tile-label">Eaten by people</div>
              <div class="tile-value">${tonnes(slice.world.food)}</div></div>`
           : `<div class="tile"><div class="tile-label">World ${metric === "imports" ? "imports" : "exports"}</div>
              <div class="tile-value">${tonnes(metric === "imports" ? slice.world.imports : slice.world.exports)}</div></div>`}
         ${metric === "risk" ? `
         <div class="tile wide"><div class="tile-label">Two axes, not a score</div>
           <div class="tile-value" style="font-size:13px;font-weight:500;letter-spacing:0">Exposure &times; room to absorb it</div>
           <div class="tile-note">The ${RISK.kcal} kcal line is <b>our choice</b>, not a
             published threshold &mdash; roughly a tenth of a day's food. The capacity cuts
             were chosen against undernourishment, which is deliberately never an input to
             where a country lands. This maps exposure to a shock, not hunger today.</div></div>`
           : metric === "reliance" ? `
         <div class="tile wide"><div class="tile-label">100% means a country grows exactly what it uses</div>
           <div class="tile-value" style="font-size:13px;font-weight:500;letter-spacing:0">Two different exposures</div>
           <div class="tile-note">Below 100% a country depends on other harvests and other
             governments' export rules &mdash; the harder one to escape, since capacity cannot be
             grown in a season. Above it, the risk is its own weather and its export markets,
             which buying abroad can usually cover. Neither end is coloured as the bad one.</div></div>`
           : metric === "food" || metric === "percap" ? `
         <div class="tile wide"><div class="tile-label">Share of the crop that people eat directly</div>
           <div class="tile-value">${pct(eatenShare)}</div>
           <div class="tile-note">The rest is animal feed, seed, industrial use or loss.
             ${metric === "percap"
               ? "Per-person figures below count only the part people eat, so a big feed-grain buyer can rank low."
               : "Food use, not imports, is who actually eats it."}</div></div>` : metric === "imports" ? `
         <div class="tile wide"><div class="tile-label">World imports measured against world exports</div>
           <div class="tile-value">${ratio.toFixed(2)}&times;</div>
           <div class="tile-note">Every tonne shipped is imported once, so this should be 1&times;.
             ${ratio > 1.03
               ? "The excess is processed product counted again each time it crosses a border, which is why milling and re-export hubs rank high below."
               : "It roughly is, so this crop moves as the raw commodity and the ranking below is close to real buyers."}</div></div>` : `
         <div class="tile wide"><div class="tile-label">Share of production that crosses a border</div>
           <div class="tile-value">${pct(traded)}</div>
           <div class="tile-note">The rest is eaten, fed or processed at home.</div></div>`}
       </div>
       <div class="ctl" style="margin-top:14px">
         <span class="ctl-label">Rank &amp; shade by</span>
         <div class="segmented" id="world-metric" role="radiogroup" aria-label="World metric">
           <button type="button" role="radio" data-m="production" aria-checked="${metric === "production"}"
             class="${metric === "production" ? "on" : ""}">Production</button>
           <button type="button" role="radio" data-m="exports" aria-checked="${metric === "exports"}"
             class="${metric === "exports" ? "on" : ""}">Exports</button>
           <button type="button" role="radio" data-m="imports" aria-checked="${metric === "imports"}"
             class="${metric === "imports" ? "on" : ""}">Imports</button>
           <button type="button" role="radio" data-m="food" aria-checked="${metric === "food"}"
             class="${metric === "food" ? "on" : ""}">Food use</button>
           <button type="button" role="radio" data-m="percap" aria-checked="${metric === "percap"}"
             class="${metric === "percap" ? "on" : ""}">Per person</button>
           <button type="button" role="radio" data-m="reliance" aria-checked="${metric === "reliance"}"
             class="${metric === "reliance" ? "on" : ""}">Reliance</button>
           <button type="button" role="radio" data-m="risk" aria-checked="${metric === "risk"}"
             class="${metric === "risk" ? "on" : ""}">Exposure</button>
         </div>
       </div>`;

  // Bars are scaled to the leader, the way a bar chart's axis is; the label
  // carries the true value, which is rarely anywhere near the maximum.
  const top = rows[0]?.[1] ?? 1;
  const items = rows.map(([id, v]) => {
    const scale = spec.mode === "share" ? (denom ? (v / denom) * 100 : 0) : v;
    const c = s.ramp[binIndex(scale, scaleFor(metric).bins)]!;
    const value = spec.mode === "absolute" ? `${v.toFixed(0)} kg`
      : spec.mode === "diverging" ? `${v.toFixed(0)}%` : pct(scale);
    const title = spec.mode === "absolute" ? `${v.toFixed(1)} kg per person per year`
      : spec.mode === "diverging" ? `grows ${v.toFixed(0)}% of what it uses`
      : tonnes(v);
    // for reliance the bar shows the share NOT grown at home, so the longest bar
    // is the most import-reliant country rather than the largest producer
    const bar = spec.mode === "diverging"
      ? Math.max(0, Math.min(100, 100 - v)) : (v / top) * 100;
    return row(id, nameOf(meta, id), value, title, c, bar, meta);
  }).join("");

  if (quad) {
    return `${head}
      ${quadrantMatrix(placed)}
      <div class="rank-head">
        <h3>Ranked by imported calories, ${s.year}</h3>
        <span class="total">kcal/person/day</span>
      </div>
      <ol class="rank">${quadrantList(s, placed)
        || `<li class="other">No country can be placed for this year.</li>`}</ol>
      ${eatenShare < 40 ? `<p class="note"><b>Only ${pct(eatenShare)} of the world's
        ${esc(s.commodityName.toLowerCase())} is eaten directly by people.</b> This view
        weighs a crop by the calories it puts on a plate, so a feed and oil crop shows
        little exposure almost everywhere &mdash; even in countries whose livestock or
        cooking oil depend on importing it. That indirect exposure is real and nothing
        here can see it.</p>` : ""}
      <p class="note">A country is placed only where FAO publishes both the trade
        balance and the affordability figures, so ${placed.length} of
        ${Object.keys(slice.c).length} appear here. ${esc(s.commodityNote)}</p>`;
  }

  return `${head}
    <div class="rank-head">
      <h3>${spec.mode === "diverging" ? "" : "Top "}${spec.rank}, ${s.year}</h3>
      <span class="total">${spec.mode === "diverging" ? "% grown at home"
        : absolute ? `world average ${denom.toFixed(0)} kg` : `${tonnes(denom)} total`}</span>
    </div>
    <ol class="rank">${items || `<li class="other">No data for this year.</li>`}</ol>
    <p class="note">${esc(s.commodityNote)}</p>`;
}


/* ---------------------------------------------------------------- exposure */

interface Placed { id: string; kcal: number; q: Quadrant }

function placeAll(s: PanelState): Placed[] {
  const out: Placed[] = [];
  for (const [id, r] of Object.entries(s.slice.c)) {
    const q = quadrantOf(r, s.security, id, s.secYearIdx);
    const kcal = importedKcal(r);
    if (q && kcal !== undefined) out.push({ id, kcal, q });
  }
  return out.sort((a, b) => b.kcal - a.kcal);
}

/**
 * How many rows each cell gets. The exposed-and-stretched cell is the one the
 * view exists to show, so it gets the room; the others are there to prove it is
 * a quadrant and not a ranking wearing four colours.
 */
const GROUP_ROWS: Record<Quadrant, number> = { risk: 12, able: 6, strain: 6, clear: 4 };

function quadrantList(s: PanelState, placed: Placed[]): string {
  const colors = quadrantColors();
  const out: string[] = [];
  for (const q of QUADRANTS) {
    const mine = placed.filter((p) => p.q === q.key);
    if (!mine.length) continue;
    const top = mine[0]!.kcal || 1;
    out.push(`<li class="head"><span class="sw" style="background:${colors[q.key]}"></span>
      <span class="lab">${esc(q.label)} &middot; ${mine.length}</span></li>`);
    for (const p of mine.slice(0, GROUP_ROWS[q.key])) {
      out.push(row(p.id, nameOf(s.meta, p.id), `${p.kcal.toFixed(0)}`,
        `${p.kcal.toFixed(0)} kcal per person per day imported`,
        colors[q.key], (p.kcal / top) * 100, s.meta));
    }
    const rest = mine.length - GROUP_ROWS[q.key];
    if (rest > 0) {
      out.push(`<li class="other"><span class="nm">and ${rest} more</span></li>`);
    }
  }
  return out.join("");
}

/**
 * The quadrant, drawn. Counts and names live in the cells rather than in a list
 * beside it, so the shape carries them and nothing is said twice.
 */
function quadrantMatrix(placed: Placed[]): string {
  const colors = quadrantColors();
  const cell = (key: Quadrant) => {
    const q = QUADRANTS.find((x) => x.key === key)!;
    const n = placed.filter((p) => p.q === key).length;
    return `<div class="qm-cell" style="--c:${colors[key]}">
      <b>${n}</b><span class="lab">${esc(q.label)}</span>
      <span class="blurb">${esc(q.blurb)}</span></div>`;
  };
  return `<div class="quad-matrix">
      <div></div>
      <div class="qm-x"><span>little imported</span><span>much</span></div>
      <div class="qm-y">can pay</div>${cell("clear")}${cell("able")}
      <div class="qm-y">cannot</div>${cell("strain")}${cell("risk")}
    </div>
    <p class="qm-note">Columns divide at ${RISK.kcal} kcal a person a day. Rows divide
      on whether a price shock could be absorbed &mdash; failed either by a food import
      bill that outruns what a country earns, or by food that already does not reach
      everyone.</p>`;
}

/* ---------------------------------------------------------------- country view */

function countryHtml(s: PanelState): string {
  const { meta, slice, selected } = s;
  const id = selected!;
  const r: CountryYear | undefined = slice.c[id];
  const nm = nameOf(meta, id);

  if (!r) {
    return `<h2>${esc(nm)}</h2>
      <p class="sub">${esc(s.commodityName)} &middot; ${s.year}</p>
      <p class="empty">FAOSTAT reports no ${esc(s.commodityName.toLowerCase())}
      data for ${esc(nm)} in ${s.year}.</p>`;
  }

  const imports = s.direction === "imports";
  const list = (imports ? r.i : r.e) ?? [];
  const total = (imports ? r.iT : r.eT) ?? 0;
  const mirrored = imports ? r.iM : r.eM;
  const fbsTotal = imports ? r.im : r.ex;

  const depend = r.ds && r.im !== undefined ? (r.im / r.ds) * 100 : NaN;
  const exportShare = r.p && r.ex !== undefined ? (r.ex / r.p) * 100 : NaN;
  const selfSuff = r.ds && r.p !== undefined ? (r.p / r.ds) * 100 : NaN;
  const worldProd = slice.world.production ? ((r.p ?? 0) / slice.world.production) * 100 : NaN;
  const worldExp = slice.world.exports ? ((r.ex ?? 0) / slice.world.exports) * 100 : NaN;

  const top = list[0]?.[1] ?? 1;
  const items = list.map(([pid, v]) => {
    const share = total ? (v / total) * 100 : 0;
    const shade = s.flowRamp[binIndex(share, PARTNER_BINS)]!;
    return row(pid, nameOf(meta, pid), pct(share), tonnes(v), shade, (v / top) * 100, meta);
  }).join("");

  const coverage = fbsTotal && total ? (total / fbsTotal) * 100 : NaN;
  // Where the FBS total exceeds what is attributable to named partners, show the
  // split explicitly. FAO publishes no bilateral detail for the products component,
  // so the remainder is genuinely unattributable rather than merely missing.
  const gap = fbsTotal && total && fbsTotal > total * 1.02
    ? { named: total, rest: fbsTotal - total, pct: (total / fbsTotal) * 100 } : null;
  const splitHtml = gap ? `
    <div class="split">
      <div class="split-bar">
        <i style="width:${gap.pct.toFixed(1)}%;background:${s.flowRamp[6]}"></i>
        <i style="width:${(100 - gap.pct).toFixed(1)}%"></i>
      </div>
      <div class="split-key">
        <span><b>${tonnes(gap.named)}</b> ${esc(s.commodityPrimary)}, sourced below</span>
        <span><b>${tonnes(gap.rest)}</b> products &amp; unallocated</span>
      </div>
    </div>` : "";
  const notes: string[] = [];
  if (mirrored) {
    notes.push(`${esc(nm)} did not report these flows for ${s.year}; the breakdown is
      mirrored from what its trading partners reported.`);
  }
  if (isFinite(coverage) && coverage < 95) {
    notes.push(`FAOSTAT publishes country-by-country detail only for
      ${esc(s.commodityPrimary)}, not for the processed-product part of the
      ${tonnes(fbsTotal!)} total, so the remainder cannot be traced to a source.
      Percentages below are shares of the ${tonnes(total)}.`);
  }
  notes.push(esc(s.commodityNote));

  return `<h2>${esc(nm)}</h2>
    <p class="sub">${esc(s.commodityName)} &middot; ${s.year}</p>
    <div class="tiles">
      <div class="tile"><div class="tile-label">Production</div>
        <div class="tile-value">${r.p !== undefined ? tonnes(r.p) : "—"}</div>
        <div class="tile-note">${isFinite(worldProd) && worldProd > 0 ? `${pct(worldProd)} of world` : "&nbsp;"}</div></div>
      <div class="tile"><div class="tile-label">Domestic supply</div>
        <div class="tile-value">${r.ds !== undefined ? tonnes(r.ds) : "—"}</div>
        <div class="tile-note">food, feed &amp; processing</div></div>
      <div class="tile"><div class="tile-label">Imports as share of supply</div>
        <div class="tile-value">${pct(depend)}</div>
        <div class="tile-note">${r.im !== undefined ? tonnes(r.im) : "—"} imported</div></div>
      <div class="tile"><div class="tile-label">Exports as share of production</div>
        <div class="tile-value">${pct(exportShare)}</div>
        <div class="tile-note">${r.ex !== undefined ? tonnes(r.ex) : "—"} exported</div></div>
      <div class="tile wide"><div class="tile-label">Self-sufficiency &middot; production over domestic supply</div>
        <div class="tile-value">${pct(selfSuff)}</div>
        <div class="tile-note">${isFinite(worldExp) && worldExp > 0
          ? `${esc(nm)} supplies ${pct(worldExp)} of world exports.` : "&nbsp;"}</div></div>
    </div>
    <p class="basis">Figures above cover ${esc(s.commodityName.toLowerCase())}
      <b>and its processed products</b>, counted in ${esc(s.commodityPrimary)} equivalent.</p>
    ${splitHtml}
    <div class="rank-head">
      <h3>${imports ? "Where it comes from" : "Where it goes"}</h3>
      <span class="total">${tonnes(total)} of ${esc(s.commodityPrimary)}</span>
    </div>
    <ol class="rank">${items || `<li class="other">No bilateral detail reported.</li>`}</ol>
    <p class="note">${notes.join(" ")}</p>`;
}

/* --------------------------------------------------------------------- shared */

function row(id: string, nm: string, value: string, title: string, color: string,
             barPct: number, meta: Meta): string {
  const off = id !== OTHER && meta.countries[id] && !meta.countries[id]!.onMap
    ? ` <span class="off">not on map</span>` : "";
  const cls = id === OTHER ? "other" : "";
  return `<li class="${cls}" data-id="${esc(id)}" title="${esc(nm)}: ${esc(title)}">
    <span class="nm">${esc(nm)}${off}</span>
    <span class="pc">${value}</span>
    <span class="bar"><i style="width:${Math.max(1.5, Math.min(100, barPct)).toFixed(2)}%;background:${color}"></i></span>
  </li>`;
}


function wire(el: HTMLElement, s: PanelState, h: PanelHandlers) {
  el.querySelectorAll<HTMLButtonElement>("#world-metric button").forEach((b) => {
    b.addEventListener("click", () => h.onWorldMetric(b.dataset.m as WorldMetric));
  });
  el.querySelectorAll<HTMLLIElement>(".rank li[data-id]").forEach((li) => {
    const id = li.dataset.id!;
    if (id === OTHER) return;
    li.addEventListener("click", () => h.onSelect(id));
    li.addEventListener("mouseenter", () => h.onHoverPartner(id));
    li.addEventListener("mouseleave", () => h.onHoverPartner(null));
  });
}
