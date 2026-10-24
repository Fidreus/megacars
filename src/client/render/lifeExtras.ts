// Theme extras for the life round a track (see trackLife.ts): oil pumpjacks
// nodding and tumbleweeds rolling in the desert, wind pumps turning,
// snowmen and skaters on the frozen pond in winter, work sites with crews
// in hi-vis round the power plant.

import * as THREE from 'three';
import { distanceToCentreline } from '../../shared/track/builder.ts';
import type { KeepOut } from './props.ts';
import { animated, at, box, compact, instanced, local, patch, solid, type Item, type LifeCtx } from './lifeKit.ts';

export type Extra = 'pumpjacks' | 'tumbleweeds' | 'windpumps' | 'snowmen' | 'skaters' | 'workers';

/** Clear of the road (with its run-off and barrier) by `gap` metres at (x, z). */
function offRoad(ctx: LifeCtx, x: number, z: number, gap: number): boolean {
  const { def } = ctx.track;
  return distanceToCentreline(ctx.track, x, z) > def.width / 2 + (def.cornerWiden ?? 0) + def.runoff + gap;
}

/** Oil pumpjacks nodding on their concrete pads. */
function pumpjacks(ctx: LifeCtx): void {
  const { rnd, choose } = ctx;
  for (let k = 0; k < 4; k++) {
    const p = ctx.pick(7, 10, 8, 140);
    if (!p) continue;
    const g = new THREE.Group();
    g.add(patch(9, 5, '#b8a888'));
    g.add(solid('#8a8a84', [box(-3.6, 0, -1, 3.6, 0.3, 1)]));
    // The samson post: an A-frame up to the pivot.
    g.add(solid('#3a3c42', [
      new THREE.CylinderGeometry(0.1, 0.12, 4.4, 4).rotateZ(0.2).translate(-0.45, 2.3, 0.5),
      new THREE.CylinderGeometry(0.1, 0.12, 4.4, 4).rotateZ(-0.2).translate(0.45, 2.3, 0.5),
      new THREE.CylinderGeometry(0.1, 0.12, 4.4, 4).rotateZ(0.2).translate(-0.45, 2.3, -0.5),
      new THREE.CylinderGeometry(0.1, 0.12, 4.4, 4).rotateZ(-0.2).translate(0.45, 2.3, -0.5),
    ]));
    g.add(solid('#5a5c62', [box(2.6, 0.3, -0.5, 3.4, 1.4, 0.5)]));
    const paint = choose(['#f2c230', '#e8322a', '#2f6fe0']);
    // The walking beam with the horse head, rocking on the pivot.
    const beam = new THREE.Group();
    beam.position.set(0, 4.4, 0);
    beam.add(solid('#2a2c30', [box(-3.4, -0.2, -0.22, 2.6, 0.2, 0.22)]));
    beam.add(solid(paint, [box(-4.1, -1.3, -0.3, -3.3, 0.5, 0.3), box(2.2, -1.2, -0.45, 3.0, -0.2, 0.45)]));
    compact(beam);
    g.add(beam);
    g.scale.setScalar(1.5);
    const rot = rnd() * Math.PI;
    ctx.place(g, p[0], p[1], 7, rot);
    ctx.moving.push(beam);
    const speed = 0.9 + rnd() * 0.5;
    const phase = rnd() * 6.28;
    ctx.animators.push((t) => {
      beam.rotation.z = Math.sin(t * speed + phase) * 0.28;
    });
  }
}

