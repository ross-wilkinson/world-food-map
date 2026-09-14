/** Types, data loading, formatting and the binned colour scales. */
import { interpolateLab } from "d3-interpolate";

export type Direction = "world" | "imports" | "exports";

/** What the world view ranks and shades by. */
export type WorldMetric =
  | "production" | "exports" | "imports" | "food" | "percap" | "reliance" | "risk";

/**
 * Where a country sits on the two axes of the exposure view. A type, not a score:
 * the four cells are different situations rather than four rungs of one ladder,
 * which is why nothing here adds up to a number out of a hundred.
 */
export type Quadrant = "risk" | "able" | "strain" | "clear";

/** Sentinel the build script uses for the folded-up long tail of small partners. */
export const OTHER = "ZZZ";

export interface CountryMeta {
  name: string;
  lon: number;
  lat: number;
  /** false when the country trades but has no polygon in the 110m basemap. */
  onMap: boolean;
}

/** Country-level indicators from FAOSTAT's Food Security release. */
export interface Security {
  generated: string;
  years: number[];
  /** how many years a value may be carried forward before the build gives up */
  maxCarry: number;
  indicators: Record<string, { name: string; unit: string; note?: string; heldOut?: boolean }>;
  /** m49 -> indicator -> one slot per year in `years`, null where unpublished */
  c: Record<string, Record<string, (number | null)[]>>;
}

export interface Meta {
  generated: string;
  years: number[];
  commodities: { id: string; name: string; primary: string; note: string }[];
  countries: Record<string, CountryMeta>;
}

/** One country in one year. Keys are terse because this ships over the wire. */
export interface CountryYear {
  p?: number;   // production (FBS)
  ds?: number;  // domestic supply (FBS)
  im?: number;  // total imports (FBS)
  ex?: number;  // total exports (FBS)
  f?: number;   // food use -- the part actually eaten by people (FBS)
  fd?: number;  // feed
  fpc?: number; // food supply, kg per person per year (FBS)
  kc?: number;  // dietary energy from this crop, kcal per person per day (FBS)
  i?: [string, number][];  // bilateral import sources
  iT?: number;             // their total
  iM?: 1;                  // sources were mirrored from partners' export reports
  e?: [string, number][];  // bilateral export destinations
  eT?: number;
  eM?: 1;
}

export interface YearSlice {
  world: { production: number; exports: number; imports: number;
           food: number; foodPerCapita: number };
  c: Record<string, CountryYear>;
}

export interface CommodityData {
  id: string;
  name: string;
  years: Record<string, YearSlice>;
}

const BASE = import.meta.env.BASE_URL;

export async function loadMeta(): Promise<Meta> {
  const r = await fetch(`${BASE}data/meta.json`);
  if (!r.ok) throw new Error(`meta.json: ${r.status}`);
  return r.json();
}

const cache = new Map<string, Promise<CommodityData>>();

