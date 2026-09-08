/** Side panel: stat tiles plus the ranked partner list that carries the percentages. */
import {
  OTHER, PARTNER_BINS, WORLD_BINS, binIndex, pct, tonnes,
} from "./model";
import type { CountryYear, Direction, Meta, YearSlice } from "./model";

export type WorldMetric = "production" | "exports";

export interface PanelState {
  meta: Meta;
  slice: YearSlice;
  commodityName: string;
  commodityNote: string;
  year: number;
  direction: Direction;
  selected: string | null;
  worldMetric: WorldMetric;
  ramp: string[];
  flowRamp: string[];
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
    ? (s.direction === "exports" ? "exports" : "production")
    : s.worldMetric;

  // Ranking the world by import volume only makes sense in the "pick a country"
  // state; the world choropleth itself is always production or exports.
  const rankBy: "production" | "exports" | "imports" =
    needsPick && s.direction === "imports" ? "imports" : metric;

  const denom =
    rankBy === "production" ? slice.world.production
      : rankBy === "exports" ? slice.world.exports : slice.world.imports;

  const key = rankBy === "production" ? "p" : rankBy === "exports" ? "ex" : "im";
  const rows = Object.entries(slice.c)
    .map(([id, r]) => [id, (r as any)[key] as number | undefined] as const)
    .filter((kv): kv is readonly [string, number] => !!kv[1] && kv[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);

  const traded = slice.world.production
    ? (slice.world.exports / slice.world.production) * 100 : NaN;

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
         <div class="tile"><div class="tile-label">World exports</div>
           <div class="tile-value">${tonnes(slice.world.exports)}</div></div>
         <div class="tile wide"><div class="tile-label">Share of production that crosses a border</div>
           <div class="tile-value">${pct(traded)}</div>
           <div class="tile-note">The rest is eaten, fed or processed at home.</div></div>
       </div>
       <div class="ctl" style="margin-top:14px">
         <span class="ctl-label">Rank &amp; shade by</span>
         <div class="segmented" id="world-metric" role="radiogroup" aria-label="World metric">
           <button type="button" role="radio" data-m="production" aria-checked="${metric === "production"}"
             class="${metric === "production" ? "on" : ""}">Production</button>
           <button type="button" role="radio" data-m="exports" aria-checked="${metric === "exports"}"
             class="${metric === "exports" ? "on" : ""}">Exports</button>
         </div>
       </div>`;

  const label = rankBy === "production" ? "producers" : rankBy === "exports" ? "exporters" : "importers";
  // Bars are scaled to the leader, the way a bar chart's axis is; the label
  // carries the true share, which is rarely anywhere near 100%.
  const top = rows[0]?.[1] ?? 1;
  const items = rows.map(([id, v]) => {
    const share = denom ? (v / denom) * 100 : 0;
    const c = s.ramp[binIndex(share, WORLD_BINS)]!;
    return row(id, nameOf(meta, id), share, v, c, (v / top) * 100, meta);
  }).join("");

  return `${head}
    <div class="rank-head">
      <h3>Top ${label}, ${s.year}</h3>
      <span class="total">${tonnes(denom)} total</span>
    </div>
    <ol class="rank">${items || `<li class="other">No data for this year.</li>`}</ol>
    <p class="note">${esc(s.commodityNote)}</p>`;
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
    return row(pid, nameOf(meta, pid), share, v, shade, (v / top) * 100, meta);
  }).join("");

  const coverage = fbsTotal && total ? (total / fbsTotal) * 100 : NaN;
  const notes: string[] = [];
  if (mirrored) {
    notes.push(`${esc(nm)} did not report these flows for ${s.year}; the breakdown is
      mirrored from what its trading partners reported.`);
  }
  if (isFinite(coverage) && coverage < 95) {
    notes.push(`Named partners account for ${pct(coverage, 0)} of
      ${esc(nm)}'s reported ${imports ? "imports" : "exports"}; the remainder is
      trade its partners did not break down by counterpart.`);
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
    <div class="rank-head">
      <h3>${imports ? "Where it comes from" : "Where it goes"}</h3>
      <span class="total">${tonnes(total)}</span>
    </div>
    <ol class="rank">${items || `<li class="other">No bilateral detail reported.</li>`}</ol>
    <p class="note">${notes.join(" ")}</p>`;
}

/* --------------------------------------------------------------------- shared */

function row(id: string, nm: string, share: number, v: number, color: string,
             barPct: number, meta: Meta): string {
  const off = id !== OTHER && meta.countries[id] && !meta.countries[id]!.onMap
    ? ` <span class="off">not on map</span>` : "";
  const cls = id === OTHER ? "other" : "";
  return `<li class="${cls}" data-id="${esc(id)}" title="${esc(nm)}: ${tonnes(v)}">
    <span class="nm">${esc(nm)}${off}</span>
    <span class="pc">${pct(share)}</span>
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
