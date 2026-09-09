/** Wiring: state, controls, and the bridge between the data, the globe and the panel. */
import { Globe } from "./globe";
import type { Arc } from "./globe";
import { renderPanel } from "./panel";
import type { WorldMetric } from "./panel";
import {
  OTHER, PARTNER_BINS, WORLD_BINS, binIndex, binLabels, dirRamp,
  loadCommodity, loadMeta, loadTopology, mix, pct, readRamp, readVar, tonnes,
} from "./model";
import type { CommodityData, Direction, Meta, YearSlice } from "./model";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Beyond this the globe turns into spaghetti; the ranked list still shows every partner. */
const MAX_ARCS = 20;

const el = {
  stage: $<HTMLDivElement>("stage"),
  canvas: $<HTMLCanvasElement>("globe"),
  panel: $<HTMLDivElement>("panel-body"),
  commodity: $<HTMLSelectElement>("commodity"),
  direction: $<HTMLDivElement>("direction"),
  year: $<HTMLInputElement>("year"),
  yearOut: $<HTMLOutputElement>("year-out"),
  play: $<HTMLButtonElement>("play"),
  search: $<HTMLInputElement>("country-search"),
  list: $<HTMLDataListElement>("country-list"),
  projection: $<HTMLButtonElement>("projection"),
  legend: $<HTMLDivElement>("legend"),
  tooltip: $<HTMLDivElement>("tooltip"),
  loading: $<HTMLDivElement>("loading"),
  hint: $<HTMLDivElement>("hint"),
  theme: $<HTMLButtonElement>("theme-toggle"),
  method: $<HTMLDialogElement>("method"),
  methodBody: $<HTMLDivElement>("method-body"),
  openMethod: $<HTMLButtonElement>("open-method"),
};

const state = {
  meta: null as unknown as Meta,
  data: null as unknown as CommodityData,
  commodity: "wheat",
  yearIdx: 0,
  direction: "world" as Direction,
  selected: null as string | null,
  worldMetric: "production" as WorldMetric,
  flat: false,
  playing: false,
  hoverPartner: null as string | null,
};

let globe: Globe;
let playTimer = 0;

/* ------------------------------------------------------------------ bootstrap */

async function init() {
  const [meta, topo] = await Promise.all([loadMeta(), loadTopology()]);
  state.meta = meta;
  state.yearIdx = meta.years.length - 1;

  el.commodity.innerHTML = meta.commodities
    .map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  el.commodity.value = state.commodity;

  el.year.min = "0";
  el.year.max = String(meta.years.length - 1);
  el.year.value = String(state.yearIdx);

  el.list.innerHTML = Object.entries(meta.countries)
    .filter(([, c]) => c.onMap)
    .map(([, c]) => `<option value="${c.name}"></option>`).join("");

  globe = new Globe(el.canvas, topo, {
    onSelect: (id) => selectCountry(id),
    onHover: (id, x, y) => showTooltip(id, x, y),
  });
  applyTheme();
  globe.start();

  state.data = await loadCommodity(state.commodity);
  el.loading.classList.add("gone");
  update();

  new ResizeObserver(() => globe.resize()).observe(el.stage);
  wireControls();
  fillMethod();
}

/* -------------------------------------------------------------------- helpers */

const year = () => state.meta.years[state.yearIdx]!;
const slice = (): YearSlice | undefined => state.data.years[String(year())];

function commoditySpec() {
  return state.meta.commodities.find((c) => c.id === state.commodity)!;
}

function dirColor(): string {
  return readVar(state.direction === "exports" ? "--exports" : "--imports");
}

/**
 * What the choropleth shades by. With no country picked yet, an Imports/Exports tab
 * shades the same measure the panel is ranking, so the map and the list agree.
 */
function worldMetric(): WorldMetric {
  if (state.direction === "world" || state.selected) return state.worldMetric;
  return state.direction === "imports" ? "imports" : "exports";
}

function worldTotal(s: YearSlice, m: WorldMetric): number {
  return m === "production" ? s.world.production : m === "exports" ? s.world.exports : s.world.imports;
}

