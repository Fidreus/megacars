// Life round a track, as each theme orders it (Theme.life): spectators on
// terraces outside the corners (cheering, waving flags) with marshals,
// campsites, paddocks of animals, hay bales, a vehicle at work, people
// strolling, birds circling and a hot-air balloon drifting overhead, plus
// theme extras (lifeExtras.ts). Lots of small figures, so people, animals,
// flags and birds are instanced and animated on the GPU; the few bigger
// moving objects are moved by `animate`.

import * as THREE from 'three';
import { distanceToCentreline } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { toon } from './materials.ts';
import type { KeepOut } from './props.ts';
import { mergeGeometries } from './trackMesh.ts';
import { FLAGS, animated, at, box, chunked, compact, instanced, lifeContext, local, patch, solid, type Item, type LifeCtx } from './lifeKit.ts';
import { EXTRAS, type Extra } from './lifeExtras.ts';

export type Animal = 'sheep' | 'cow' | 'horse' | 'reindeer';
export type VehicleKind = 'tractor' | 'snowmobile' | 'truck' | 'forklift';

export interface LifeRecipe {
  /** Spectator terraces outside the corners: colours of the three steps (and the fence). */
  banks?: { steps: [string, string, string]; fence?: string };
  /** Campsites near the track: tents and caravans, or motorhomes. */
  camps?: { count: number; ground: string; kind: 'tents' | 'rv' };
  /** Fenced paddocks, one per animal listed. */
  paddocks?: { animals: Animal[]; ground: string; fence: string };
  /** Colour of round bales lying about (none if unset). */
  bales?: string;
  /** Vehicles going up and down a patch of ground (a field, a yard; none if no ground colour). */
  vehicles?: { kind: VehicleKind; ground?: string; rows?: string }[];
  balloon?: boolean;
  birds?: { color: string; height: number; flocks: number; size?: number };
  /** People strolling about, out to `maxGap` metres beyond the barriers. */
  walkers?: { count: number; maxGap: number };
  /** Shirt colours of the crowd. */
  shirts?: string[];
  extras?: Extra[];
}

export interface TrackLife {
  group: THREE.Group;
  /** Objects the static batcher must leave alone (they move). */
  moving: THREE.Object3D[];
  keepOut: KeepOut[];
  /** Move the bigger moving things; `t` in seconds. */
  animate: (t: number) => void;
}

export function buildTrackLife(track: Track, keepOut: KeepOut[], recipe: LifeRecipe, pond: KeepOut | null): TrackLife {
  const { ctx, finish } = lifeContext(track, keepOut, recipe.shirts);
  if (recipe.banks) banks(ctx, recipe.banks.steps, recipe.banks.fence ?? '#e8e4d8');
  for (const v of recipe.vehicles ?? []) vehicle(ctx, v.kind, v.ground, v.rows);
  if (recipe.camps) camps(ctx, recipe.camps.count, recipe.camps.ground, recipe.camps.kind);
  if (recipe.paddocks) paddocks(ctx, recipe.paddocks.animals, recipe.paddocks.ground, recipe.paddocks.fence);
  for (const e of recipe.extras ?? []) EXTRAS[e](ctx, pond);
  if (recipe.bales) bales(ctx, recipe.bales);
  if (recipe.walkers) walkers(ctx, recipe.walkers.count, recipe.walkers.maxGap);
  if (recipe.balloon) balloon(ctx);
  if (recipe.birds) birds(ctx, recipe.birds.color, recipe.birds.height, recipe.birds.flocks, recipe.birds.size ?? 1.4);
  finish();
  const animate = (t: number) => {
    for (const a of ctx.animators) a(t);
  };
  animate(0);
  return { group: ctx.group, moving: ctx.moving, keepOut: ctx.own, animate };
}

