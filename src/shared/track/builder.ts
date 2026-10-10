// Builds a playable track from its definition: centreline samples, barriers,
// a surface grid for the physics, checkpoints, the start grid and the AI
// racing line. Pure and deterministic, so server and clients agree.

import { Surface, type SurfaceId } from '../config/surfaces.ts';
import { headingOf, wrapAngle } from '../math/angle.ts';
import { SegmentGrid } from '../math/spatialHash.ts';
import { computeRacingLine } from '../ai/racingLine.ts';
import type { Bridge, GridSlot, SurfaceGrid, Track, TrackDef, Walls } from './types.ts';

/** Target spacing between centreline samples, metres. */
const SAMPLE_DS = 1;
/** Surface grid resolution, metres per cell. */
const SURFACE_CELL = 0.5;
/** Corners tighter than this radius get curbs. */
const CURB_RADIUS = 140;
/** Barriers stop cars up to this far above the road (bridges). */
const WALL_TOP = 2.5;
/** A bridge deck's thickness: cars below this pass under it. */
export const DECK_THICK = 1.4;
const WALL_ALL = 1e6;
/** Lower road within this distance of a crossing counts as under the bridge. */
const UNDER_ZONE = 30;
/** How much lower the far side of a broken bridge starts. */
export const GAP_LANDING = 0.7;

interface Prim {
  arc: boolean;
  ax: number;
  az: number;
  /** Heading at the start. */
  h0: number;
  len: number;
  r: number;
  /** Signed total turn (arcs), positive = right. */
  turn: number;
  cx: number;
  cz: number;
}

const cache = new Map<string, Track>();

/** Builds (or returns the cached) track. Tracks are immutable once built. */
export function getTrack(def: TrackDef): Track {
  let t = cache.get(def.id);
  if (!t || t.def !== def) {
    t = buildTrack(def);
    cache.set(def.id, t);
  }
  return t;
}

export function buildTrack(def: TrackDef): Track {
  const errors: string[] = [];
  const prims = buildPrims(def, errors);

  // --- Centreline samples
  const xs: number[] = [];
  const zs: number[] = [];
  const hs: number[] = [];
  const ks: number[] = [];
  const ss: number[] = [];
  let acc = 0;
  for (const p of prims) {
    if (p.len <= 1e-9) continue;
    const m = Math.max(1, Math.ceil(p.len / SAMPLE_DS));
    for (let k = 0; k < m; k++) {
      const u = (p.len * k) / m;
      if (!p.arc) {
        xs.push(p.ax + Math.sin(p.h0) * u);
        zs.push(p.az - Math.cos(p.h0) * u);
        hs.push(p.h0);
        ks.push(0);
      } else {
        const h = p.h0 + (p.turn * u) / p.len;
        const sgn = p.turn > 0 ? -1 : 1;
        xs.push(p.cx + sgn * Math.cos(h) * p.r);
        zs.push(p.cz + sgn * Math.sin(h) * p.r);
        hs.push(h);
        ks.push(p.turn > 0 ? 1 / p.r : -1 / p.r);
      }
      ss.push(acc + u);
    }
    acc += p.len;
  }
  const n = xs.length;
  const length = acc;
  const px = new Float64Array(xs);
  const pz = new Float64Array(zs);
  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  const nx = new Float64Array(n);
  const nz = new Float64Array(n);
  const curv = new Float64Array(ks);
  const s = new Float64Array(ss);
  const hw = new Float64Array(n).fill(def.width / 2);
  for (let i = 0; i < n; i++) {
    tx[i] = Math.sin(hs[i]);
    tz[i] = -Math.cos(hs[i]);
    nx[i] = Math.cos(hs[i]);
    nz[i] = Math.sin(hs[i]);
  }

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const reach = def.width / 2 + def.runoff;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, px[i] - reach);
    maxX = Math.max(maxX, px[i] + reach);
    minZ = Math.min(minZ, pz[i] - reach);
    maxZ = Math.max(maxZ, pz[i] + reach);
  }

  const track: Track = {
    def, n, length, px, pz, tx, tz, nx, nz, s, curv, hw,
    walls: null as unknown as Walls,
    surface: null as unknown as SurfaceGrid,
    checkpoints: new Float64Array(0),
    grid: [],
    ramps: [],
    bridges: [],
    elev: new Float64Array(n),
    deck: new Uint8Array(n),
    line: null as unknown as Track['line'],
    bounds: { minX, minZ, maxX, maxZ },
    errors,
  };
  buildBridges(track);
  track.walls = buildWalls(track);
  track.surface = buildSurfaceGrid(track);
  const ncp = Math.max(6, Math.round(length / 120));
  track.checkpoints = new Float64Array(ncp);
  for (let k = 0; k < ncp; k++) track.checkpoints[k] = (k * length) / ncp;
  track.grid = buildGrid(track, 8);
  for (const r of def.ramps ?? []) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (px[i] - r.x) ** 2 + (pz[i] - r.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const s1 = s[best];
    if (s1 - r.length < 0) errors.push(`ramp at (${r.x}, ${r.z}) crosses the start line`);
    track.ramps.push({ s0: s1 - r.length, s1, height: r.height });
  }
  track.line = computeRacingLine(track);
  return track;
}