const METRIC_KEY = { production: "p", exports: "ex", imports: "im" } as const;

/* ---------------------------------------------------------------------- update */

function update() {
  const s = slice();
  if (!s) return;
  const ramp = readRamp();
  const color = dirColor();
  const flowRamp = dirRamp(color);

  el.yearOut.textContent = String(year());
  el.year.value = String(state.yearIdx);

  const showFlows = state.direction !== "world" && !!state.selected;
  globe.setFill(buildFill(s, ramp, flowRamp, showFlows));
  globe.setArcs(showFlows ? buildArcs(s) : [], color);
  globe.setSelected(state.selected);
  renderLegend(s, ramp, flowRamp, showFlows);

  renderPanel(el.panel, {
    meta: state.meta, slice: s, commodityName: commoditySpec().name,
    commodityPrimary: commoditySpec().primary,
    commodityNote: commoditySpec().note, year: year(), direction: state.direction,
    selected: state.selected, worldMetric: state.worldMetric, ramp, flowRamp,
  }, {
    onSelect: (id) => selectCountry(id, true),
    onHoverPartner: (id) => { state.hoverPartner = id; globe.setHighlight(id); },
    onWorldMetric: (m) => { state.worldMetric = m; update(); },
  });
}

function buildFill(s: YearSlice, ramp: string[], flowRamp: string[], showFlows: boolean) {
  const shades = new Map<string, string>();

  if (showFlows) {
    const r = s.c[state.selected!];
    const list = (state.direction === "imports" ? r?.i : r?.e) ?? [];
    const total = (state.direction === "imports" ? r?.iT : r?.eT) ?? 0;
    for (const [id, v] of list) {
      if (id === OTHER || !total) continue;
      shades.set(id, flowRamp[binIndex((v / total) * 100, PARTNER_BINS)]!);
    }
    // neutral lift so the hub itself never reads as one of its own partners
    shades.set(state.selected!, mix(readVar("--land"), readVar("--ink"), 0.22));
  } else {
    const m = worldMetric();
    const key = METRIC_KEY[m];
    const denom = worldTotal(s, m);
    if (denom) {
      for (const [id, r] of Object.entries(s.c)) {
        const v = (r as any)[key] as number | undefined;
        if (!v || v <= 0) continue;
        shades.set(id, ramp[binIndex((v / denom) * 100, WORLD_BINS)]!);
      }
    }
  }
  return (id: string) => shades.get(id) ?? null;
}

function buildArcs(s: YearSlice): Arc[] {
  const r = s.c[state.selected!];
  if (!r) return [];
  const imports = state.direction === "imports";
  const list = (imports ? r.i : r.e) ?? [];
  const total = (imports ? r.iT : r.eT) ?? 0;
  const self = state.meta.countries[state.selected!];
  if (!self || !total) return [];
  const here: [number, number] = [self.lon, self.lat];

  const arcs: Arc[] = [];
  for (const [id, v] of list) {
    if (id === OTHER || arcs.length >= MAX_ARCS) continue;
    const c = state.meta.countries[id];
    if (!c) continue;
    const there: [number, number] = [c.lon, c.lat];
    arcs.push({
      id,
      from: imports ? there : here,
      to: imports ? here : there,
      partner: there,
      share: v / total,
      label: `${c.name} ${pct((v / total) * 100)}`,
    });
  }
  return arcs;
}

function renderLegend(s: YearSlice, ramp: string[], flowRamp: string[], showFlows: boolean) {
  let title: string, colors: string[], labels: string[];
  if (showFlows) {
    const nm = state.meta.countries[state.selected!]?.name ?? "";
    title = `Share of ${nm}'s ${state.direction}`;
    colors = flowRamp;
    labels = binLabels(PARTNER_BINS);
  } else {
    title = `Share of world ${worldMetric()}, ${year()}`;
    colors = ramp;
    labels = binLabels(WORLD_BINS);
  }
  const arcNote = showFlows && ((s.c[state.selected!]?.[state.direction === "imports" ? "i" : "e"]?.length ?? 0) > MAX_ARCS)
    ? `<div style="margin-top:5px">Top ${MAX_ARCS} flows drawn; the panel lists them all.</div>` : "";

  el.legend.innerHTML = `<div class="legend-title">${title}</div>
    <div class="legend-scale">${colors.map((c) => `<i style="background:${c}"></i>`).join("")}</div>
    <div class="legend-ticks"><span>${labels[0]}</span><span>${labels[labels.length - 1]}+</span></div>
    ${arcNote}`;
  el.legend.setAttribute("aria-hidden", "false");
}