/** Terraces packed with people outside the corners, a marshal's post at one end. */
function banks(ctx: LifeCtx, steps: [string, string, string], fenceColor: string): void {
  const { track, rnd, choose, free, wallAt } = ctx;
  const corners: { i: number; k: number }[] = [];
  for (let i = 0; i < track.n; i++) {
    const k = track.curv[i];
    if (Math.abs(k) < 1 / 90 || track.deck[i] !== 0) continue;
    // The middle of each bend (a run of the same curvature).
    let a = i;
    while (a > 0 && Math.abs(track.curv[a - 1] - k) < 1e-9) a--;
    let e = i;
    while (e < track.n - 1 && Math.abs(track.curv[e + 1] - k) < 1e-9) e++;
    if (i === Math.floor((a + e) / 2)) corners.push({ i, k });
  }
  for (const { i, k } of corners) {
    const out = k > 0 ? -1 : 1;
    const nx = track.nx[i] * out, nz = track.nz[i] * out;
    const tx = track.tx[i], tz = track.tz[i];
    const base = wallAt(i) + 4.5;
    const len = 26;
    const tiers = 3;
    const depth = 1.5;
    // Every spot of the bank must stay clear of the road (and everything else).
    let ok = true;
    for (let a = -len / 2; a <= len / 2 && ok; a += 2) {
      for (const d of [base, base + tiers * depth]) {
        const x = track.px[i] + tx * a + nx * d, z = track.pz[i] + tz * a + nz * d;
        if (distanceToCentreline(track, x, z) < wallAt(i) + 3.5 || !free(x, z, 1.5)) ok = false;
      }
    }
    if (!ok) continue;
    const g = new THREE.Group();
    // Local frame: x along the track, z away from it.
    for (let t = 0; t < tiers; t++) g.add(solid(steps[t], [box(-len / 2, 0, base + t * depth, len / 2, 0.4 * (t + 1), base + tiers * depth + 0.6)]));
    // Fence in front: posts and two rails, a banner or two hung on it.
    const fence: THREE.BufferGeometry[] = [];
    for (let a = -len / 2; a <= len / 2 + 0.01; a += 2.6) fence.push(box(a - 0.06, 0, base - 0.5, a + 0.06, 1.1, base - 0.38));
    fence.push(box(-len / 2, 0.55, base - 0.48, len / 2, 0.62, base - 0.4), box(-len / 2, 0.98, base - 0.48, len / 2, 1.05, base - 0.4));
    g.add(solid(fenceColor, fence));
    for (const a of [-len / 4, len / 4]) {
      if (rnd() < 0.3) continue;
      g.add(solid(choose(FLAGS), [box(a - 2.4, 0.5, base - 0.55, a + 2.4, 1.0, base - 0.5)], false));
    }
    ctx.group.add(g);
    g.position.set(track.px[i], 0, track.pz[i]);
    g.rotation.y = Math.atan2(nx, nz);
    // People on the terraces, facing the track.
    const face = Math.atan2(nx, nz) + Math.PI;
    const toWorld = (a: number, d: number) => [track.px[i] + tx * a + nx * d, track.pz[i] + tz * a + nz * d];
    for (let t = 0; t < tiers; t++) {
      for (let a = -len / 2 + 0.6; a < len / 2 - 0.4; a += 0.7) {
        if (rnd() < 0.3) continue;
        const [x, z] = toWorld(a + (rnd() - 0.5) * 0.25, base + t * depth + 0.5 + rnd() * 0.5);
        ctx.person(x, 0.4 * (t + 1), z, face);
        if (rnd() < 0.05) ctx.flag(x, 0.4 * (t + 1) + 0.9, z, 1.1, choose(FLAGS), 0.6);
      }
    }
    // The marshal's post: a little orange hut, a marshal and a flag.
    const [mx, mz] = toWorld(len / 2 + 3, base - 0.2);
    if (free(mx, mz, 2) && distanceToCentreline(track, mx, mz) > wallAt(i) + 2.5) {
      const hut = new THREE.Group();
      hut.add(solid('#f07a1a', [box(-0.9, 0, -0.9, 0.9, 2.1, 0.9)]));
      hut.add(solid('#f4f0e6', [box(-1.05, 2.1, -1.05, 1.05, 2.3, 1.05)]));
      ctx.place(hut, mx, mz, 1.5, face);
      const [px, pz] = toWorld(len / 2 + 1.4, base - 1.2);
      ctx.person(px, 0, pz, face, '#f07a1a', true);
      ctx.flag(px + tx * 0.4, 0, pz + tz * 0.4, 2.2, '#ffd84a', 1);
    }
    for (let a = -len / 2; a <= len / 2; a += 8) {
      const [x, z] = toWorld(a, base + (tiers * depth) / 2);
      ctx.own.push({ x, z, r: 5 });
    }
  }
}

