// Seeded scenery outside the barriers: trees, bushes and rocks (buildings
// are in town.ts),
// drawn with instancing so hundreds of props cost a handful of draw calls.

import * as THREE from 'three';
import { distanceToCentreline } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { hash3, makeRng } from '../../shared/math/rng.ts';
import { toon } from './materials.ts';
import type { KeepOut } from './props.ts';
import { merge } from './carMesh.ts';
import { themeOf } from './theme.ts';

export function buildScenery(track: Track, keepOut: readonly KeepOut[] = []): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scenery';
  const theme = themeOf(track.def.theme);
  const rnd = makeRng((track.def.seed ?? 1) * 7919);
  const clear = track.def.width / 2 + track.def.runoff + 3.2;
  const b = track.bounds;
  const pad = 90;
  const pick = (minDist: number, maxDist: number, tries = 40): [number, number] | null => {
    for (let t = 0; t < tries; t++) {
      const x = b.minX - pad + rnd() * (b.maxX - b.minX + pad * 2);
      const z = b.minZ - pad + rnd() * (b.maxZ - b.minZ + pad * 2);
      const d = distanceToCentreline(track, x, z);
      if (d < minDist || d > maxDist) continue;
      if (keepOut.some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < k.r * k.r)) continue;
      return [x, z];
    }
    return null;
  };

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // Trees: cone crowns on short trunks, a few rounder deciduous ones.
  const area = (b.maxX - b.minX + pad * 2) * (b.maxZ - b.minZ + pad * 2);
  const woods = theme.woods ?? 0;
  // Woods pack the same trees closer, so a few more of them.
  const treeCount = Math.min(1400 + 1000 * woods, Math.round((area / 260) * theme.treeDensity * (1 + woods * 0.6)));
  const seed = track.def.seed ?? 1;
  /** How wooded a spot is, 0..1: slow value noise, so woods come in patches. */
  const woodland = (x: number, z: number) => {
    const u = x / 75, v = z / 75;
    const i = Math.floor(u), j = Math.floor(v);
    const fu = u - i, fv = v - j;
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    const h = (a: number, c: number) => hash3(a, c, seed);
    const n = (h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv;
    return Math.min(1, Math.max(0, (n - 0.5) / 0.14));
  };
  // Conifer: three stacked tiers. Leafy tree: three lumps. Both shaded darker
  // at the bottom and lighter on top (vertex colours times the instance colour).
  let crownGeo: THREE.BufferGeometry = shadeByHeight(merge([
    new THREE.ConeGeometry(1.8, 2.6, 6).translate(0, 2.6, 0),
    new THREE.ConeGeometry(1.4, 2.3, 6).translate(0, 3.8, 0),
    new THREE.ConeGeometry(0.95, 2, 6).translate(0, 4.9, 0),
  ]), 0.62, 1.12);
  let roundGeo: THREE.BufferGeometry = shadeByHeight(merge([
    new THREE.IcosahedronGeometry(1.7, 0).translate(0, 3.2, 0),
    new THREE.IcosahedronGeometry(1.25, 0).translate(0.9, 3.9, 0.3),
    new THREE.IcosahedronGeometry(1.15, 0).translate(-0.8, 4.1, -0.4),
  ]), 0.7, 1.15);
  if (theme.trees === 'cactus') {
    // Saguaros: a column with two raised arms (and a stubbier variant).
    crownGeo = merge([
      new THREE.CylinderGeometry(0.42, 0.48, 5, 7).translate(0, 2.5, 0),
      new THREE.CylinderGeometry(0.28, 0.28, 1.2, 6).rotateZ(Math.PI / 2).translate(-0.85, 2.2, 0),
      new THREE.CylinderGeometry(0.28, 0.28, 1.8, 6).translate(-1.4, 3, 0),
      new THREE.CylinderGeometry(0.26, 0.26, 1, 6).rotateZ(Math.PI / 2).translate(0.75, 2.8, 0),
      new THREE.CylinderGeometry(0.26, 0.26, 1.4, 6).translate(1.2, 3.4, 0),
    ]);
    roundGeo = merge([
      new THREE.CylinderGeometry(0.4, 0.45, 2.6, 7).translate(0, 1.3, 0),
      new THREE.SphereGeometry(0.4, 7, 4).translate(0, 2.6, 0),
    ]);
  } else if (theme.trees === 'snowpine') {
    // Tiered firs; the "round" mesh is the snow lying on each tier.
    crownGeo = shadeByHeight(merge([
      new THREE.ConeGeometry(1.7, 2.8, 6).translate(0, 2.6, 0),
      new THREE.ConeGeometry(1.3, 2.4, 6).translate(0, 4, 0),
      new THREE.ConeGeometry(0.9, 2.1, 6).translate(0, 5.2, 0),
    ]), 0.65, 1.1);
    roundGeo = merge([
      new THREE.ConeGeometry(1.25, 0.9, 6).translate(0, 3.55, 0),
      new THREE.ConeGeometry(0.95, 0.8, 6).translate(0, 4.85, 0),
      new THREE.ConeGeometry(0.62, 0.9, 6).translate(0, 5.95, 0),
    ]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.8, 5);
  trunkGeo.translate(0, 0.9, 0);
  const crowns = new Chunked(crownGeo, toon('#ffffff', { vertexColors: !!crownGeo.getAttribute('color') }));
  const rounds = new Chunked(roundGeo, toon('#ffffff', { vertexColors: !!roundGeo.getAttribute('color') }));
  const trunks = new Chunked(trunkGeo, toon('#6b4a2e'));
  const greens = theme.treeColors;
  const capped = theme.trees === 'snowpine';
  const trunkless = theme.trees === 'cactus';
  const leafy = theme.trees === 'leafy';
  // Where the trees stand. With woods most of them grow in copses - tight
  // round groups in the wooded patches - and the rest alone in the fields.
  const spots: { x: number; z: number; wood: number }[] = [];
  const open = (x: number, z: number) =>
    distanceToCentreline(track, x, z) >= clear && !keepOut.some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < k.r * k.r);
  for (let tries = 0; tries < 400 && spots.length < treeCount * woods * 0.8; tries++) {
    const c = pick(clear + 4, 1e9);
    if (!c || woodland(c[0], c[1]) < 0.3) continue;
    const r = 9 + rnd() * 16;
    const n = Math.round((r * r) / 5);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const d = r * Math.sqrt(rnd());
      const x = c[0] + Math.cos(a) * d;
      const z = c[1] + Math.sin(a) * d;
      if (open(x, z)) spots.push({ x, z, wood: 1 - d / r });
    }
  }
  while (spots.length < treeCount) {
    const p = pick(clear, 1e9);
    if (!p) break;
    spots.push({ x: p[0], z: p[1], wood: 0 });
  }
  for (const spot of spots.slice(0, treeCount)) {
    const p = [spot.x, spot.z];
    // Bigger trees in the heart of a wood.
    const s = (0.75 + rnd() * 0.6) * (1 + 0.3 * spot.wood);
    dummy.position.set(p[0], 0, p[1]);
    dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.85 + rnd() * 0.4), s);
    dummy.updateMatrix();
    color.set(greens[Math.floor(rnd() * greens.length)]);
    if (capped) {
      // Every fir gets a snow cap.
      crowns.add(dummy.matrix, color);
      rounds.add(dummy.matrix, color.set('#f2f6fa'));
    } else if (leafy || rnd() >= 0.7) {
      // Now and then a tree in blossom, out in the open.
      if (theme.blossom && spot.wood === 0 && rnd() < 0.2) color.set(theme.blossom[Math.floor(rnd() * theme.blossom.length)]);
      else color.multiplyScalar(1.1);
      rounds.add(dummy.matrix, color);
    } else {
      crowns.add(dummy.matrix, color);
    }
    if (!trunkless) trunks.add(dummy.matrix);
  }
  // add() with no meshes (a track without trees) logs an error.
  for (const c of [crowns, rounds, trunks]) for (const m of c.meshes(true)) group.add(m);

  // Bushes hugging the outside of the barriers.
  const bushGeo = new THREE.IcosahedronGeometry(0.9, 0);
  bushGeo.scale(1, 0.6, 1);
  bushGeo.translate(0, 0.45, 0);
  const bushCount = Math.round(track.length / 9);
  const bushes = new Chunked(bushGeo, toon('#ffffff'));
  for (let i = 0; i < bushCount; i++) {
    const p = pick(clear - 1.5, clear + 7, 60);
    if (!p) continue;
    const s = 0.7 + rnd() * 0.9;
    dummy.position.set(p[0], 0, p[1]);
    dummy.rotation.set(0, rnd() * 6.28, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    bushes.add(dummy.matrix, color.set(theme.bushColors[Math.floor(rnd() * theme.bushColors.length)]).multiplyScalar(0.9));
  }
  for (const m of bushes.meshes(true)) group.add(m);

  // Rocks.
  const rockGeo = new THREE.DodecahedronGeometry(0.8, 0);
  rockGeo.translate(0, 0.3, 0);
  const rocks = new Chunked(rockGeo, toon('#ffffff'));
  for (let i = 0; i < theme.rockCount; i++) {
    const p = pick(clear + 2, 1e9);
    if (!p) continue;
    const s = 0.4 + rnd() * 1.1;
    dummy.position.set(p[0], 0, p[1]);
    dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    dummy.scale.set(s, s * 0.7, s);
    dummy.updateMatrix();
    rocks.add(dummy.matrix, color.set(theme.rockColors[Math.floor(rnd() * theme.rockColors.length)]));
  }
  for (const m of rocks.meshes(true, false)) group.add(m);

  return group;
}