/* ------------------------------------------------------------------ interaction */

function selectCountry(id: string | null, fromList = false) {
  if (id && !state.meta.countries[id]) return;      // unmapped territory, ignore
  state.selected = id === state.selected && !fromList ? null : id;
  el.hint.classList.add("gone");

  if (state.selected) {
    if (state.direction === "world") setDirection("imports", false);
    const c = state.meta.countries[state.selected]!;
    globe.focus(c.lon, c.lat);
    el.search.value = c.name;
  } else {
    el.search.value = "";
  }
  update();
}

function setDirection(d: Direction, refresh = true) {
  state.direction = d;
  el.direction.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    const on = b.dataset.dir === d;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  });
  if (refresh) update();
}

function showTooltip(id: string | null, x: number, y: number) {
  globe.setHighlight(id ?? state.hoverPartner);
  const s = slice();
  const c = id ? state.meta.countries[id] : null;
  if (!id || !c || !s) { el.tooltip.classList.remove("on"); return; }

  const r = s.c[id];
  let detail = "no data";
  if (r) {
    if (state.direction !== "world" && state.selected && state.selected !== id) {
      const sel = s.c[state.selected];
      const list = (state.direction === "imports" ? sel?.i : sel?.e) ?? [];
      const total = (state.direction === "imports" ? sel?.iT : sel?.eT) ?? 0;
      const hit = list.find(([pid]) => pid === id);
      detail = hit && total
        ? `${pct((hit[1] / total) * 100)} of ${state.meta.countries[state.selected]!.name}'s ${state.direction} &middot; ${tonnes(hit[1])}`
        : `not among ${state.meta.countries[state.selected]!.name}'s reported ${state.direction}`;
    } else {
      const m = worldMetric();
      const denom = worldTotal(s, m);
      const v = (r as any)[METRIC_KEY[m]] as number | undefined;
      detail = v
        ? `${tonnes(v)} &middot; ${pct(denom ? (v / denom) * 100 : NaN)} of world ${m}`
        : `no ${m} reported`;
    }
  }
  const rect = el.stage.getBoundingClientRect();
  el.tooltip.innerHTML = `<b>${c.name}</b><br><span>${detail}</span>`;
  el.tooltip.style.left = `${x - rect.left}px`;
  el.tooltip.style.top = `${y - rect.top - 12}px`;
  el.tooltip.classList.add("on");
}

function togglePlay(force?: boolean) {
  state.playing = force ?? !state.playing;
  el.play.classList.toggle("playing", state.playing);
  el.play.setAttribute("aria-label", state.playing ? "Pause" : "Play through years");
  clearInterval(playTimer);
  if (state.playing) {
    playTimer = window.setInterval(() => {
      state.yearIdx = (state.yearIdx + 1) % state.meta.years.length;
      update();
    }, 1100);
  }
}