/** Campsites: tents and caravans (or motorhomes with awnings), cars, people about, a flag. */
function camps(ctx: LifeCtx, count: number, ground: string, kind: 'tents' | 'rv'): void {
  const { rnd, choose } = ctx;
  for (let c = 0; c < count; c++) {
    const p = ctx.pick(15, 3, 6, 40);
    if (!p) continue;
    const g = new THREE.Group();
    g.add(patch(30, 22, ground));
    const colors = ['#e8322a', '#2f6fe0', '#f2c230', '#2fae4e', '#f07a1a', '#9a45d8'];
    if (kind === 'tents') {
      for (let k = 0; k < 9; k++) {
        const x = -12 + rnd() * 24, z = -8 + rnd() * 16;
        const w = 2 + rnd() * 1.2;
        const tent = new THREE.CylinderGeometry(w * 0.62, w * 0.62, 2.6 + rnd(), 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 6).translate(0, w * 0.31, 0);
        tent.rotateY(rnd() * Math.PI).translate(x, 0, z);
        g.add(solid(choose(colors), [tent]));
      }
    }
    // Caravans (tents) or motorhomes with striped awnings (rv).
    const vans = kind === 'tents' ? 2 : 5;
    for (let k = 0; k < vans; k++) {
      const x = kind === 'tents' ? -10 + k * 18 + rnd() * 3 : -12 + (k % 3) * 11 + rnd() * 2;
      const z = kind === 'tents' ? 8 - rnd() * 2 : k < 3 ? -5 : 6;
      const len = kind === 'tents' ? 2.6 : 3.4;
      g.add(solid('#f2f0e8', [box(x - len, 0.35, z - 1.1, x + len, 2.5, z + 1.1)]));
      const trim = choose(['#2f6fe0', '#e8322a', '#2fae4e', '#f07a1a']);
      g.add(solid(trim, [box(x - len - 0.02, 1.2, z + 1.1, x + len + 0.02, 1.45, z + 1.14), box(x - len - 0.02, 1.2, z - 1.14, x + len + 0.02, 1.45, z - 1.1)], false));
      if (kind === 'rv') {
        g.add(solid('#2a3446', [box(x + len - 0.1, 1.3, z - 1, x + len + 0.05, 2.2, z + 1)], false));
        g.add(solid(trim, [box(x - len + 0.5, 2.3, z + 1.1, x + len - 1, 2.4, z + 3.2)]));
        g.add(solid('#f4f0e6', [box(x - 1.5, 0, z + 1.8, x - 0.9, 0.7, z + 2.4), box(x + 0.2, 0, z + 1.8, x + 0.8, 0.7, z + 2.4)], false));
      }
    }
    for (let k = 0; k < 3; k++) {
      const x = -13 + rnd() * 26, z = -10 + rnd() * 3;
      g.add(solid(choose(ctx.shirts), [box(x - 0.95, 0.25, z - 2, x + 0.95, 1.05, z + 2)]));
      g.add(solid('#2a3446', [box(x - 0.85, 1.05, z - 1, x + 0.85, 1.55, z + 0.8)]));
    }
    const rot = rnd() * 0.4 - 0.2;
    ctx.place(g, p[0], p[1], 16, rot);
    for (let k = 0; k < 10; k++) {
      const [x, z] = local(p[0], p[1], rot, -12 + rnd() * 24, -8 + rnd() * 16);
      if (k < 6) ctx.person(x, 0, z, rnd() * Math.PI * 2, undefined, true);
      else ctx.walker(x, z, rnd() * Math.PI * 2, 3 + rnd() * 5);
    }
    const [fx, fz] = local(p[0], p[1], rot, 0, 0);
    ctx.flag(fx, 0, fz, 5, choose(FLAGS), 1.4);
  }
}