/** Tumbleweeds bowling along across the open desert, bouncing as they go. */
function tumbleweeds(ctx: LifeCtx): void {
  const { rnd } = ctx;
  const items: Item[] = [];
  const params: number[] = [];
  for (let k = 0; k < 16 && items.length < 12; k++) {
    const p = ctx.pick(2, 1, 3, 120);
    if (!p) continue;
    const dir = rnd() * Math.PI * 2;
    const range = 20 + rnd() * 25;
    // The whole roll must keep off the road.
    let ok = true;
    for (let d = 0; d <= range && ok; d += 3) ok = offRoad(ctx, p[0] + Math.sin(dir) * d, p[1] + Math.cos(dir) * d, 2) && ctx.free(p[0] + Math.sin(dir) * d, p[1] + Math.cos(dir) * d, 0.5);
    if (!ok) continue;
    items.push({ m: at(p[0], 0, p[1], dir, 0.7 + rnd() * 0.5), c: rnd() < 0.5 ? '#a8885a' : '#8a6e46' });
    params.push(range, 2.5 + rnd() * 2, rnd() * 100, 0);
  }
  if (!items.length) return;
  const geo = new THREE.IcosahedronGeometry(0.55, 1).translate(0, 0.55, 0);
  geo.setAttribute('aRoll', new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
  // Along local +z, wrapping round; shrinking to nothing at either end, bouncing.
  const roll = `{
    float d = mod(uTime * aRoll.y + aRoll.z, aRoll.x);
    float s = smoothstep(0.0, 2.0, d) * smoothstep(aRoll.x, aRoll.x - 2.0, d);
    transformed = transformed * s;
    transformed.z += d;
    transformed.y += abs(sin(d * 0.9)) * 0.7 * s;
  }`;
  const mesh = instanced(geo, animated(roll, { wireframe: false }, 'attribute vec4 aRoll;'), items, false);
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
}

/** Farm wind pumps on lattice towers, the rotor turning in the breeze. */
function windpumps(ctx: LifeCtx): void {
  const { rnd } = ctx;
  for (let k = 0; k < 2; k++) {
    const p = ctx.pick(3, 12, 10, 150);
    if (!p) continue;
    const g = new THREE.Group();
    const legs: THREE.BufferGeometry[] = [];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      legs.push(new THREE.CylinderGeometry(0.06, 0.06, 9.2, 4).rotateZ(x * 0.1).rotateX(-z * 0.1).translate(x * 0.55, 4.5, z * 0.55));
    }
    for (const y of [2.5, 5, 7.5]) legs.push(box(-0.9 + y * 0.04, y, -0.03, 0.9 - y * 0.04, y + 0.08, 0.03), box(-0.03, y, -0.9 + y * 0.04, 0.03, y + 0.08, 0.9 - y * 0.04));
    g.add(solid('#8a8f96', legs));
    g.add(solid('#c8322a', [box(-0.15, 8.8, -1.8, 0.15, 9.6, -0.2), box(-0.05, 8.6, -2.8, 0.05, 9.8, -1.8)]));
    g.add(solid('#2f6b8a', [new THREE.CylinderGeometry(2.2, 2.2, 1.4, 12).translate(4, 0.7, 2)]));
    const rotor = new THREE.Group();
    rotor.position.set(0, 9.2, 0.3);
    const blades: THREE.BufferGeometry[] = [];
    for (let b = 0; b < 12; b++) blades.push(box(-0.12, 0.2, -0.02, 0.12, 1.6, 0.02).rotateZ((b / 12) * Math.PI * 2));
    rotor.add(solid('#e8e6e0', blades, false));
    g.add(rotor);
    ctx.place(g, p[0], p[1], 3, 0);
    ctx.moving.push(rotor);
    const speed = 1.5 + rnd();
    ctx.animators.push((t) => {
      rotor.rotation.z = t * speed;
    });
  }
}

/** Snowmen about the place, with hats, scarves and carrot noses. */
function snowmen(ctx: LifeCtx): void {
  const { rnd, choose } = ctx;
  const snow: THREE.BufferGeometry[] = [];
  const hats: THREE.BufferGeometry[] = [];
  const carrots: THREE.BufferGeometry[] = [];
  const scarves = new Map<string, THREE.BufferGeometry[]>();
  for (let k = 0; k < 12; k++) {
    const p = ctx.pick(1.5, 3, 2, 70);
    if (!p) continue;
    const [x, z] = p;
    const s = 1.2 + rnd() * 0.6;
    snow.push(new THREE.IcosahedronGeometry(0.75 * s, 1).translate(x, 0.6 * s, z), new THREE.IcosahedronGeometry(0.55 * s, 1).translate(x, 1.5 * s, z), new THREE.IcosahedronGeometry(0.4 * s, 1).translate(x, 2.2 * s, z));
    hats.push(new THREE.CylinderGeometry(0.28 * s, 0.28 * s, 0.4 * s, 8).translate(x, 2.65 * s, z), new THREE.CylinderGeometry(0.42 * s, 0.42 * s, 0.05, 8).translate(x, 2.48 * s, z));
    carrots.push(new THREE.ConeGeometry(0.07 * s, 0.4 * s, 5).rotateX(Math.PI / 2).translate(x, 2.2 * s, z + 0.5 * s));
    const scarf = choose(['#e8322a', '#2f6fe0', '#2fae4e', '#f2c230']);
    let list = scarves.get(scarf);
    if (!list) scarves.set(scarf, (list = []));
    list.push(new THREE.CylinderGeometry(0.44 * s, 0.44 * s, 0.14 * s, 10).translate(x, 1.9 * s, z));
    ctx.own.push({ x, z, r: 1.5 });
  }
  if (!snow.length) return;
  ctx.group.add(solid('#f6f8fb', snow), solid('#1e1e22', hats), solid('#f07a1a', carrots, false));
  for (const [c, geos] of scarves) ctx.group.add(solid(c, geos, false));
}

