// Country life round a countryside track: spectators on grass banks at the
// corners (cheering, waving flags), marshals, a campsite, paddocks of sheep
// and cows, hay bales, a tractor ploughing, birds circling and a hot-air
// balloon drifting overhead. Lots of small figures, so people, animals,
// flags and birds are instanced and animated on the GPU; the few moving
// objects (tractor, balloon) are moved by `animate`.

import * as THREE from 'three';
import { distanceToCentreline } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { makeRng } from '../../shared/math/rng.ts';
import { animTime, toon } from './materials.ts';
import type { KeepOut } from './props.ts';
import { mergeGeometries } from './trackMesh.ts';

export interface CountryLife {
  group: THREE.Group;
  /** Objects the static batcher must leave alone (they move). */
  moving: THREE.Object3D[];
  keepOut: KeepOut[];
  /** Move the tractor and the balloon; `t` in seconds. */
  animate: (t: number) => void;
}

const SHIRTS = ['#e8322a', '#2f6fe0', '#f2c230', '#ffffff', '#2fae4e', '#f07a1a', '#9a45d8', '#222222', '#e88aa0', '#5ac8c8'];
const SKIN = ['#f1c8a0', '#e0b088', '#c08a62', '#8a5a3a', '#5a3a28', '#f4d8b8'];
const FLAGS = ['#e8322a', '#ffd84a', '#2f6fe0', '#ffffff', '#2fae4e', '#f07a1a'];

/** A box from its min corner to its max corner. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Merged boxes of one colour as one (batchable) mesh. */
function solid(color: string, geos: THREE.BufferGeometry[], shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(mergeGeometries(geos), toon(color));
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** A flat patch on the ground (a decal: takes shadows, casts none). */
function patch(w: number, d: number, color: string, y = 0.012): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(0, y, 0), toon(color));
  m.receiveShadow = true;
  m.userData.decal = true;
  return m;
}

/** Vertex shader snippet: a per-instance random phase in [0, 1). */
const PHASE = 'float ph = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);';

