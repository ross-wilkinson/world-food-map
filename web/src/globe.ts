/**
 * Canvas renderer for the map: an orthographic globe (true relative areas, no
 * Mercator distortion) with an equal-area flat projection as an alternative for
 * seeing every flow at once, since a globe can only ever show you one hemisphere.
 *
 * Flows are drawn as true great circles on the sphere rather than lifted screen-space
 * beziers, so a line's path is the real shortest route and the horizon clips it honestly.
 */
import {
  geoOrthographic, geoEqualEarth, geoPath, geoGraticule10, geoInterpolate,
  geoContains, geoBounds, geoDistance,
} from "d3-geo";
import type { GeoProjection, GeoPath } from "d3-geo";
import { select } from "d3-selection";
import { drag } from "d3-drag";
import { feature, mesh } from "topojson-client";
import versor from "versor";

export interface Arc {
  /** partner id, for hover correlation with the ranked list */
  id: string;
  from: [number, number];
  to: [number, number];
  /** the partner end of the flow -- what gets the dot and the label */
  partner: [number, number];
  /** 0..1 share of the selected country's flow, drives stroke weight */
  share: number;
  label: string;
}

interface PreparedArc extends Arc {
  pts: [number, number][];
  phase: number;
  speed: number;
}

export interface GlobeCallbacks {
  onSelect(id: string | null): void;
  onHover(id: string | null, clientX: number, clientY: number): void;
}

const ARC_SAMPLES = 56;
const TRAIL = 14;            // comet length, in samples
const AUTO_SPIN = 3.2;       // degrees/second while idle in world view

interface Feat {
  id: string;
  geom: any;
  bounds: [[number, number], [number, number]];
}

export class Globe {
  private ctx: CanvasRenderingContext2D;
  private projection: GeoProjection = geoOrthographic();
  private path!: GeoPath;
  private width = 0;
  private height = 0;
  private dpr = 1;

  private feats: Feat[] = [];
  private borders: any;
  private sphere = { type: "Sphere" } as any;
  private graticule = geoGraticule10();

  private flat = false;
  private zoom = 1;
  private rotation: [number, number, number] = [-15, -12, 0];

  private fillFor: (id: string) => string | null = () => null;
  private arcs: PreparedArc[] = [];
  private arcColor = "#3987e5";
  private selected: string | null = null;
  private highlight: string | null = null;

  private spin = true;
  private dirty = true;
  private raf = 0;
  private last = 0;
  private clock = 0;
  private tween: { from: [number, number, number]; to: [number, number, number]; t: number } | null = null;
  private theme = { ocean: "#12161d", land: "#2a2e35", edge: "#12161d", grat: "#fff2", ink: "#fff", surface: "#1a1a19" };

  constructor(private canvas: HTMLCanvasElement, topology: any, private cb: GlobeCallbacks) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas unavailable");
    this.ctx = ctx;

    const fc = feature(topology, topology.objects.countries) as any;
    for (const f of fc.features) {
      // Antarctica grows a huge empty shape in both projections and never trades
      // any of these crops, so it only adds noise.
      if (!f.geometry || String(f.id) === "010") continue;
      this.feats.push({ id: String(f.id), geom: f, bounds: geoBounds(f) });
    }
    this.borders = mesh(topology, topology.objects.countries, (a: any, b: any) => a !== b);