interface AnimalKind {
  size: number;
  count: [number, number];
  body: () => THREE.BufferGeometry;
  head: () => THREE.BufferGeometry;
  /** Vertex code that lowers the head to graze (uses position, ph, uTime). */
  nod: string;
  colors: string[];
  headColor: (body: string) => string;
}

const ANIMALS: Record<Animal, AnimalKind> = {
  sheep: {
    size: 1,
    count: [9, 13],
    body: () => new THREE.IcosahedronGeometry(0.62, 0).scale(1, 0.75, 1.3).translate(0, 0.72, 0),
    head: () => mergeGeometries([box(-0.17, -0.2, 0, 0.17, 0.15, 0.42), box(-0.3, -0.72, -0.5, -0.18, -0.2, -0.38), box(0.18, -0.72, -0.5, 0.3, -0.2, -0.38), box(-0.3, -0.72, 0.3, -0.18, -0.2, 0.42), box(0.18, -0.72, 0.3, 0.3, -0.2, 0.42)]).translate(0, 0.92, 0.72),
    nod: 'if (position.z > 0.6) transformed.y -= (0.5 + 0.5 * sin(uTime * (0.7 + ph) + ph * 40.0)) * 0.3;',
    colors: ['#f0ece2', '#f0ece2', '#f0ece2', '#4a4440'],
    headColor: () => '#2a2624',
  },
  cow: {
    size: 1.25,
    count: [4, 6],
    body: () => mergeGeometries([box(-0.55, 0.65, -1.1, 0.55, 1.45, 1.1), box(-0.5, 0, -0.95, -0.3, 0.7, -0.75), box(0.3, 0, -0.95, 0.5, 0.7, -0.75), box(-0.5, 0, 0.75, -0.3, 0.7, 0.95), box(0.3, 0, 0.75, 0.5, 0.7, 0.95)]),
    head: () => box(-0.28, -0.3, 0, 0.28, 0.25, 0.6).translate(0, 1.35, 1.05),
    nod: 'transformed.y -= (0.5 + 0.5 * sin(uTime * (0.5 + ph) + ph * 40.0)) * 0.45 * step(0.5, position.z - 1.0);',
    colors: ['#f2f0ea', '#2a2624', '#8a5a3a', '#f2f0ea'],
    headColor: (c) => (c === '#2a2624' ? '#2a2624' : '#f2e8e0'),
  },
  horse: {
    size: 1.2,
    count: [3, 5],
    body: () => mergeGeometries([box(-0.4, 0.95, -1.0, 0.4, 1.6, 1.0), box(-0.35, 0, -0.85, -0.18, 1.0, -0.65), box(0.18, 0, -0.85, 0.35, 1.0, -0.65), box(-0.35, 0, 0.65, -0.18, 1.0, 0.85), box(0.18, 0, 0.65, 0.35, 1.0, 0.85), box(-0.06, 0.9, -1.2, 0.06, 1.5, -1.0)]),
    head: () => mergeGeometries([box(-0.2, 1.4, 0.8, 0.2, 2.2, 1.25), box(-0.16, 1.9, 1.25, 0.16, 2.2, 1.75)]),
    nod: 'transformed.y -= (0.5 + 0.5 * sin(uTime * (0.4 + ph) + ph * 40.0)) * 0.9 * step(1.2, position.y) * step(0.8, position.z);',
    colors: ['#6a4428', '#3a2a20', '#a8784a', '#f0ece2', '#8a5a3a'],
    headColor: (c) => c,
  },
  reindeer: {
    size: 1,
    count: [5, 8],
    body: () => mergeGeometries([box(-0.35, 0.8, -0.85, 0.35, 1.4, 0.85), box(-0.3, 0, -0.7, -0.15, 0.85, -0.55), box(0.15, 0, -0.7, 0.3, 0.85, -0.55), box(-0.3, 0, 0.55, -0.15, 0.85, 0.7), box(0.15, 0, 0.55, 0.3, 0.85, 0.7), box(-0.36, 0.8, -0.86, 0.36, 1.0, -0.4)]),
    head: () => mergeGeometries([box(-0.17, 1.3, 0.75, 0.17, 1.85, 1.15), box(-0.13, 1.6, 1.15, 0.13, 1.82, 1.5), box(-0.5, 1.85, 0.8, -0.1, 1.95, 0.9), box(0.1, 1.85, 0.8, 0.5, 1.95, 0.9), box(-0.5, 1.95, 0.75, -0.4, 2.5, 0.85), box(0.4, 1.95, 0.75, 0.5, 2.5, 0.85)]),
    nod: 'transformed.y -= (0.5 + 0.5 * sin(uTime * (0.5 + ph) + ph * 40.0)) * 0.7 * step(1.2, position.y) * step(0.7, position.z);',
    colors: ['#8a6a4a', '#7a5a3a', '#9a7a58', '#6a4a30'],
    headColor: (c) => c,
  },
};