/**
 * Instances sorted into square cells with one InstancedMesh per cell, so the
 * camera (and the shadow pass) only draws the cells it can see instead of
 * every tree on the map.
 */
class Chunked {
  private readonly cells = new Map<string, { m: THREE.Matrix4; c: THREE.Color | null }[]>();
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.Material;
  private readonly size: number;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, size = 80) {
    this.geo = geo;
    this.mat = mat;
    this.size = size;
  }

  add(m: THREE.Matrix4, c?: THREE.Color): void {
    const key = `${Math.floor(m.elements[12] / this.size)},${Math.floor(m.elements[14] / this.size)}`;
    let list = this.cells.get(key);
    if (!list) this.cells.set(key, (list = []));
    list.push({ m: m.clone(), c: c ? c.clone() : null });
  }

  meshes(castShadow: boolean, receiveShadow = true): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const list of this.cells.values()) {
      const mesh = new THREE.InstancedMesh(this.geo, this.mat, list.length);
      list.forEach((it, k) => {
        mesh.setMatrixAt(k, it.m);
        if (it.c) mesh.setColorAt(k, it.c);
      });
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.computeBoundingSphere();
      out.push(mesh);
    }
    return out;
  }
}

/** Vertex colours from `lo` at the bottom to `hi` at the top (multiplies the instance colour). */
function shadeByHeight(geo: THREE.BufferGeometry, lo: number, hi: number): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!;
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / Math.max(0.001, max.y - min.y);
    const k = lo + (hi - lo) * t;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
