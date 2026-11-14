// Shared tools for the life round a track (trackLife.ts, lifeExtras.ts):
// simple geometry helpers, GPU-animated instancing, and a context that finds
// free spots near the track and collects the many small figures (people,
// flags, walkers) so they end up in a few instanced meshes.

import * as THREE from 'three';
import { distanceToCentreline } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { makeRng } from '../../shared/math/rng.ts';
import { animTime, toon } from './materials.ts';
import type { KeepOut } from './props.ts';
import { mergeGeometries } from './trackMesh.ts';

export const SHIRTS = ['#e8322a', '#2f6fe0', '#f2c230', '#ffffff', '#2fae4e', '#f07a1a', '#9a45d8', '#222222', '#e88aa0', '#5ac8c8'];
export const SKIN = ['#f1c8a0', '#e0b088', '#c08a62', '#8a5a3a', '#5a3a28', '#f4d8b8'];
export const FLAGS = ['#e8322a', '#ffd84a', '#2f6fe0', '#ffffff', '#2fae4e', '#f07a1a'];

/** A box from its min corner to its max corner. */
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Merged parts of one colour as one (batchable) mesh. */
export function solid(color: string, geos: THREE.BufferGeometry[], shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(mergeGeometries(geos), toon(color));
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** A flat patch on the ground (a decal: takes shadows, casts none). */
export function patch(w: number, d: number, color: string, y = 0.012): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(0, y, 0), toon(color));
  m.receiveShadow = true;
  m.userData.decal = true;
  return m;
}

/** Vertex shader snippet: a per-instance random phase in [0, 1). */
const PHASE = 'float ph = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);';

/**
 * Time-animated toon material: `code` runs after begin_vertex with
 * `transformed`, `ph` and `uTime`; `head` goes before main (attributes).
 */
export function animated(code: string, opts: THREE.MeshToonMaterialParameters = {}, head = ''): THREE.MeshToonMaterial {
  const mat = toon('#ffffff', opts);
  // Every animated material shares this function's source: key the program by its code.
  mat.customProgramCacheKey = () => head + code;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = animTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\n${head}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${PHASE}\n${code}`);
  };
  return mat;
}

export interface Item {
  m: THREE.Matrix4;
  c: string;
}

/** Instances from a list of matrices and colours. */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: readonly Item[], shadow = true): THREE.InstancedMesh {
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

/**
 * Instanced meshes for `items`, one per 80 m square cell so the camera (and
 * the shadow pass) only draws the cells it can see. `attr` adds a
 * per-instance vec4 (same order as items); `reach` is how far the vertex
 * animation moves a figure from its spot (widens the culling sphere).
 */
export function chunked(
  geo: THREE.BufferGeometry, mat: THREE.Material, items: readonly Item[],
  opts: { shadow?: boolean; attr?: { name: string; data: readonly number[] }; reach?: number } = {},
): THREE.InstancedMesh[] {
  const cells = new Map<string, number[]>();
  const p = new THREE.Vector3();
  items.forEach((it, k) => {
    p.setFromMatrixPosition(it.m);
    const key = `${Math.floor(p.x / 80)},${Math.floor(p.z / 80)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(k);
  });
  const out: THREE.InstancedMesh[] = [];
  for (const list of cells.values()) {
    const g = opts.attr ? geo.clone() : geo;
    if (opts.attr) {
      const data = new Float32Array(list.length * 4);
      list.forEach((k, j) => data.set(opts.attr!.data.slice(k * 4, k * 4 + 4), j * 4));
      g.setAttribute(opts.attr.name, new THREE.InstancedBufferAttribute(data, 4));
    }
    const mesh = instanced(g, mat, list.map((k) => items[k]), opts.shadow ?? false);
    mesh.computeBoundingSphere();
    if (opts.reach && mesh.boundingSphere) mesh.boundingSphere.radius += opts.reach;
    out.push(mesh);
  }
  return out;
}

/** Merge a model's parts into as few meshes as possible (one per material look), keeping it movable as one. */
export function compact(model: THREE.Object3D): void {
  model.updateMatrixWorld(true);
  const byColor = new Map<string, { geos: THREE.BufferGeometry[]; mat: THREE.Material; shadow: boolean }>();
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const parts: THREE.Mesh[] = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.parent !== model || Array.isArray(m.material) || m.geometry.getAttribute('color')) return;
    const mat = m.material as THREE.MeshToonMaterial;
    if (!mat.isMeshToonMaterial || mat.map || mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return;
    const key = `${mat.color.getHexString()}|${m.castShadow}`;
    let e = byColor.get(key);
    if (!e) byColor.set(key, (e = { geos: [], mat, shadow: m.castShadow }));
    e.geos.push(m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
    parts.push(m);
  });
  for (const m of parts) model.remove(m);
  for (const e of byColor.values()) {
    const m = new THREE.Mesh(mergeGeometries(e.geos), e.mat);
    m.castShadow = e.shadow;
    m.receiveShadow = true;
    model.add(m);
  }
}

/** Matrix for an object at (x, y, z) turned `rot` about y, scaled `s`. */
export function at(x: number, y: number, z: number, rot = 0, s: number | THREE.Vector3 = 1): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, typeof s === 'number' ? new THREE.Vector3(s, s, s) : s);
}