function dirX(h: number): number {
  return Math.sin(h);
}
function dirZ(h: number): number {
  return -Math.cos(h);
}

function buildPrims(def: TrackDef, errors: string[]): Prim[] {
  const P = def.path;
  const n = P.length;
  const hin: number[] = [];
  const hout: number[] = [];
  const turn: number[] = [];
  const tl: number[] = [];
  const minR = def.width / 2 + def.runoff + 0.5;
  for (let i = 0; i < n; i++) {
    const prev = P[(i - 1 + n) % n];
    const cur = P[i];
    const next = P[(i + 1) % n];
    hin[i] = headingOf(cur.x - prev.x, cur.z - prev.z);
    hout[i] = headingOf(next.x - cur.x, next.z - cur.z);
    turn[i] = wrapAngle(hout[i] - hin[i]);
    tl[i] = Math.abs(turn[i]) > 1e-6 ? cur.r * Math.tan(Math.abs(turn[i]) / 2) : 0;
    if (Math.abs(turn[i]) > 1e-6 && cur.r < minR) {
      errors.push(`corner ${i}: radius ${cur.r} m is below ${minR.toFixed(1)} m (inner barrier would fold)`);
    }
    if (Math.abs(turn[i]) > Math.PI * 0.999) errors.push(`corner ${i}: turn of 180° or more is not allowed in one corner`);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const segLen = Math.hypot(P[j].x - P[i].x, P[j].z - P[i].z);
    if (tl[i] + tl[j] > segLen + 1e-6) {
      errors.push(`straight ${i}->${j}: corners need ${(tl[i] + tl[j]).toFixed(1)} m but only ${segLen.toFixed(1)} m available`);
    }
  }
  const ax = (i: number) => P[i].x - dirX(hin[i]) * tl[i];
  const az = (i: number) => P[i].z - dirZ(hin[i]) * tl[i];
  const bx = (i: number) => P[i].x + dirX(hout[i]) * tl[i];
  const bz = (i: number) => P[i].z + dirZ(hout[i]) * tl[i];

  const last = n - 1;
  const sx = bx(last) + (ax(0) - bx(last)) * def.startAt;
  const sz = bz(last) + (az(0) - bz(last)) * def.startAt;
  const prims: Prim[] = [];
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    prims.push({ arc: false, ax: x0, az: z0, h0: headingOf(x1 - x0, z1 - z0), len, r: 0, turn: 0, cx: 0, cz: 0 });
  };
  line(sx, sz, ax(0), az(0));
  for (let i = 0; i < n; i++) {
    if (tl[i] > 0) {
      const r = P[i].r;
      const h0 = hin[i];
      const sgn = turn[i] > 0 ? 1 : -1;
      const x0 = ax(i);
      const z0 = az(i);
      prims.push({
        arc: true, ax: x0, az: z0, h0, len: r * Math.abs(turn[i]), r, turn: turn[i],
        cx: x0 + sgn * Math.cos(h0) * r,
        cz: z0 + sgn * Math.sin(h0) * r,
      });
    }
    if (i < last) line(bx(i), bz(i), ax(i + 1), az(i + 1));
  }
  line(bx(last), bz(last), sx, sz);
  return prims;
}

/** Wall height class per sample: walls only merge within one class. */
function wallClass(track: Track, i: number): number {
  const d = track.deck[i];
  // Elevated walls follow the slope in short pieces so their heights stay tight.
  return d === 0 ? 0 : d * 1000 + Math.floor(track.s[i] / 6);
}