    this.attach();
    this.resize();
  }

  /* ------------------------------------------------------------- public API */

  setTheme(t: typeof this.theme) { this.theme = t; this.dirty = true; }

  setFlat(flat: boolean) {
    this.flat = flat;
    this.zoom = 1;
    this.resize();
  }

  setFill(fn: (id: string) => string | null) { this.fillFor = fn; this.dirty = true; }

  setArcs(arcs: Arc[], color: string) {
    this.arcColor = color;
    this.arcs = arcs.map((a, i) => ({
      ...a,
      pts: sampleGreatCircle(a.from, a.to),
      // stagger the comets so they read as a flow rather than a synchronised pulse
      phase: (i * 0.37) % 1,
      speed: 0.22 + ((i * 7) % 5) * 0.02,
    }));
    this.dirty = true;
  }

  setSelected(id: string | null) {
    this.selected = id;
    this.spin = id === null && !this.flat;
    this.dirty = true;
  }

  setHighlight(id: string | null) { this.highlight = id; this.dirty = true; }

  /** Rotate the globe so a point faces the viewer. */
  focus(lon: number, lat: number) {
    if (this.flat) {
      // Centring the flat map on the selected country keeps its flows from
      // wrapping off the edges and reappearing on the far side.
      this.rotation = [-lon, 0, 0];
      this.applyProjection();
      this.dirty = true;
      return;
    }
    const to: [number, number, number] = [-lon, -lat, 0];
    const from = this.rotation;
    // take the short way round
    let d = to[0] - from[0];
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    this.tween = { from: [...from] as any, to: [from[0] + d, to[1], 0], t: 0 };
    this.spin = false;
    this.dirty = true;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.applyProjection();
    this.dirty = true;
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  /* -------------------------------------------------------------- internals */

  private applyProjection() {
    const pad = 10;
    if (this.flat) {
      this.projection = geoEqualEarth().precision(0.4).rotate([this.rotation[0], 0, 0]);
      this.projection.fitExtent(
        [[pad, pad], [this.width - pad, this.height - pad]], this.sphere);
      this.projection.scale(this.projection.scale() * this.zoom);
      this.projection.translate([this.width / 2, this.height / 2]);
    } else {
      const r = Math.min(this.width, this.height) / 2 - pad;
      this.projection = geoOrthographic().precision(0.4)
        .clipAngle(90)
        .rotate(this.rotation)
        .scale(r * this.zoom)
        .translate([this.width / 2, this.height / 2]);
    }
    this.path = geoPath(this.projection, this.ctx as any);
  }

  private tick(dt: number) {
    this.clock += dt;

    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + dt / 0.65);
      const e = easeInOut(this.tween.t);
      this.rotation = [
        lerp(this.tween.from[0], this.tween.to[0], e),
        lerp(this.tween.from[1], this.tween.to[1], e),
        0,
      ];
      if (this.tween.t >= 1) this.tween = null;
      this.applyProjection();
      this.dirty = true;
    } else if (this.spin && !this.flat) {
      this.rotation = [this.rotation[0] + AUTO_SPIN * dt, this.rotation[1], 0];
      this.applyProjection();
      this.dirty = true;
    }

    if (this.arcs.length) this.dirty = true;   // comets are always in motion
    if (!this.dirty) return;
    this.dirty = false;
    this.render();
  }

  private render() {
    const { ctx, path, theme } = this;
    ctx.clearRect(0, 0, this.width, this.height);

    // ocean disc
    ctx.beginPath(); path(this.sphere);
    ctx.fillStyle = theme.ocean; ctx.fill();

    ctx.beginPath(); path(this.graticule);
    ctx.strokeStyle = theme.grat; ctx.lineWidth = 0.6; ctx.stroke();

    for (const f of this.feats) {
      ctx.beginPath(); path(f.geom);
      ctx.fillStyle = this.fillFor(f.id) ?? theme.land;
      ctx.fill();
    }

    // borders drawn in the surface colour act as the 2px gap between fills
    ctx.beginPath(); path(this.borders);
    ctx.strokeStyle = theme.edge; ctx.lineWidth = 0.7; ctx.stroke();

    for (const id of [this.highlight, this.selected]) {
      if (!id) continue;
      const f = this.feats.find((x) => x.id === id);
      if (!f) continue;
      ctx.beginPath(); path(f.geom);
      ctx.strokeStyle = id === this.selected ? theme.ink : theme.surface;
      ctx.lineWidth = id === this.selected ? 1.8 : 1.4;
      ctx.stroke();
    }

    ctx.beginPath(); path(this.sphere);
    ctx.strokeStyle = theme.edge; ctx.lineWidth = 1; ctx.stroke();

    this.drawArcs();
  }

  private drawArcs() {
    if (!this.arcs.length) return;
    const { ctx, theme } = this;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const a of this.arcs) {
      const w = 1.1 + Math.sqrt(a.share) * 6.5;
      const dim = this.highlight != null && this.highlight !== a.id;
      const geom = { type: "LineString", coordinates: a.pts } as any;

      // surface-coloured casing keeps the line legible where it crosses land fills
      ctx.beginPath(); this.path(geom);
      ctx.strokeStyle = theme.ocean;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = w + 2.5;
      ctx.stroke();

      ctx.beginPath(); this.path(geom);
      ctx.strokeStyle = this.arcColor;
      ctx.globalAlpha = dim ? 0.12 : 0.42;
      ctx.lineWidth = w;
      ctx.stroke();

      // the travelling head
      const t = (this.clock * a.speed + a.phase) % 1;
      const head = Math.round(t * (ARC_SAMPLES - 1));
      const tail = Math.max(0, head - TRAIL);
      if (head > tail) {
        const seg = { type: "LineString", coordinates: a.pts.slice(tail, head + 1) } as any;
        ctx.beginPath(); this.path(seg);
        ctx.strokeStyle = this.arcColor;
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.lineWidth = w;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // dot at the partner end, only when that anchor is on the visible side
      const p = this.projection(a.partner);
      if (p && this.visible(a.partner)) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], Math.max(2.2, w * 0.45), 0, Math.PI * 2);
        ctx.fillStyle = this.arcColor;
        ctx.globalAlpha = dim ? 0.35 : 1;
        ctx.fill();
        ctx.strokeStyle = theme.ocean;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    this.drawHub();
    this.drawArcLabels();
  }

  /** Ring on the selected country so the hub of the flows is unmistakable. */
  private drawHub() {
    const a = this.arcs[0];
    if (!a) return;
    const hub = a.partner === a.from ? a.to : a.from;
    if (!this.visible(hub)) return;
    const p = this.projection(hub);
    if (!p) return;
    const { ctx, theme } = this;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 5.5, 0, Math.PI * 2);
    ctx.fillStyle = theme.surface;
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /**
   * Percentages read directly off the map for the biggest flows. Labels are placed
   * outward from the hub and any that would collide with one already placed is
   * dropped rather than overlapped -- the panel lists every partner regardless.
   */
  private drawArcLabels() {
    const { ctx, theme } = this;
    const placed: [number, number, number, number][] = [];
    ctx.font = "600 11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";

    let drawn = 0;
    for (const a of this.arcs) {
      if (drawn >= 9 || a.share < 0.01) break;
      if (!this.visible(a.partner)) continue;
      const p = this.projection(a.partner);
      if (!p) continue;

      const hub = a.partner === a.from ? a.to : a.from;
      const h = this.projection(hub);
      // push the label away from the hub so it does not sit on the arc bundle
      let dx = 10, dy = -10;
      if (h) {
        const vx = p[0] - h[0], vy = p[1] - h[1];
        const len = Math.hypot(vx, vy) || 1;
        dx = (vx / len) * 14;
        dy = (vy / len) * 14;
      }
      const w = ctx.measureText(a.label).width;
      const x = p[0] + dx - (dx < 0 ? w : 0);
      const y = p[1] + dy;
      const box: [number, number, number, number] = [x - 3, y - 8, w + 6, 16];
      if (box[0] < 2 || box[0] + box[2] > this.width - 2 || box[1] < 2 || box[1] + box[3] > this.height - 2) continue;
      if (placed.some((q) => overlaps(q, box))) continue;
      placed.push(box);

      ctx.strokeStyle = theme.ocean;
      ctx.lineWidth = 3.5;
      ctx.lineJoin = "round";
      ctx.strokeText(a.label, x, y);
      ctx.fillStyle = theme.ink;
      ctx.fillText(a.label, x, y);
      drawn++;
    }
  }

  private visible(coord: [number, number]) {
    if (this.flat) return true;
    const r = this.projection.rotate();
    return geoDistance(coord, [-r[0], -r[1]]) < Math.PI / 2;
  }

  private at(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.projection.invert?.([clientX - rect.left, clientY - rect.top]);
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
    if (!this.visible(p as [number, number])) return null;
    for (const f of this.feats) {
      const [[w, s], [e, n]] = f.bounds;
      if (p[1] < s - 0.5 || p[1] > n + 0.5) continue;
      // bounds can straddle the antimeridian, in which case west > east
      const inLon = w <= e ? p[0] >= w - 0.5 && p[0] <= e + 0.5 : p[0] >= w - 0.5 || p[0] <= e + 0.5;
      if (!inLon) continue;
      if (geoContains(f.geom, p as [number, number])) return f.id;
    }
    return null;
  }

  private attach() {
    const sel = select(this.canvas);
    let v0: any, q0: any, r0: [number, number, number], moved = 0;

    sel.call(drag<HTMLCanvasElement, unknown>()
      .on("start", (event) => {
        moved = 0;
        this.spin = false;
        this.tween = null;
        this.canvas.classList.add("dragging");
        r0 = this.projection.rotate() as [number, number, number];
        if (this.flat) return;
        const inv = this.projection.invert?.([event.x, event.y]);
        if (!inv) return;
        v0 = versor.cartesian(inv);
        q0 = versor(r0);
      })
      .on("drag", (event) => {
        moved += Math.abs(event.dx) + Math.abs(event.dy);
        if (this.flat) {
          // a flat map only pans horizontally; tilting an equal-area projection is meaningless
          this.rotation = [r0[0] + event.x - event.subject.x, 0, 0];
        } else {
          if (!v0) return;
          const inv = this.projection.rotate(r0).invert?.([event.x, event.y]);
          if (!inv) return;
          const v1 = versor.cartesian(inv);
          const q1 = versor.multiply(q0, versor.delta(v0, v1));
          const rot = versor.rotation(q1) as [number, number, number];
          this.rotation = [rot[0], clamp(rot[1], -85, 85), 0];
        }
        this.applyProjection();
        this.dirty = true;
      })
      .on("end", (event) => {
        this.canvas.classList.remove("dragging");
        if (moved < 4) this.cb.onSelect(this.at(event.sourceEvent.clientX, event.sourceEvent.clientY));
      }));

    this.canvas.addEventListener("pointermove", (e) => {
      if (e.pressure > 0 && e.buttons) return;
      this.cb.onHover(this.at(e.clientX, e.clientY), e.clientX, e.clientY);
    });
    this.canvas.addEventListener("pointerleave", () => this.cb.onHover(null, 0, 0));

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0012), 0.7, 8);
      this.applyProjection();
      this.dirty = true;
    }, { passive: false });
  }
}

function sampleGreatCircle(a: [number, number], b: [number, number]): [number, number][] {
  const it = geoInterpolate(a, b);
  const out: [number, number][] = [];
  for (let i = 0; i < ARC_SAMPLES; i++) out.push(it(i / (ARC_SAMPLES - 1)) as [number, number]);
  return out;
}

function overlaps(a: [number, number, number, number], b: [number, number, number, number]) {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