/** Time-animated toon material: `code` runs after begin_vertex with `transformed`, `ph` and `uTime`. */
function animated(code: string, opts: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  const mat = toon('#ffffff', opts);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = animTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${PHASE}\n${code}`);
  };
  return mat;
}

/** Instances from a list of matrices and colours. */
function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: { m: THREE.Matrix4; c: string }[], shadow = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const col = new THREE.Color();
  items.forEach((it, k) => {
    mesh.setMatrixAt(k, it.m);
    mesh.setColorAt(k, col.set(it.c));
  });
  mesh.count = items.length;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildCountryLife(track: Track, keepOut: KeepOut[]): CountryLife {
  const group = new THREE.Group();
  group.name = 'countryLife';
  const moving: THREE.Object3D[] = [];
  const own: KeepOut[] = [];
  const rnd = makeRng((track.def.seed ?? 1) * 6029);
  const choose = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const wallAt = (i: number) => track.hw[i] + track.def.runoff;
  const clear = track.def.width / 2 + (track.def.cornerWiden ?? 0) + track.def.runoff + 2;
  const b = track.bounds;
  const pad = 110;

  const free = (x: number, z: number, r: number) =>
    ![...keepOut, ...own].some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < (k.r + r) ** 2);
  // The camera looks north at 57°: h metres of height hide ~0.65·h of ground north of it.
  const hidesRoad = (x: number, z: number, r: number, h: number) => {
    for (let dz = r; dz >= -r - h * 0.65; dz -= 2) {
      for (const dx of [-r, 0, r]) if (distanceToCentreline(track, x + dx, z + dz) < clear) return true;
    }
    return false;
  };
  // distanceToCentreline only knows the strip near the road (1e9 beyond it).
  const far = (x: number, z: number) => {
    const near = distanceToCentreline(track, x, z);
    if (near < 1e8) return near;
    let best = Infinity;
    for (let i = 0; i < track.n; i += 3) best = Math.min(best, (track.px[i] - x) ** 2 + (track.pz[i] - z) ** 2);
    return Math.sqrt(best);
  };
  const pick = (r: number, h: number, minGap: number, maxGap: number): [number, number] | null => {
    for (let t = 0; t < 300; t++) {
      const x = b.minX - pad + rnd() * (b.maxX - b.minX + pad * 2);
      const z = b.minZ - pad + rnd() * (b.maxZ - b.minZ + pad * 2);
      const d = far(x, z);
      if (d < clear + r + minGap || d > clear + r + maxGap) continue;
      if (!free(x, z, r) || hidesRoad(x, z, r, h)) continue;
      return [x, z];
    }
    return null;
  };
  const place = (obj: THREE.Object3D, x: number, z: number, r: number, rot = 0) => {
    obj.position.set(x, 0, z);
    obj.rotation.y = rot;
    group.add(obj);
    own.push({ x, z, r });
  };

  // Figures collected everywhere and drawn as a few instanced meshes at the end.
  const people: { m: THREE.Matrix4; c: string }[] = [];
  const heads: { m: THREE.Matrix4; c: string }[] = [];
  const flags: { m: THREE.Matrix4; c: string }[] = [];
  const poles: THREE.BufferGeometry[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  /** A person standing at (x, y, z) facing `rot`, in a given shirt. */
  const person = (x: number, y: number, z: number, rot: number, shirt = choose(SHIRTS)) => {
    q.setFromAxisAngle(up, rot);
    const s = 0.9 + rnd() * 0.2;
    people.push({ m: m4.clone().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, s, 1)), c: shirt });
    heads.push({ m: m4.clone().compose(new THREE.Vector3(x, y + (s - 1) * 0.62, z), q, one), c: choose(SKIN) });
  };
  /** A flag on a pole, the pole's foot at (x, y, z). */
  const flag = (x: number, y: number, z: number, height: number, color: string, size = 1) => {
    poles.push(new THREE.CylinderGeometry(0.04, 0.04, height, 4).translate(x, y + height / 2, z));
    q.setFromAxisAngle(up, rnd() * 0.6 - 0.3);
    flags.push({ m: m4.clone().compose(new THREE.Vector3(x, y + height - 0.35 * size, z), q, new THREE.Vector3(size, size, size)), c: color });
  };

  // --- Spectator banks outside the corners: grass terraces behind a fence,
  // packed with people, flags among them, a marshal's post at one end.
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
  const bankGrass = ['#5ea248', '#55963f', '#4c8a3a'];
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
    const steps: THREE.BufferGeometry[][] = [[], [], []];
    for (let t = 0; t < tiers; t++) steps[t].push(box(-len / 2, 0, base + t * depth, len / 2, 0.4 * (t + 1), base + tiers * depth + 0.6));
    steps.forEach((geos, t) => g.add(solid(bankGrass[t], geos)));
    // Fence in front: posts and two rails, a banner or two hung on it.
    const fence: THREE.BufferGeometry[] = [];
    for (let a = -len / 2; a <= len / 2 + 0.01; a += 2.6) fence.push(box(a - 0.06, 0, base - 0.5, a + 0.06, 1.1, base - 0.38));
    fence.push(box(-len / 2, 0.55, base - 0.48, len / 2, 0.62, base - 0.4), box(-len / 2, 0.98, base - 0.48, len / 2, 1.05, base - 0.4));
    g.add(solid('#e8e4d8', fence));
    for (const a of [-len / 4, len / 4]) {
      if (rnd() < 0.3) continue;
      g.add(solid(choose(FLAGS), [box(a - 2.4, 0.5, base - 0.55, a + 2.4, 1.0, base - 0.5)], false));
    }
    group.add(g);
    g.position.set(track.px[i], 0, track.pz[i]);
    g.rotation.y = Math.atan2(nx, nz);
    // People on the terraces, facing the track.
    const face = Math.atan2(nx, nz) + Math.PI;
    const toWorld = (a: number, d: number) => [track.px[i] + tx * a + nx * d, track.pz[i] + tz * a + nz * d];
    for (let t = 0; t < tiers; t++) {
      for (let a = -len / 2 + 0.6; a < len / 2 - 0.4; a += 0.7) {
        if (rnd() < 0.3) continue;
        const [x, z] = toWorld(a + (rnd() - 0.5) * 0.25, base + t * depth + 0.5 + rnd() * 0.5);
        person(x, 0.4 * (t + 1), z, face);
        if (rnd() < 0.05) flag(x, 0.4 * (t + 1) + 0.9, z, 1.1, choose(FLAGS), 0.6);
      }
    }
    // The marshal's post: a little orange hut, a marshal and a flag.
    const [mx, mz] = toWorld(len / 2 + 3, base - 0.2);
    if (free(mx, mz, 2) && distanceToCentreline(track, mx, mz) > wallAt(i) + 2.5) {
      const hut = new THREE.Group();
      hut.add(solid('#f07a1a', [box(-0.9, 0, -0.9, 0.9, 2.1, 0.9)]));
      hut.add(solid('#f4f0e6', [box(-1.05, 2.1, -1.05, 1.05, 2.3, 1.05)]));
      place(hut, mx, mz, 1.5, face);
      const [px, pz] = toWorld(len / 2 + 1.4, base - 1.2);
      person(px, 0, pz, face, '#f07a1a');
      flag(px + tx * 0.4, 0, pz + tz * 0.4, 2.2, '#ffd84a', 1);
    }
    for (let a = -len / 2; a <= len / 2; a += 8) {
      const [x, z] = toWorld(a, base + (tiers * depth) / 2);
      own.push({ x, z, r: 5 });
    }
  }

  // --- A campsite: tents, caravans, cars and people about, a flag on a pole.
  for (let c = 0; c < 2; c++) {
    const p = pick(15, 3, 6, 40);
    if (!p) continue;
    const g = new THREE.Group();
    g.add(patch(30, 22, '#5a9444'));
    const tentColors = ['#e8322a', '#2f6fe0', '#f2c230', '#2fae4e', '#f07a1a', '#9a45d8'];
    for (let k = 0; k < 9; k++) {
      const x = -12 + rnd() * 24, z = -8 + rnd() * 16;
      const w = 2 + rnd() * 1.2;
      const tent = new THREE.CylinderGeometry(w * 0.62, w * 0.62, 2.6 + rnd(), 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 6).translate(0, w * 0.31, 0);
      tent.rotateY(rnd() * Math.PI).translate(x, 0, z);
      g.add(solid(choose(tentColors), [tent]));
    }
    for (let k = 0; k < 2; k++) {
      const x = -10 + k * 18 + rnd() * 3, z = 8 - rnd() * 2;
      g.add(solid('#f2f0e8', [box(x - 2.6, 0.35, z - 1.1, x + 2.6, 2.5, z + 1.1)]));
      g.add(solid(choose(['#2f6fe0', '#e8322a', '#2fae4e']), [box(x - 2.62, 1.2, z + 1.1, x + 2.62, 1.45, z + 1.14), box(x - 2.62, 1.2, z - 1.14, x + 2.62, 1.45, z - 1.1)], false));
    }
    for (let k = 0; k < 3; k++) {
      const x = -13 + rnd() * 26, z = -10 + rnd() * 3;
      g.add(solid(choose(SHIRTS), [box(x - 0.95, 0.25, z - 2, x + 0.95, 1.05, z + 2)]));
      g.add(solid('#2a3446', [box(x - 0.85, 1.05, z - 1, x + 0.85, 1.55, z + 0.8)]));
    }
    const rot = rnd() * 0.4 - 0.2;
    place(g, p[0], p[1], 16, rot);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const at = (x: number, z: number) => [p[0] + x * cs + z * sn, p[1] - x * sn + z * cs];
    for (let k = 0; k < 10; k++) {
      const [x, z] = at(-12 + rnd() * 24, -8 + rnd() * 16);
      person(x, 0, z, rnd() * Math.PI * 2);
    }
    const [fx, fz] = at(0, 0);
    flag(fx, 0, fz, 5, choose(FLAGS), 1.4);
  }

  // --- Paddocks: a fenced patch of lusher grass with sheep or cows grazing.
  const sheep: { m: THREE.Matrix4; c: string }[] = [];
  const cows: { m: THREE.Matrix4; c: string }[] = [];
  for (let k = 0; k < 4; k++) {
    const p = pick(15, 2, 8, 120);
    if (!p) continue;
    const g = new THREE.Group();
    const w = 26, d = 18;
    g.add(patch(w, d, '#5e9c48'));
    const fence: THREE.BufferGeometry[] = [];
    for (let x = -w / 2; x <= w / 2 + 0.01; x += 2.6) fence.push(box(x - 0.07, 0, -d / 2 - 0.07, x + 0.07, 1, -d / 2 + 0.07), box(x - 0.07, 0, d / 2 - 0.07, x + 0.07, 1, d / 2 + 0.07));
    for (let z = -d / 2; z <= d / 2 + 0.01; z += 2.6) fence.push(box(-w / 2 - 0.07, 0, z - 0.07, -w / 2 + 0.07, 1, z + 0.07), box(w / 2 - 0.07, 0, z - 0.07, w / 2 + 0.07, 1, z + 0.07));
    for (const y of [0.5, 0.88]) {
      fence.push(box(-w / 2, y, -d / 2 - 0.04, w / 2, y + 0.07, -d / 2 + 0.04), box(-w / 2, y, d / 2 - 0.04, w / 2, y + 0.07, d / 2 + 0.04));
      fence.push(box(-w / 2 - 0.04, y, -d / 2, -w / 2 + 0.04, y + 0.07, d / 2), box(w / 2 - 0.04, y, -d / 2, w / 2 + 0.04, y + 0.07, d / 2));
    }
    g.add(solid('#8a6a4a', fence));
    // A water trough.
    g.add(solid('#9aa0a6', [box(w / 2 - 4, 0, -d / 2 + 1.2, w / 2 - 1.2, 0.6, -d / 2 + 2)]));
    const rot = rnd() * 0.3 - 0.15;
    place(g, p[0], p[1], 16, rot);
    const herd = k % 2 === 0 ? sheep : cows;
    const count = herd === sheep ? 9 + Math.floor(rnd() * 5) : 4 + Math.floor(rnd() * 3);
    for (let a = 0; a < count; a++) {
      const lx = -w / 2 + 2 + rnd() * (w - 4), lz = -d / 2 + 2 + rnd() * (d - 4);
      const x = p[0] + lx * Math.cos(rot) + lz * Math.sin(rot);
      const z = p[1] - lx * Math.sin(rot) + lz * Math.cos(rot);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      const c = herd === sheep ? (rnd() < 0.1 ? '#4a4440' : '#f0ece2') : choose(['#f2f0ea', '#2a2624', '#8a5a3a', '#f2f0ea']);
      const size = herd === sheep ? 1 : 1.25;
      herd.push({ m: m4.clone().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(size, size, size)), c });
    }
  }
  if (sheep.length) {
    // Woolly body; the head (and legs) are dark and nod while grazing.
    const body = new THREE.IcosahedronGeometry(0.62, 0).scale(1, 0.75, 1.3).translate(0, 0.72, 0);
    group.add(instanced(body, toon('#ffffff'), sheep));
    const head = mergeGeometries([box(-0.17, -0.2, 0, 0.17, 0.15, 0.42), box(-0.3, -0.72, -0.5, -0.18, -0.2, -0.38), box(0.18, -0.72, -0.5, 0.3, -0.2, -0.38), box(-0.3, -0.72, 0.3, -0.18, -0.2, 0.42), box(0.18, -0.72, 0.3, 0.3, -0.2, 0.42)]).translate(0, 0.92, 0.72);
    group.add(instanced(head, animated('if (position.z > 0.6) transformed.y -= (0.5 + 0.5 * sin(uTime * (0.7 + ph) + ph * 40.0)) * 0.3;'), sheep.map((s) => ({ m: s.m, c: '#2a2624' }))));
  }
  if (cows.length) {
    const body = mergeGeometries([box(-0.55, 0.65, -1.1, 0.55, 1.45, 1.1), box(-0.5, 0, -0.95, -0.3, 0.7, -0.75), box(0.3, 0, -0.95, 0.5, 0.7, -0.75), box(-0.5, 0, 0.75, -0.3, 0.7, 0.95), box(0.3, 0, 0.75, 0.5, 0.7, 0.95)]);
    group.add(instanced(body, toon('#ffffff'), cows));
    const head = box(-0.28, -0.3, 0, 0.28, 0.25, 0.6).translate(0, 1.35, 1.05);
    group.add(instanced(head, animated('transformed.y -= (0.5 + 0.5 * sin(uTime * (0.5 + ph) + ph * 40.0)) * 0.45 * step(0.5, position.z - 1.0);'), cows.map((c) => ({ m: c.m, c: c.c === '#2a2624' ? '#2a2624' : '#f2e8e0' }))));
  }

  // --- Hay bales lying about the fields in little groups.
  const bales: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const p = pick(7, 2, 10, 150);
    if (!p) continue;
    const n = 3 + Math.floor(rnd() * 5);
    for (let a = 0; a < n; a++) {
      const x = p[0] + (rnd() - 0.5) * 12, z = p[1] + (rnd() - 0.5) * 10;
      bales.push(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 10).rotateZ(Math.PI / 2).rotateY(rnd() * Math.PI).translate(x, 0.75, z));
    }
    own.push({ x: p[0], z: p[1], r: 8 });
  }
  if (bales.length) group.add(solid('#d8b860', bales));

  // --- A tractor ploughing a field, up and down the furrows.
  const tractors: { obj: THREE.Object3D; x: number; z: number; rot: number; w: number; d: number; speed: number }[] = [];
  {
    const p = pick(17, 3, 10, 120);
    if (p) {
      const w = 32, d = 22;
      const field = new THREE.Group();
      field.add(patch(w, d, '#7a5a3a'));
      const rows: THREE.BufferGeometry[] = [];
      for (let z = -d / 2 + 1; z < d / 2; z += 1.6) rows.push(new THREE.PlaneGeometry(w - 1, 0.6).rotateX(-Math.PI / 2).translate(0, 0.02, z));
      const furrows = solid('#5e4430', rows, false);
      furrows.userData.decal = true;
      field.add(furrows);
      const rot = rnd() * 0.3 - 0.15;
      place(field, p[0], p[1], 18, rot);
      const t = new THREE.Group();
      t.add(solid('#2f8a3a', [box(-0.6, 0.55, -0.4, 0.6, 1.25, 1.9)]));
      t.add(solid('#2f8a3a', [box(-0.75, 0.55, -1.3, 0.75, 2.4, -0.2)]));
      t.add(solid('#bfe0f0', [box(-0.7, 1.5, -1.25, 0.7, 2.2, -0.25)]));
      t.add(solid('#f2c230', [new THREE.CylinderGeometry(0.8, 0.8, 0.5, 10).rotateZ(Math.PI / 2).translate(-0.9, 0.8, -0.8), new THREE.CylinderGeometry(0.8, 0.8, 0.5, 10).rotateZ(Math.PI / 2).translate(0.9, 0.8, -0.8)]));
      t.add(solid('#1e1e22', [new THREE.CylinderGeometry(0.45, 0.45, 0.35, 8).rotateZ(Math.PI / 2).translate(-0.75, 0.45, 1.4), new THREE.CylinderGeometry(0.45, 0.45, 0.35, 8).rotateZ(Math.PI / 2).translate(0.75, 0.45, 1.4)]));
      t.add(solid('#8a9096', [box(-1.3, 0.2, -2.6, 1.3, 0.5, -1.7)]));
      group.add(t);
      moving.push(t);
      tractors.push({ obj: t, x: p[0], z: p[1], rot, w, d, speed: 2.2 });
    }
  }

  // --- A hot-air balloon drifting slowly, high over a quiet field.
  let balloon: { obj: THREE.Object3D; x: number; z: number } | null = null;
  {
    const p = pick(20, 48, 25, 160);
    if (p) {
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
      group.add(g);
      moving.push(g);
      balloon = { obj: g, x: p[0], z: p[1] };
    }
  }

  // --- Gulls circling in loose flocks, flapping as they go (white, so they
  // never pass for debris on the road).
  const birdItems: { m: THREE.Matrix4; c: string }[] = [];
  const birdParams: number[] = [];
  for (let f = 0; f < 3; f++) {
    const cx = b.minX + rnd() * (b.maxX - b.minX);
    const cz = b.minZ + rnd() * (b.maxZ - b.minZ);
    const r = 18 + rnd() * 20;
    const speed = (0.18 + rnd() * 0.1) * (rnd() < 0.5 ? 1 : -1);
    const phase = rnd() * 6.28;
    for (let k = 0; k < 7; k++) {
      birdItems.push({ m: new THREE.Matrix4().makeTranslation(cx, 24 + rnd() * 6, cz).scale(new THREE.Vector3(1.4, 1.4, 1.4)), c: '#f4f2ec' });
      birdParams.push(r + (rnd() - 0.5) * 6, speed * (0.95 + rnd() * 0.1), phase + rnd() * 0.5, rnd() * 6.28);
    }
  }
  {
    const wings = new THREE.BufferGeometry();
    wings.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, -0.75, 0, -0.1, 0, 0, -0.2, 0, 0, 0.25, 0, 0, -0.2, 0.75, 0, -0.1], 3));
    wings.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    wings.setAttribute('aBird', new THREE.InstancedBufferAttribute(new Float32Array(birdParams), 4));
    const mat = toon('#ffffff', { side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = animTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec4 aBird;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float a = uTime * aBird.y + aBird.z;
            vec3 p = transformed;
            p.y += abs(p.x) * sin(uTime * 9.0 + aBird.w) * 0.6;
            float ca = cos(a), sa = sin(a);
            // Nose along the circle, the way it flies round.
            vec2 v = sign(aBird.y) * vec2(-sa, ca);
            float th = atan(v.x, v.y);
            float ct = cos(th), st = sin(th);
            transformed = vec3(p.x * ct + p.z * st, p.y, -p.x * st + p.z * ct) + vec3(aBird.x * ca, sin(uTime * 0.4 + aBird.w) * 1.5, aBird.x * sa);
          }`,
        );
    };
    const birds = instanced(wings, mat, birdItems, false);
    birds.frustumCulled = false;
    group.add(birds);
  }

  // --- Everyone gathered above: people cheer (hop) now and then, flags wave.
  if (people.length) {
    const cheer = 'transformed.y += max(0.0, sin(uTime * (4.0 + ph * 4.0) + ph * 30.0)) * 0.2 * step(0.55, ph);';
    group.add(instanced(box(-0.22, 0, -0.15, 0.22, 0.62, 0.15), animated(cheer), people));
    group.add(instanced(box(-0.13, 0.62, -0.13, 0.13, 0.88, 0.13), animated(cheer), heads));
  }
  if (flags.length) {
    const flagGeo = new THREE.PlaneGeometry(1, 0.6, 5, 1).translate(0.5, 0, 0);
    group.add(instanced(flagGeo, animated('transformed.z += sin(uTime * 7.0 + position.x * 3.5 + ph * 20.0) * 0.16 * position.x;', { side: THREE.DoubleSide }), flags));
  }
  if (poles.length) group.add(solid('#dddddd', poles, false));

  const animate = (t: number) => {
    for (const tr of tractors) {
      // Up and down the field, a row further each pass; turning at the ends.
      const lane = tr.w - 6;
      const period = (lane / tr.speed) * 2;
      const ph = (t % period) / period;
      const fwd = ph < 0.5;
      const u = fwd ? ph * 2 : 2 - ph * 2;
      const row = Math.floor(t / period) % 6;
      const lx = -lane / 2 + u * lane;
      const lz = -tr.d / 2 + 3 + row * 3 + (fwd ? 0 : 1.5);
      const cs = Math.cos(tr.rot), sn = Math.sin(tr.rot);
      tr.obj.position.set(tr.x + lx * cs + lz * sn, 0, tr.z - lx * sn + lz * cs);
      tr.obj.rotation.y = tr.rot + (fwd ? Math.PI / 2 : -Math.PI / 2);
    }
    if (balloon) {
      balloon.obj.position.set(balloon.x + Math.sin(t * 0.05) * 9, 22 + Math.sin(t * 0.21) * 2.5, balloon.z + Math.sin(t * 0.037 + 1) * 7);
      balloon.obj.rotation.y = t * 0.03;
    }
  };
  animate(0);
  return { group, moving, keepOut: own, animate };
}