function buildWalls(track: Track): Walls {
  const { px, pz, nx, nz, hw, deck, elev } = track;
  const runoff = track.def.runoff;
  const n = px.length;
  const segs: number[] = []; // ax, az, bx, bz, nx, nz, lo, hi
  const outlines: Float64Array[] = [];
  for (const side of [1, -1]) {
    const ox = new Float64Array(n);
    const oz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d = (hw[i] + runoff) * side;
      ox[i] = px[i] + nx[i] * d;
      oz[i] = pz[i] + nz[i] * d;
    }
    const outline = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      outline[i * 2] = ox[i];
      outline[i * 2 + 1] = oz[i];
    }
    outlines.push(outline);
    // Merge nearly collinear runs into longer segments.
    let start = 0;
    const emit = (i0: number, i1: number) => {
      const x0 = ox[i0], z0 = oz[i0], x1 = ox[i1], z1 = oz[i1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-6) return;
      const dx = (x1 - x0) / len;
      const dz = (z1 - z0) / len;
      // Right of travel is (-dz, dx); the road is to the left of a right-side wall.
      const wnx = side > 0 ? dz : -dz;
      const wnz = side > 0 ? -dx : dx;
      // Heights it stops cars between: barriers on the ground stop everything,
      // except next to a bridge, where cars up on the deck pass over them.
      let lo = WALL_ALL;
      let hi = -WALL_ALL;
      for (let k = i0; ; k = (k + 1) % n) {
        const d = deck[k];
        if (d === 3) return; // the gap: nothing to hit
        if (d === 0) hi = WALL_ALL;
        else if (d === 4) hi = Math.max(hi, WALL_TOP);
        else hi = Math.max(hi, elev[k] + WALL_TOP);
        lo = Math.min(lo, d === 2 ? elev[k] - DECK_THICK : -WALL_ALL);
        if (k === i1) break;
      }
      segs.push(x0, z0, x1, z1, wnx, wnz, lo, hi);
    };
    for (let i = 1; i <= n; i++) {
      const cur = i % n;
      const next = (i + 1) % n;
      const h1 = Math.atan2(oz[cur] - oz[start], ox[cur] - ox[start]);
      const h2 = Math.atan2(oz[next] - oz[cur], ox[next] - ox[cur]);
      const runLen = Math.hypot(ox[cur] - ox[start], oz[cur] - oz[start]);
      if (i === n || Math.abs(wrapAngle(h2 - h1)) > 0.004 || runLen > 40 || wallClass(track, cur) !== wallClass(track, start)) {
        emit(start, cur);
        start = cur;
      }
    }
  }
  const count = segs.length / 8;
  const w: Omit<Walls, 'grid'> = {
    count,
    ax: new Float64Array(count), az: new Float64Array(count),
    bx: new Float64Array(count), bz: new Float64Array(count),
    nx: new Float64Array(count), nz: new Float64Array(count),
    lo: new Float64Array(count), hi: new Float64Array(count),
    outlines,
  };
  for (let i = 0; i < count; i++) {
    w.ax[i] = segs[i * 8];
    w.az[i] = segs[i * 8 + 1];
    w.bx[i] = segs[i * 8 + 2];
    w.bz[i] = segs[i * 8 + 3];
    w.nx[i] = segs[i * 8 + 4];
    w.nz[i] = segs[i * 8 + 5];
    w.lo[i] = segs[i * 8 + 6];
    w.hi[i] = segs[i * 8 + 7];
  }
  return { ...w, grid: new SegmentGrid(w.ax, w.az, w.bx, w.bz, count, 8) };
}

/** Signed distance from `from` to `to` along a closed loop of length L. */
function loopDelta(to: number, from: number, L: number): number {
  let d = to - from;
  if (d > L / 2) d -= L;
  else if (d < -L / 2) d += L;
  return d;
}

/**
 * Road height of a bridge at distance `s` along the track (0 away from it),
 * its slope, and whether `s` is over the hole of a broken bridge.
 */
export function bridgeProfile(b: Bridge, s: number, L: number, out: { h: number; slope: number; gap: number }): void {
  const u = loopDelta(s, b.s, L);
  const H = b.height;
  out.h = 0;
  out.slope = 0;
  out.gap = 0;
  if (!b.gap) {
    const a = Math.abs(u);
    if (a <= b.span) out.h = H;
    else if (a < b.span + b.ramp) {
      const v = (a - b.span) / b.ramp;
      out.h = (H * (1 + Math.cos(Math.PI * v))) / 2;
      out.slope = ((-H * Math.PI) / (2 * b.ramp)) * Math.sin(Math.PI * v) * Math.sign(u);
    }
    return;
  }
  if (u < -b.span) {
    // The ski jump: steepest at the edge.
    const a = -b.span - u;
    if (a < b.ramp) {
      const v = 1 - a / b.ramp;
      out.h = H * (1 - Math.cos((v * Math.PI) / 2));
      out.slope = ((H * Math.PI) / (2 * b.ramp)) * Math.sin((v * Math.PI) / 2);
    }
  } else if (u <= b.span) {
    out.gap = 1;
  } else {
    const a = u - b.span;
    if (a < b.ramp) {
      const L0 = H * GAP_LANDING;
      const v = a / b.ramp;
      out.h = (L0 * (1 + Math.cos(Math.PI * v))) / 2;
      out.slope = ((-L0 * Math.PI) / (2 * b.ramp)) * Math.sin(Math.PI * v);
    }
  }
}