/** Point (lx, lz) of a group placed at (x, z) and turned `rot`, in world coordinates. */
export function local(x: number, z: number, rot: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

export interface LifeCtx {
  track: Track;
  group: THREE.Group;
  rnd: () => number;
  choose: <T>(xs: readonly T[]) => T;
  /** Objects the static batcher must leave alone (they move). */
  moving: THREE.Object3D[];
  /** Per-frame movers; `t` in seconds. */
  animators: ((t: number) => void)[];
  /** Space this life takes up (so later scenery stays clear of it). */
  own: KeepOut[];
  /** Distance from the centreline at which the barrier stands, at sample i. */
  wallAt: (i: number) => number;
  free: (x: number, z: number, r: number) => boolean;
  hidesRoad: (x: number, z: number, r: number, h: number) => boolean;
  /** A free spot for something of radius r and height h, between minGap and maxGap beyond the barriers. */
  pick: (r: number, h: number, minGap: number, maxGap: number) => [number, number] | null;
  /** Add an object at (x, z), turned `rot`, and keep its circle clear. */
  place: (obj: THREE.Object3D, x: number, z: number, r: number, rot?: number) => void;
  /** A person standing at (x, y, z) facing `rot`; spectators (not `still`) jump up and cheer now and then. */
  person: (x: number, y: number, z: number, rot: number, shirt?: string, still?: boolean) => void;
  /** Someone strolling back and forth from (x, z) along `rot` for `len` metres. */
  walker: (x: number, z: number, rot: number, len: number, shirt?: string) => void;
  /** A flag on a pole, the pole's foot at (x, y, z). */
  flag: (x: number, y: number, z: number, height: number, color: string, size?: number) => void;
  shirts: readonly string[];
}

/** Context for building life round `track`; call `finish` at the end to draw the figures. */
export function lifeContext(track: Track, keepOut: readonly KeepOut[], shirts: readonly string[] = SHIRTS): { ctx: LifeCtx; finish: () => void } {
  const group = new THREE.Group();
  group.name = 'trackLife';
  const own: KeepOut[] = [];
  const rnd = makeRng((track.def.seed ?? 1) * 6029);
  const choose = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
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

  const people: Item[] = [];
  const heads: Item[] = [];
  const stills: Item[] = [];
  const stillHeads: Item[] = [];
  const walkers: Item[] = [];
  const walkerHeads: Item[] = [];
  const walks: number[] = [];
  const flags: Item[] = [];
  const poles: THREE.BufferGeometry[] = [];
  const person = (x: number, y: number, z: number, rot: number, shirt = choose(shirts), still = false) => {
    const s = 0.9 + rnd() * 0.2;
    (still ? stills : people).push({ m: at(x, y, z, rot, new THREE.Vector3(1, s, 1)), c: shirt });
    (still ? stillHeads : heads).push({ m: at(x, y + (s - 1) * 0.62, z, rot), c: choose(SKIN) });
  };
  const walker = (x: number, z: number, rot: number, len: number, shirt = choose(shirts)) => {
    walkers.push({ m: at(x, 0, z, rot), c: shirt });
    walkerHeads.push({ m: at(x, 0, z, rot), c: choose(SKIN) });
    // Along local +z, len metres, at a stroll (1-1.6 m/s), from a random point of the walk.
    walks.push(len, 1 + rnd() * 0.6, rnd() * 100, 0);
  };
  const flag = (x: number, y: number, z: number, height: number, color: string, size = 1) => {
    poles.push(new THREE.CylinderGeometry(0.04, 0.04, height, 4).translate(x, y + height / 2, z));
    flags.push({ m: at(x, y + height - 0.35 * size, z, rnd() * 0.6 - 0.3, size), c: color });
  };
  const body = () => box(-0.22, 0, -0.15, 0.22, 0.62, 0.15);
  const head = () => box(-0.13, 0.62, -0.13, 0.13, 0.88, 0.13);

  const finish = () => {
    // Figures are tiny: they cast no shadows (the terraces under them do).
    if (people.length) {
      // Now and then someone jumps up and cheers. The phase comes from the
      // instance index, so bodies and heads of a cell hop together.
      const cheer = 'transformed.y += max(0.0, sin(uTime * (4.0 + ph * 4.0) + ph * 30.0)) * 0.2 * step(0.55, ph);';
      for (const m of chunked(body(), animated(cheer), people, { reach: 0.3 })) group.add(m);
      for (const m of chunked(head(), animated(cheer), heads, { reach: 0.3 })) group.add(m);
    }
    if (stills.length) {
      for (const m of chunked(body(), toon('#ffffff'), stills)) group.add(m);
      for (const m of chunked(head(), toon('#ffffff'), stillHeads)) group.add(m);
    }
    if (walkers.length) {
      // Back and forth along their walk, bobbing a little with each step.
      const walk = `{
        float d = mod(uTime * aWalk.y + aWalk.z, aWalk.x * 2.0);
        transformed.z += d < aWalk.x ? d : aWalk.x * 2.0 - d;
        transformed.y += abs(sin(uTime * aWalk.y * 5.0 + aWalk.z)) * 0.06;
      }`;
      const mat = animated(walk, {}, 'attribute vec4 aWalk;');
      for (const m of chunked(body(), mat, walkers, { attr: { name: 'aWalk', data: walks }, reach: 17 })) group.add(m);
      for (const m of chunked(head(), mat, walkerHeads, { attr: { name: 'aWalk', data: walks }, reach: 17 })) group.add(m);
    }
    if (flags.length) {
      const flagGeo = new THREE.PlaneGeometry(1, 0.6, 5, 1).translate(0.5, 0, 0);
      for (const m of chunked(flagGeo, animated('transformed.z += sin(uTime * 7.0 + position.x * 3.5 + ph * 20.0) * 0.16 * position.x;', { side: THREE.DoubleSide }), flags, { reach: 1 })) group.add(m);
    }
    if (poles.length) group.add(solid('#dddddd', poles, false));
  };

  const ctx: LifeCtx = {
    track, group, rnd, choose, moving: [], animators: [], own,
    wallAt: (i) => track.hw[i] + track.def.runoff,
    free, hidesRoad, pick, place, person, walker, flag, shirts,
  };
  return { ctx, finish };
}