/** Skaters gliding round the frozen pond, a few watching from the shore. */
function skaters(ctx: LifeCtx, pond: KeepOut | null): void {
  if (!pond) return;
  const { rnd, choose } = ctx;
  const bodies: Item[] = [];
  const heads: Item[] = [];
  const params: number[] = [];
  const skins = ['#f1c8a0', '#e0b088', '#c08a62', '#8a5a3a'];
  for (let k = 0; k < 9; k++) {
    const m = at(pond.x, 0.02, pond.z);
    bodies.push({ m, c: choose(ctx.shirts) });
    heads.push({ m, c: choose(skins) });
    params.push(pond.r * (0.25 + rnd() * 0.45), (0.25 + rnd() * 0.2) * (rnd() < 0.8 ? 1 : -1), rnd() * 6.28, rnd() * 6.28);
  }
  // Round the pond, nose along the circle, leaning into the turn with a sway.
  const skate = `{
    float a = uTime * aSkate.y + aSkate.z;
    float ca = cos(a), sa = sin(a);
    vec2 v = sign(aSkate.y) * vec2(-sa, ca);
    float th = atan(v.x, v.y) + sin(uTime * 2.5 + aSkate.w) * 0.25;
    float ct = cos(th), st = sin(th);
    vec3 p = transformed;
    transformed = vec3(p.x * ct + p.z * st, p.y, -p.x * st + p.z * ct) + vec3(aSkate.x * ca, 0.0, aSkate.x * sa);
  }`;
  const make = (geo: THREE.BufferGeometry, items: Item[]) => {
    geo.setAttribute('aSkate', new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
    const mesh = instanced(geo, animated(skate, {}, 'attribute vec4 aSkate;'), items, false);
    mesh.frustumCulled = false;
    ctx.group.add(mesh);
  };
  make(box(-0.22, 0, -0.15, 0.22, 0.62, 0.15), bodies);
  make(box(-0.13, 0.62, -0.13, 0.13, 0.88, 0.13), heads);
  for (let k = 0; k < 6; k++) {
    const a = rnd() * Math.PI * 2;
    const r = pond.r * 1.12 + rnd() * 1.5;
    ctx.person(pond.x + Math.cos(a) * r, 0, pond.z + Math.sin(a) * r, Math.atan2(-Math.cos(a), -Math.sin(a)), undefined, true);
  }
}

/** Work sites: a gravel patch, a crew in hi-vis and hard hats, cones, pipes and a sign. */
function workers(ctx: LifeCtx): void {
  const { rnd, choose } = ctx;
  for (let k = 0; k < 6; k++) {
    const p = ctx.pick(6, 3, 4, 90);
    if (!p) continue;
    const g = new THREE.Group();
    g.add(patch(10, 7, '#a09a8e'));
    const cones: THREE.BufferGeometry[] = [];
    for (let c = 0; c < 6; c++) cones.push(new THREE.ConeGeometry(0.22, 0.7, 6).translate(-4.6 + (c % 3) * 4.6, 0.35, c < 3 ? -3.2 : 3.2));
    g.add(solid('#f07a1a', cones, false));
    g.add(solid('#8a9096', [0, 1, 2].map((i) => new THREE.CylinderGeometry(0.35, 0.35, 5, 8).rotateZ(Math.PI / 2).translate(1, 0.35 + (i === 2 ? 0.6 : 0), -1 + i * 0.75 - (i === 2 ? 0.37 : 0)))));
    g.add(solid('#f2c230', [box(-3.6, 1.1, 1.9, -2.4, 2.1, 1.95)]));
    g.add(solid('#55585e', [box(-3.05, 0, 1.92, -2.95, 1.1, 1.98)], false));
    const rot = rnd() * Math.PI * 2;
    ctx.place(g, p[0], p[1], 6, rot);
    const hats: THREE.BufferGeometry[] = [];
    for (let w = 0; w < 4; w++) {
      const [x, z] = local(p[0], p[1], rot, -2.5 + rnd() * 3, -1.5 + rnd() * 3);
      const face = rnd() * Math.PI * 2;
      ctx.person(x, 0, z, face, choose(['#f07a1a', '#f2c230', '#c8e030']), true);
      hats.push(box(x - 0.17, 0.88, z - 0.17, x + 0.17, 1.0, z + 0.17));
    }
    ctx.group.add(solid('#f2f0e8', hats, false));
  }
}

export const EXTRAS: Record<Extra, (ctx: LifeCtx, pond: KeepOut | null) => void> = {
  pumpjacks,
  tumbleweeds,
  windpumps,
  snowmen,
  skaters,
  workers,
};