/** Fenced paddocks with a few animals grazing, a water trough in the corner. */
function paddocks(ctx: LifeCtx, animals: readonly Animal[], ground: string, fenceColor: string): void {
  const { rnd, choose } = ctx;
  const herds = new Map<Animal, Item[]>();
  for (const animal of animals) {
    const p = ctx.pick(15, 2, 8, 120);
    if (!p) continue;
    const g = new THREE.Group();
    const w = 26, d = 18;
    g.add(patch(w, d, ground));
    const fence: THREE.BufferGeometry[] = [];
    for (let x = -w / 2; x <= w / 2 + 0.01; x += 2.6) fence.push(box(x - 0.07, 0, -d / 2 - 0.07, x + 0.07, 1, -d / 2 + 0.07), box(x - 0.07, 0, d / 2 - 0.07, x + 0.07, 1, d / 2 + 0.07));
    for (let z = -d / 2; z <= d / 2 + 0.01; z += 2.6) fence.push(box(-w / 2 - 0.07, 0, z - 0.07, -w / 2 + 0.07, 1, z + 0.07), box(w / 2 - 0.07, 0, z - 0.07, w / 2 + 0.07, 1, z + 0.07));
    for (const y of [0.5, 0.88]) {
      fence.push(box(-w / 2, y, -d / 2 - 0.04, w / 2, y + 0.07, -d / 2 + 0.04), box(-w / 2, y, d / 2 - 0.04, w / 2, y + 0.07, d / 2 + 0.04));
      fence.push(box(-w / 2 - 0.04, y, -d / 2, -w / 2 + 0.04, y + 0.07, d / 2), box(w / 2 - 0.04, y, -d / 2, w / 2 + 0.04, y + 0.07, d / 2));
    }
    g.add(solid(fenceColor, fence));
    g.add(solid('#9aa0a6', [box(w / 2 - 4, 0, -d / 2 + 1.2, w / 2 - 1.2, 0.6, -d / 2 + 2)]));
    const rot = rnd() * 0.3 - 0.15;
    ctx.place(g, p[0], p[1], 16, rot);
    const kind = ANIMALS[animal];
    let herd = herds.get(animal);
    if (!herd) herds.set(animal, (herd = []));
    const n = kind.count[0] + Math.floor(rnd() * (kind.count[1] - kind.count[0] + 1));
    for (let a = 0; a < n; a++) {
      const [x, z] = local(p[0], p[1], rot, -w / 2 + 2 + rnd() * (w - 4), -d / 2 + 2 + rnd() * (d - 4));
      herd.push({ m: at(x, 0, z, rnd() * Math.PI * 2, kind.size), c: choose(kind.colors) });
    }
  }
  for (const [animal, herd] of herds) {
    const kind = ANIMALS[animal];
    for (const m of chunked(kind.body(), toon('#ffffff'), herd, { shadow: true })) ctx.group.add(m);
    for (const m of chunked(kind.head(), animated(kind.nod), herd.map((h) => ({ m: h.m, c: kind.headColor(h.c) })), { shadow: true, reach: 1 })) ctx.group.add(m);
  }
}