const prof = { h: 0, slope: 0, gap: 0 };

/** Road height (bridges only), slope and gap flag at distance `s`. */
export function elevationAt(track: Track, s: number, out: { h: number; slope: number; gap: number }): void {
  out.h = 0;
  out.slope = 0;
  out.gap = 0;
  for (const b of track.bridges) {
    bridgeProfile(b, s, track.length, prof);
    if (prof.h > 0 || prof.gap) {
      out.h = prof.h;
      out.slope = prof.slope;
      out.gap = prof.gap;
      return;
    }
  }
}

/** Finds both passes through each bridge's crossing and raises the upper one. */
function buildBridges(track: Track): void {
  const { n, px, pz, s, def, errors } = track;
  for (const bd of def.bridges ?? []) {
    // Runs of samples close to the crossing point: one per pass.
    const near = (i: number) => (px[i] - bd.x) ** 2 + (pz[i] - bd.z) ** 2 < 36;
    let first = 0;
    while (first < n && near(first)) first++;
    const passes: number[] = [];
    let best = -1;
    let bestD = Infinity;
    for (let k = 1; k <= n; k++) {
      const i = (first + k) % n;
      if (near(i)) {
        const d = (px[i] - bd.x) ** 2 + (pz[i] - bd.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      } else if (best >= 0) {
        passes.push(best);
        best = -1;
        bestD = Infinity;
      }
    }
    passes.sort((a, b) => a - b);
    if (passes.length !== 2) {
      errors.push(`bridge at (${bd.x}, ${bd.z}): the track passes ${passes.length} times, need 2`);
      continue;
    }
    const iu = passes[bd.upper];
    const il = passes[1 - bd.upper];
    // Refine to the exact crossing along each pass.
    const project = (i: number) => s[i] + (bd.x - px[i]) * track.tx[i] + (bd.z - pz[i]) * track.tz[i];
    const b: Bridge = { s: project(iu), sLower: project(il), height: bd.height, span: bd.span, ramp: bd.ramp, gap: !!bd.gap };
    const reach = b.span + b.ramp + 2;
    if (b.s - reach < 0 || b.s + reach > track.length) errors.push(`bridge at (${bd.x}, ${bd.z}) crosses the start line`);
    track.bridges.push(b);
  }
  const L = track.length;
  for (let i = 0; i < n; i++) {
    for (const b of track.bridges) {
      bridgeProfile(b, s[i], L, prof);
      const u = loopDelta(s[i], b.s, L);
      if (Math.abs(u) < b.span + b.ramp) {
        track.deck[i] = prof.gap ? 3 : !b.gap && Math.abs(u) <= b.span ? 2 : 1;
        track.elev[i] = prof.gap ? b.height : prof.h;
      } else if (track.deck[i] === 0 && Math.abs(loopDelta(s[i], b.sLower, L)) < UNDER_ZONE) {
        track.deck[i] = 4;
      }
    }
  }
}

function buildSurfaceGrid(track: Track): SurfaceGrid {
  const { def, n, px, pz, hw, curv } = track;
  const cell = SURFACE_CELL;
  const pad = 40;
  const minX = Math.floor(track.bounds.minX - pad);
  const minZ = Math.floor(track.bounds.minZ - pad);
  const cols = Math.ceil((track.bounds.maxX + pad - minX) / cell);
  const rows = Math.ceil((track.bounds.maxZ + pad - minZ) / cell);
  const dist = new Float32Array(cols * rows).fill(1e9);
  const nearest = new Int32Array(cols * rows).fill(-1);
  const data = new Uint8Array(cols * rows).fill(Surface.Grass);
  const reach = def.width / 2 + def.runoff + 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = px[i], az = pz[i], bx = px[j], bz = pz[j];
    const ex = bx - ax, ez = bz - az;
    const len2 = ex * ex + ez * ez;
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - minX) / cell));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + reach - minX) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - minZ) / cell));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(az, bz) + reach - minZ) / cell));
    for (let r = r0; r <= r1; r++) {
      const cz = minZ + (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const cx = minX + (c + 0.5) * cell;
        let t = len2 > 0 ? ((cx - ax) * ex + (cz - az) * ez) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = cx - (ax + ex * t);
        const dz = cz - (az + ez * t);
        const d = Math.sqrt(dx * dx + dz * dz);
        const k = r * cols + c;
        if (d < dist[k]) {
          dist[k] = d;
          nearest[k] = i;
        }
      }
    }
  }
  const runoffSurface: SurfaceId = def.runoffSurface ?? Surface.Grass;
  for (let k = 0; k < data.length; k++) {
    const i = nearest[k];
    if (i < 0) continue;
    const d = dist[k];
    const h = hw[i];
    if (d <= h) {
      data[k] = d >= h - 0.9 && Math.abs(curv[i]) > 1 / CURB_RADIUS ? Surface.Curb : Surface.Asphalt;
    } else if (d <= h + def.runoff) {
      data[k] = runoffSurface;
    }
  }
  for (const p of def.patches ?? []) {
    const rect = p.hx !== undefined && p.hz !== undefined;
    const ex = rect ? p.hx! : p.r;
    const ez = rect ? p.hz! : p.r;
    const c0 = Math.max(0, Math.floor((p.x - ex - minX) / cell));
    const c1 = Math.min(cols - 1, Math.floor((p.x + ex - minX) / cell));
    const r0 = Math.max(0, Math.floor((p.z - ez - minZ) / cell));
    const r1 = Math.min(rows - 1, Math.floor((p.z + ez - minZ) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cx = minX + (c + 0.5) * cell;
        const cz = minZ + (r + 0.5) * cell;
        if (rect ? Math.abs(cx - p.x) > ex || Math.abs(cz - p.z) > ez : (cx - p.x) ** 2 + (cz - p.z) ** 2 > p.r * p.r) continue;
        const k = r * cols + c;
        const i = nearest[k];
        if (i < 0) continue;
        const onRoad = dist[k] <= hw[i];
        const onRunoff = !onRoad && dist[k] <= hw[i] + def.runoff;
        if (onRoad || (p.runoff && onRunoff)) data[k] = p.surface;
      }
    }
  }
  return { minX, minZ, cell, cols, rows, data, dist };
}

