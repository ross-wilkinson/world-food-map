/** Types, data loading, formatting and the binned colour scales. */
import { interpolateLab } from "d3-interpolate";

export type Direction = "world" | "imports" | "exports";

/** Sentinel the build script uses for the folded-up long tail of small partners. */
export const OTHER = "ZZZ";

export interface CountryMeta {
  name: string;
  lon: number;
  lat: number;
  /** false when the country trades but has no polygon in the 110m basemap. */
  onMap: boolean;
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
  i?: [string, number][];  // bilateral import sources
  iT?: number;             // their total
  iM?: 1;                  // sources were mirrored from partners' export reports
  e?: [string, number][];  // bilateral export destinations
  eT?: number;
  eM?: 1;
}

export interface YearSlice {
  world: { production: number; exports: number; imports: number };
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

export function binLabels(bins: number[]): string[] {
  return [`<${bins[0]}%`, ...bins.map((b) => `${b}%`)];
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