/** Round bales lying about the fields in little groups. */
function bales(ctx: LifeCtx, color: string): void {
  const { rnd } = ctx;
  const geos: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const p = ctx.pick(7, 2, 10, 150);
    if (!p) continue;
    const n = 3 + Math.floor(rnd() * 5);
    for (let a = 0; a < n; a++) {
      const x = p[0] + (rnd() - 0.5) * 12, z = p[1] + (rnd() - 0.5) * 10;
      geos.push(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 10).rotateZ(Math.PI / 2).rotateY(rnd() * Math.PI).translate(x, 0.75, z));
    }
    ctx.own.push({ x: p[0], z: p[1], r: 8 });
  }
  if (geos.length) ctx.group.add(solid(color, geos));
}

/** A vehicle model, nose along +z. */
function vehicleModel(kind: VehicleKind, rnd: () => number): THREE.Group {
  const t = new THREE.Group();
  const wheel = (r: number, w: number, x: number, y: number, z: number) => new THREE.CylinderGeometry(r, r, w, 10).rotateZ(Math.PI / 2).translate(x, y, z);
  if (kind === 'tractor') {
    t.add(solid('#2f8a3a', [box(-0.6, 0.55, -0.4, 0.6, 1.25, 1.9), box(-0.75, 0.55, -1.3, 0.75, 2.4, -0.2)]));
    t.add(solid('#bfe0f0', [box(-0.7, 1.5, -1.25, 0.7, 2.2, -0.25)]));
    t.add(solid('#f2c230', [wheel(0.8, 0.5, -0.9, 0.8, -0.8), wheel(0.8, 0.5, 0.9, 0.8, -0.8)]));
    t.add(solid('#1e1e22', [wheel(0.45, 0.35, -0.75, 0.45, 1.4), wheel(0.45, 0.35, 0.75, 0.45, 1.4)]));
    t.add(solid('#8a9096', [box(-1.3, 0.2, -2.6, 1.3, 0.5, -1.7)]));
  } else if (kind === 'snowmobile') {
    t.add(solid(rnd() < 0.5 ? '#e8322a' : '#2f6fe0', [box(-0.5, 0.35, -0.9, 0.5, 0.9, 1.1)]));
    t.add(solid('#1e1e22', [box(-0.45, 0.05, -1.3, 0.45, 0.4, 0.4), box(-0.6, 0.02, 1.0, -0.4, 0.12, 1.8), box(0.4, 0.02, 1.0, 0.6, 0.12, 1.8)]));
    t.add(solid('#2f2f36', [box(-0.22, 0.9, -0.6, 0.22, 1.6, -0.2)]));
    t.add(solid('#f4d8b8', [box(-0.13, 1.6, -0.53, 0.13, 1.86, -0.27)]));
  } else if (kind === 'truck') {
    const cab = rnd() < 0.5 ? '#f2c230' : '#e8e8e0';
    t.add(solid(cab, [box(-1.1, 0.6, 2.2, 1.1, 2.9, 4.0)]));
    t.add(solid('#2a3446', [box(-1.0, 1.9, 3.98, 1.0, 2.6, 4.05)], false));
    t.add(solid(rnd() < 0.5 ? '#c8ccd0' : '#5ac8c8', [box(-1.2, 0.8, -4.0, 1.2, 3.4, 2.0)]));
    t.add(solid('#1e1e22', [wheel(0.5, 0.4, -1.0, 0.5, 3.1), wheel(0.5, 0.4, 1.0, 0.5, 3.1), wheel(0.5, 0.4, -1.0, 0.5, -2.8), wheel(0.5, 0.4, 1.0, 0.5, -2.8), wheel(0.5, 0.4, -1.0, 0.5, -1.7), wheel(0.5, 0.4, 1.0, 0.5, -1.7)]));
  } else {
    t.add(solid('#f2c230', [box(-0.6, 0.3, -1.0, 0.6, 1.2, 0.8)]));
    t.add(solid('#2a2c30', [box(-0.55, 1.2, -0.9, -0.45, 2.4, 0.2), box(0.45, 1.2, -0.9, 0.55, 2.4, 0.2), box(-0.55, 2.3, -0.9, 0.55, 2.4, 0.2), box(-0.5, 0.2, 0.9, -0.35, 2.6, 1.0), box(0.35, 0.2, 0.9, 0.5, 2.6, 1.0)]));
    t.add(solid('#2a2a2e', [box(-0.5, 0.1, 1.0, 0.5, 0.18, 2.0)]));
    t.add(solid('#b07a48', [box(-0.6, 0.18, 1.0, 0.6, 1.1, 2.1)]));
    t.add(solid('#1e1e22', [wheel(0.3, 0.3, -0.6, 0.3, 0.5), wheel(0.3, 0.3, 0.6, 0.3, 0.5), wheel(0.25, 0.3, -0.6, 0.25, -0.7), wheel(0.25, 0.3, 0.6, 0.25, -0.7)]));
  }
  return t;
}