export function surfaceAt(track: Track, x: number, z: number): SurfaceId {
  const g = track.surface;
  const c = Math.floor((x - g.minX) / g.cell);
  const r = Math.floor((z - g.minZ) / g.cell);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return Surface.Grass;
  return g.data[r * g.cols + c] as SurfaceId;
}

/** Distance from a point to the centreline (from the precomputed grid). */
export function distanceToCentreline(track: Track, x: number, z: number): number {
  const g = track.surface;
  const c = Math.floor((x - g.minX) / g.cell);
  const r = Math.floor((z - g.minZ) / g.cell);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return 1e9;
  return g.dist[r * g.cols + c];
}

/** Index of the last sample at or before distance `s` along the track. */
export function sampleIndexAt(track: Track, s: number): number {
  const L = track.length;
  s = ((s % L) + L) % L;
  let lo = 0;
  let hi = track.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.s[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Interpolated centreline point and heading at distance `s`. */
export function pointAt(track: Track, s: number, out: { x: number; z: number; heading: number }): void {
  const i = sampleIndexAt(track, s);
  const L = track.length;
  s = ((s % L) + L) % L;
  const u = s - track.s[i];
  out.x = track.px[i] + track.tx[i] * u;
  out.z = track.pz[i] + track.tz[i] * u;
  out.heading = headingOf(track.tx[i], track.tz[i]);
}

function buildGrid(track: Track, slots: number): GridSlot[] {
  const grid: GridSlot[] = [];
  const p = { x: 0, z: 0, heading: 0 };
  const lateral = Math.min(3, track.def.width * 0.22);
  for (let k = 0; k < slots; k++) {
    const row = Math.floor(k / 2);
    const col = k % 2;
    const s = track.length - 7 - row * 8 - col * 4;
    pointAt(track, s, p);
    const i = sampleIndexAt(track, s);
    const side = col === 0 ? -1 : 1;
    grid.push({ x: p.x + track.nx[i] * lateral * side, z: p.z + track.nz[i] * lateral * side, heading: p.heading });
  }
  return grid;
}