function wireControls() {
  el.commodity.addEventListener("change", async () => {
    state.commodity = el.commodity.value;
    el.loading.classList.remove("gone");
    state.data = await loadCommodity(state.commodity);
    el.loading.classList.add("gone");
    update();
  });

  el.direction.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    setDirection(b.dataset.dir as Direction);
  });

  el.year.addEventListener("input", () => {
    state.yearIdx = +el.year.value;
    togglePlay(false);
    update();
  });

  el.play.addEventListener("click", () => togglePlay());

  el.projection.addEventListener("click", () => {
    state.flat = !state.flat;
    el.projection.setAttribute("aria-pressed", String(state.flat));
    el.projection.textContent = state.flat ? "Globe" : "Flat map";
    globe.setFlat(state.flat);
    globe.setSelected(state.selected);
    if (state.selected) {
      const c = state.meta.countries[state.selected]!;
      globe.focus(c.lon, c.lat);
    }
  });

  el.search.addEventListener("change", () => {
    const q = el.search.value.trim().toLowerCase();
    if (!q) { selectCountry(null); return; }
    const hit = Object.entries(state.meta.countries)
      .find(([, c]) => c.name.toLowerCase() === q)
      ?? Object.entries(state.meta.countries)
        .find(([, c]) => c.name.toLowerCase().startsWith(q));
    if (hit) selectCountry(hit[0], true);
  });

  el.theme.addEventListener("click", () => {
    const now = document.documentElement.getAttribute("data-theme");
    const next = now === "dark" ? "light" : now === "light" ? "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("wfm-theme", next); } catch { /* private mode */ }
    applyTheme();
    update();
  });

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.getAttribute("data-theme")) { applyTheme(); update(); }
  });

  el.openMethod.addEventListener("click", () => el.method.showModal());

  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      togglePlay(false);
      const d = e.key === "ArrowRight" ? 1 : -1;
      state.yearIdx = Math.min(state.meta.years.length - 1, Math.max(0, state.yearIdx + d));
      update();
    } else if (e.key === " ") {
      e.preventDefault(); togglePlay();
    } else if (e.key === "Escape") {
      selectCountry(null);
    }
  });
}

function applyTheme() {
  globe.setTheme({
    ocean: readVar("--ocean"), land: readVar("--land"), edge: readVar("--land-edge"),
    grat: readVar("--graticule"), ink: readVar("--ink"), surface: readVar("--surface"),
  });
}

function fillMethod() {
  const y = state.meta.years;
  el.methodBody.innerHTML = `
    <p>Every figure here comes from FAOSTAT, covering ${y[0]}&ndash;${y[y.length - 1]}.
    Two different datasets are on screen, and they answer different questions.</p>
    <h3>The arcs and the ranked list</h3>
    <p>These come from the <b>Detailed Trade Matrix</b>, which records trade country by
    country. A country's own customs report is used for its own flows; where a country
    reported nothing, the breakdown is mirrored from what its partners reported, and the
    panel says so.</p>
    <h3>The tiles</h3>
    <p>Production, domestic supply and the ratios come from the <b>Food Balance Sheets</b>.
    Those cover the crop <i>and its products</i> in primary equivalent, while the trade
    matrix rows are the raw commodity, so the two totals will not match to the tonne.
    They are kept in separate parts of the panel rather than blended.</p>
    <h3>Things to keep in mind</h3>
    <ul>
      <li><b>Importer and exporter reports disagree.</b> The same shipment is often
      logged at different tonnages by the two countries involved. Switching between the
      Imports and Exports views can therefore give slightly different numbers.</li>
      <li><b>Re-exports look like origins.</b> Grain bought through the Netherlands or
      Singapore is attributed to the last country that shipped it, not the field it grew in.</li>
      <li><b>Trade is not consumption.</b> Much of the maize and soy crossing borders is
      animal feed or crushed for oil rather than eaten directly.</li>
      <li><b>The lines are links, not routes.</b> Each arc is the great circle between
      two countries, drawn to show what is connected to what and how much moves. Real
      cargo follows sea lanes and canals, so a line sweeping over the Arctic means
      "these two trade", not "the grain went that way".</li>
      <li><b>Some traders have no polygon</b> on a 110m basemap. Singapore, Hong Kong,
      Malta and small island states are drawn as arc endpoints and flagged in the list.</li>
    </ul>`;
}

const saved = (() => { try { return localStorage.getItem("wfm-theme"); } catch { return null; } })();
if (saved) document.documentElement.setAttribute("data-theme", saved);

init().catch((err) => {
  console.error(err);
  el.loading.innerHTML = `Could not load the data. ${err instanceof Error ? err.message : ""}`;
});