/** A vehicle working a patch of ground: up and down, a lane further each pass. */
function vehicle(ctx: LifeCtx, kind: VehicleKind, ground?: string, rows?: string): void {
  const { rnd } = ctx;
  const p = ctx.pick(17, 4, 10, 120);
  if (!p) return;
  const w = 32, d = 22;
  const field = new THREE.Group();
  if (ground) field.add(patch(w, d, ground));
  if (rows) {
    const strips: THREE.BufferGeometry[] = [];
    for (let z = -d / 2 + 1; z < d / 2; z += 1.6) strips.push(new THREE.PlaneGeometry(w - 1, 0.6).rotateX(-Math.PI / 2).translate(0, 0.02, z));
    const m = solid(rows, strips, false);
    m.userData.decal = true;
    field.add(m);
  }
  const rot = rnd() * 0.3 - 0.15;
  ctx.place(field, p[0], p[1], 18, rot);
  const v = vehicleModel(kind, rnd);
  compact(v);
  ctx.group.add(v);
  ctx.moving.push(v);
  const speed = kind === 'snowmobile' ? 5 : kind === 'truck' ? 3.5 : 2.2;
  const lane = w - 8;
  const period = (lane / speed) * 2;
  const offset = rnd() * period;
  ctx.animators.push((t) => {
    const tt = t + offset;
    const ph = (tt % period) / period;
    const fwd = ph < 0.5;
    const u = fwd ? ph * 2 : 2 - ph * 2;
    const row = Math.floor(tt / period) % 6;
    const [x, z] = local(p[0], p[1], rot, -lane / 2 + u * lane, -d / 2 + 3 + row * 3 + (fwd ? 0 : 1.5));
    v.position.set(x, 0, z);
    v.rotation.y = rot + (fwd ? Math.PI / 2 : -Math.PI / 2);
  });
}

/** People strolling about between the barriers and `maxGap` metres beyond. */
function walkers(ctx: LifeCtx, count: number, maxGap: number): void {
  const { rnd } = ctx;
  for (let k = 0; k < count; k++) {
    const p = ctx.pick(2, 2, 2, maxGap);
    if (!p) continue;
    const rot = rnd() * Math.PI * 2;
    const len = 4 + rnd() * 12;
    // The whole walk must stay off the road.
    const [ex, ez] = [p[0] + Math.sin(rot) * len, p[1] + Math.cos(rot) * len];
    const { def } = ctx.track;
    if (!ctx.free(ex, ez, 1) || distanceToCentreline(ctx.track, ex, ez) < def.width / 2 + (def.cornerWiden ?? 0) + def.runoff + 2) continue;
    ctx.walker(p[0], p[1], rot, len);
  }
}