export function loadCommodity(id: string): Promise<CommodityData> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`${BASE}data/flows/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`${id}.json: ${r.status}`);
      return r.json();
    });
    cache.set(id, p);
  }
  return p;
}

export async function loadSecurity(): Promise<Security> {
  const r = await fetch(`${BASE}data/security.json`);
  if (!r.ok) throw new Error(`security.json: ${r.status}`);
  return r.json();
}

export async function loadTopology(): Promise<any> {
  const r = await fetch(`${BASE}data/countries-110m.json`);
  if (!r.ok) throw new Error(`topology: ${r.status}`);
  return r.json();
}

/* ---------------------------------------------------------------- formatting */

export function tonnes(v: number): string {
  if (!v) return "0 t";
  if (v >= 1e9) return `${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)} bn t`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} Mt`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)} kt`;
  return `${Math.round(v)} t`;
}

export function pct(v: number, digits = 1): string {
  if (!isFinite(v)) return "—";
  if (v > 0 && v < 0.1) return "<0.1%";
  return `${v.toFixed(v >= 10 ? 0 : digits)}%`;
}

/* ------------------------------------------------------------------- colours */

/** Read the seven sequential ramp steps from CSS so the theme stays one source of truth. */
export function readRamp(): string[] {
  const cs = getComputedStyle(document.documentElement);
  return [1, 2, 3, 4, 5, 6, 7].map((i) => cs.getPropertyValue(`--seq-${i}`).trim());
}

export function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Share-of-world bins for the choropleth. Production and export shares are very
 * skewed -- a linear scale would leave everything but the top few indistinguishable --
 * so the breaks are widened progressively.
 */
export const WORLD_BINS = [0.1, 0.5, 1, 2.5, 5, 10];

/** Share-of-this-country's-flow bins, used to tint partners in country view. */
export const PARTNER_BINS = [1, 2.5, 5, 10, 20, 40];

export function binIndex(value: number, bins: number[]): number {
  let i = 0;
  while (i < bins.length && value >= bins[i]!) i++;
  return i;
}

export function binLabels(bins: number[], unit = "%"): string[] {
  return [`<${bins[0]}${unit}`, ...bins.map((b) => `${b}${unit}`)];
}

/**
 * Direct food use per person, kg/year. This one is shaded by its own value rather
 * than as a share of a world total: "3% of the world's eating" says nothing about
 * a diet, whereas "180 kg a year" does.
 */
export const PERCAP_BINS = [5, 20, 50, 80, 120, 170];

/**
 * Self-sufficiency, production over domestic supply. Diverging around 100%, which
 * is the meaningful midpoint: a country there grows exactly what it uses. Below it
 * leans on imports; above it has a surplus. Equal step count per arm.
 */
export const RELIANCE_BINS = [25, 60, 90, 110, 175, 300];


/* ------------------------------------------------------------------ exposure */

/**
 * The cuts that place a country in a quadrant.
 *
 * `kcal` is an editorial choice and is labelled as one in the app: a tenth of a
 * 2,000 kcal reference day, coming from abroad, in this one crop. There is no
 * published threshold for it, and pretending otherwise would be the invented
 * precision this project spends the rest of its footnotes avoiding.
 *
 * The capacity cuts are not arbitrary in the same way -- they were chosen against
 * held-out undernourishment, which is never an input to the placement itself.
 */
export const RISK = {
  kcal: 200,      // imported kcal/person/day from this crop
  bill: 25,       // food import bill, % of merchandise exports
  gdp: 12000,     // GDP per capita, PPP constant 2021 int$
  access: 0.30,   // CV of habitual caloric consumption
};

/** Read one indicator for one country in one year. */
export function secVal(
  sec: Security, id: string, key: string, yearIdx: number,
): number | undefined {
  const v = sec.c[id]?.[key]?.[yearIdx];
  return v === null || v === undefined ? undefined : v;
}

/**
 * Calories per person per day of this crop that come from abroad.
 *
 * The share-not-grown-at-home on its own cannot carry the x axis: 46 countries
 * import every tonne of their wheat and so all sit at exactly 100%, which puts
 * Iceland and Haiti in the same place. Weighting by dietary energy separates
 * them, because the same 100% is 61 kcal of Sierra Leone's day and 865 of
 * Djibouti's.
 */
export function importedKcal(r: CountryYear): number | undefined {
  if (r.kc === undefined || !r.ds) return undefined;
  return r.kc * (1 - Math.min(1, (r.p ?? 0) / r.ds));
}

/**
 * Whether a country could absorb a price shock -- undefined where we cannot say.
 *
 * Two separate ways to fail, and either is enough, so this is a disjunction
 * rather than a blend. A country may be unable to pay the bill, or able to pay it
 * while the food still fails to reach people: Gabon runs a 7% food import bill on
 * $18,700 a head and has 20% undernourishment. National earnings cannot see
 * inside a country, so the access gap is the only term here that does.
 *
 * GDP guards the bill rather than standing alongside it, because the bill's
 * denominator is merchandise exports only -- Macao's food bill is 127% of its
 * merchandise exports on the highest GDP per head in the data.
 */
export function canAbsorb(
  sec: Security, id: string, yearIdx: number,
): boolean | undefined {
  const bill = secVal(sec, id, "bill", yearIdx);
  const gdp = secVal(sec, id, "gdp", yearIdx);
  const access = secVal(sec, id, "accessgap", yearIdx);
  if (bill === undefined && access === undefined) return undefined;
  const cannotAfford = bill !== undefined && bill >= RISK.bill
    && (gdp === undefined || gdp <= RISK.gdp);
  const cannotReach = access !== undefined && access >= RISK.access;
  return !(cannotAfford || cannotReach);
}

export function quadrantOf(
  r: CountryYear, sec: Security, id: string, yearIdx: number,
): Quadrant | undefined {
  const imported = importedKcal(r);
  const absorb = canAbsorb(sec, id, yearIdx);
  if (imported === undefined || absorb === undefined) return undefined;
  const exposed = imported >= RISK.kcal;
  return exposed ? (absorb ? "able" : "risk") : (absorb ? "clear" : "strain");
}

/**
 * Order matters: this is the order the legend grid and the panel groups use, and
 * it reads as a sentence -- the crop is a risk here, it is a risk they can cover,
 * the strain is domestic, there is no real exposure.
 *
 * Labels are kept short enough to sit on one line inside a legend cell. They are
 * the same string in the legend and the panel on purpose: two wordings for one
 * category is how a reader ends up thinking there are more than four.
 */
export const QUADRANTS: { key: Quadrant; label: string; blurb: string; token: string }[] = [
  { key: "risk", token: "--q-risk", label: "Most exposed",
    blurb: "Much of this crop's calories are imported, and a price shock would be hard to absorb." },
  { key: "able", token: "--q-able", label: "Exposed, can pay",
    blurb: "Just as import-reliant, but able to pay through a shortage." },
  { key: "strain", token: "--q-strain", label: "Strained at home",
    blurb: "Grows most of what it uses, but food does not reach everyone. Trade is not the weak point." },
  { key: "clear", token: "--q-clear", label: "Little exposure",
    blurb: "Little of this crop's calories cross a border. Another crop may tell a different story." },
];

export function quadrantColors(): Record<Quadrant, string> {
  return Object.fromEntries(
    QUADRANTS.map((q) => [q.key, readVar(q.token)]),
  ) as Record<Quadrant, string>;
}

export const METRICS: Record<WorldMetric, {
  noun: string; rank: string; mode: "share" | "absolute" | "diverging" | "quadrant";
  value(r: CountryYear): number | undefined;
  /** rank ascending -- for reliance the interesting end is the bottom */
  sort?: "asc";
  /** ignore countries whose supply is too small for the ratio to mean anything */
  minSupply?: number;
}> = {
  production: { noun: "production", rank: "producers", mode: "share", value: (r) => r.p },
  exports:    { noun: "exports",    rank: "exporters", mode: "share", value: (r) => r.ex },
  imports:    { noun: "imports",    rank: "importers", mode: "share", value: (r) => r.im },
  food:       { noun: "food use",   rank: "consumers", mode: "share", value: (r) => r.f },
  percap:     { noun: "eaten per person", rank: "eaters", mode: "absolute", value: (r) => r.fpc },
  reliance:   {
    noun: "self-sufficiency", rank: "most import-reliant", mode: "diverging",
    // absent production means none was grown, which is maximum reliance -- not
    // missing data. Treating it as undefined would drop exactly the countries the
    // map exists to show.
    value: (r) => (r.ds ? ((r.p ?? 0) / r.ds) * 100 : undefined),
    sort: "asc", minSupply: 50000,
  },
  // Ranked by the x axis alone; the quadrant is the y axis and is carried as a
  // colour rather than a position in the list.
  // No tonnage floor here, unlike reliance. That floor guards a ratio against a
  // tiny denominator; both axes of this view are already per person, and the
  // share-not-grown-at-home is clamped to 1. Applying it anyway dropped 44
  // countries from the rice map -- Kiribati on 642 imported kcal a day, Tuvalu on
  // 560 -- which are small island states, not noise, and are the clearest cases
  // of a food system living on imported staples that this view has.
  risk: {
    noun: "imported calories", rank: "most exposed", mode: "quadrant",
    value: importedKcal,
  },
};

/**
 * Diverging ramp built out from the neutral midpoint to each pole, so the middle
 * reads as "nothing notable" rather than as a hue of its own.
 */
export function divergingRamp(): string[] {
  const mid = readVar("--div-mid") || "#f0efec";
  const low = interpolateLab(mid, readVar("--div-low") || "#e34948");
  const high = interpolateLab(mid, readVar("--div-high") || "#2a78d6");
  return [low(1), low(0.66), low(0.33), mid, high(0.33), high(0.66), high(1)];
}

export function worldTotalFor(w: YearSlice["world"], m: WorldMetric): number {
  return m === "production" ? w.production : m === "exports" ? w.exports
    : m === "imports" ? w.imports : m === "food" ? w.food : w.foodPerCapita;
}

/** Bins and legend units for whichever scale a metric uses. */
export function scaleFor(m: WorldMetric): { bins: number[]; unit: string } {
  const mode = METRICS[m].mode;
  return mode === "absolute" ? { bins: PERCAP_BINS, unit: " kg" }
    : mode === "diverging" ? { bins: RELIANCE_BINS, unit: "%" }
    : { bins: WORLD_BINS, unit: "%" };
}

/**
 * One-hue sequential ramp in the direction colour, for shading partner countries.
 *
 * Interpolated in Lab against a neutral floor rather than in sRGB against the
 * blue-grey land colour: mixing orange with blue-grey turns it brown, which reads
 * as a different hue rather than as less of the same one. Resolved to concrete
 * rgb() strings here because canvas `fillStyle` cannot resolve `var()` or CSS
 * custom properties -- handing it a color-mix() referencing a token silently
 * fails and the shape keeps whatever fill came before it.
 */
const RAMP_STOPS = [0.36, 0.47, 0.58, 0.69, 0.8, 0.9, 1];

export function dirRamp(color: string): string[] {
  const it = interpolateLab(readVar("--ramp-floor") || "#eceae6", color);
  return RAMP_STOPS.map((t) => it(t));
}

/** Blend two resolved colours to a concrete rgb() string, safe for canvas. */
export function mix(a: string, b: string, t: number): string {
  return interpolateLab(a, b)(t);
}