/** A hot-air balloon drifting slowly, high over a quiet spot. */
function balloon(ctx: LifeCtx): void {
  const { choose } = ctx;
  const p = ctx.pick(20, 48, 25, 160);
  if (!p) return;
  const g = new THREE.Group();
  const env = new THREE.SphereGeometry(5, 12, 10).scale(1, 1.2, 1);
  // Vertical stripes in two colours, by the angle round the envelope.
  const pos = env.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const [ca, cb] = [new THREE.Color(choose(['#e8322a', '#2f6fe0', '#9a45d8'])), new THREE.Color(choose(['#ffd84a', '#ffffff']))];
  for (let v = 0; v < pos.count; v++) {
    const ang = Math.atan2(pos.getZ(v), pos.getX(v));
    const c = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 12 + 0.5) % 2 === 0 ? ca : cb;
    col.set([c.r, c.g, c.b], v * 3);
  }
  env.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const envelope = new THREE.Mesh(env.translate(0, 9, 0), toon('#ffffff', { vertexColors: true }));
  envelope.castShadow = true;
  g.add(envelope);
  g.add(solid('#8a5a3a', [box(-0.8, 0, -0.8, 0.8, 1.1, 0.8)]));
  g.add(solid('#5a4a3a', [0, 1, 2, 3].map((k) => new THREE.CylinderGeometry(0.03, 0.03, 3.4, 3).translate(Math.cos(k * 1.57) * 0.75, 2.6, Math.sin(k * 1.57) * 0.75))));
  compact(g);
  ctx.group.add(g);
  ctx.moving.push(g);
  ctx.animators.push((t) => {
    g.position.set(p[0] + Math.sin(t * 0.05) * 9, 22 + Math.sin(t * 0.21) * 2.5, p[1] + Math.sin(t * 0.037 + 1) * 7);
    g.rotation.y = t * 0.03;
  });
}

/** Birds circling in loose flocks, flapping as they go. */
function birds(ctx: LifeCtx, color: string, height: number, flocks: number, size: number): void {
  const { rnd, track } = ctx;
  const b = track.bounds;
  const items: Item[] = [];
  const params: number[] = [];
  for (let f = 0; f < flocks; f++) {
    const cx = b.minX + rnd() * (b.maxX - b.minX);
    const cz = b.minZ + rnd() * (b.maxZ - b.minZ);
    const r = 18 + rnd() * 20;
    const speed = (0.18 + rnd() * 0.1) * (rnd() < 0.5 ? 1 : -1);
    const phase = rnd() * 6.28;
    for (let k = 0; k < 7; k++) {
      items.push({ m: at(cx, height + rnd() * 6, cz, 0, size), c: color });
      params.push(r + (rnd() - 0.5) * 6, speed * (0.95 + rnd() * 0.1), phase + rnd() * 0.5, rnd() * 6.28);
    }
  }
  const wings = new THREE.BufferGeometry();
  wings.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, -0.75, 0, -0.1, 0, 0, -0.2, 0, 0, 0.25, 0, 0, -0.2, 0.75, 0, -0.1], 3));
  wings.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  wings.setAttribute('aBird', new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
  const fly = `{
    float a = uTime * aBird.y + aBird.z;
    vec3 p = transformed;
    p.y += abs(p.x) * sin(uTime * 9.0 + aBird.w) * 0.6;
    float ca = cos(a), sa = sin(a);
    // Nose along the circle, the way it flies round.
    vec2 v = sign(aBird.y) * vec2(-sa, ca);
    float th = atan(v.x, v.y);
    float ct = cos(th), st = sin(th);
    transformed = vec3(p.x * ct + p.z * st, p.y, -p.x * st + p.z * ct) + vec3(aBird.x * ca, sin(uTime * 0.4 + aBird.w) * 1.5, aBird.x * sa);
  }`;
  const mesh = instanced(wings, animated(fly, { side: THREE.DoubleSide }, 'attribute vec4 aBird;'), items, false);
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
}
