// Seeded scenery outside the barriers: trees, bushes, rocks and farmhouses,
// drawn with instancing so hundreds of props cost a handful of draw calls.

import * as THREE from 'three';
import { distanceToCentreline } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { makeRng } from '../../shared/math/rng.ts';
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
  const treeCount = Math.min(1400, Math.round((area / 260) * theme.treeDensity));
  let crownGeo: THREE.BufferGeometry = new THREE.ConeGeometry(1.6, 4.2, 7).toNonIndexed();
  crownGeo.translate(0, 3.6, 0);
  crownGeo.computeVertexNormals();
  let roundGeo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1.9, 0);
  roundGeo.translate(0, 3.4, 0);
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
    // Tall firs; the "round" variant is the same fir with a snow cap.
    crownGeo = new THREE.ConeGeometry(1.5, 5, 7).toNonIndexed().translate(0, 4, 0);
    crownGeo.computeVertexNormals();
    roundGeo = new THREE.ConeGeometry(0.95, 2.2, 7).toNonIndexed().translate(0, 5.4, 0);
    roundGeo.computeVertexNormals();
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.8, 5);
  trunkGeo.translate(0, 0.9, 0);
  const crowns = new THREE.InstancedMesh(crownGeo, toon('#ffffff'), treeCount);
  const rounds = new THREE.InstancedMesh(roundGeo, toon('#ffffff'), treeCount);
  const trunks = new THREE.InstancedMesh(trunkGeo, toon('#6b4a2e'), treeCount * 2);
  let nc = 0, nr = 0, nt = 0;
  const greens = theme.treeColors;
  const capped = theme.trees === 'snowpine';
  const trunkless = theme.trees === 'cactus';
  for (let i = 0; i < treeCount; i++) {
    const p = pick(clear, 1e9);
    if (!p) continue;
    // Cluster: skip some trees close to the road for a more natural edge.
    const s = 0.75 + rnd() * 0.6;
    dummy.position.set(p[0], 0, p[1]);
    dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.85 + rnd() * 0.4), s);
    dummy.updateMatrix();
    color.set(greens[Math.floor(rnd() * greens.length)]);
    if (capped) {
      // Every fir gets a snow cap.
      crowns.setMatrixAt(nc, dummy.matrix);
      crowns.setColorAt(nc++, color);
      rounds.setMatrixAt(nr, dummy.matrix);
      rounds.setColorAt(nr++, color.set('#f2f6fa'));
    } else if (rnd() < 0.7) {
      crowns.setMatrixAt(nc, dummy.matrix);
      crowns.setColorAt(nc++, color);
    } else {
      rounds.setMatrixAt(nr, dummy.matrix);
      rounds.setColorAt(nr++, color.multiplyScalar(1.1));
    }
    if (!trunkless) trunks.setMatrixAt(nt++, dummy.matrix);
  }
  for (const [mesh, count] of [[crowns, nc], [rounds, nr], [trunks, nt]] as const) {
    mesh.count = count;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  // Bushes hugging the outside of the barriers.
  const bushGeo = new THREE.IcosahedronGeometry(0.9, 0);
  bushGeo.scale(1, 0.6, 1);
  bushGeo.translate(0, 0.45, 0);
  const bushCount = Math.round(track.length / 9);
  const bushes = new THREE.InstancedMesh(bushGeo, toon('#ffffff'), bushCount);
  let nb = 0;
  for (let i = 0; i < bushCount; i++) {
    const p = pick(clear - 1.5, clear + 7, 60);
    if (!p) continue;
    const s = 0.7 + rnd() * 0.9;
    dummy.position.set(p[0], 0, p[1]);
    dummy.rotation.set(0, rnd() * 6.28, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    bushes.setMatrixAt(nb, dummy.matrix);
    bushes.setColorAt(nb++, color.set(theme.bushColors[Math.floor(rnd() * theme.bushColors.length)]).multiplyScalar(0.9));
  }
  bushes.count = nb;
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  group.add(bushes);

  // Rocks.
  const rockGeo = new THREE.DodecahedronGeometry(0.8, 0);
  rockGeo.translate(0, 0.3, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, toon('#ffffff'), theme.rockCount);
  let nk = 0;
  for (let i = 0; i < theme.rockCount; i++) {
    const p = pick(clear + 2, 1e9);
    if (!p) continue;
    const s = 0.4 + rnd() * 1.1;
    dummy.position.set(p[0], 0, p[1]);
    dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    dummy.scale.set(s, s * 0.7, s);
    dummy.updateMatrix();
    rocks.setMatrixAt(nk, dummy.matrix);
    rocks.setColorAt(nk++, color.set(theme.rockColors[Math.floor(rnd() * theme.rockColors.length)]));
  }
  rocks.count = nk;
  rocks.castShadow = true;
  group.add(rocks);

  // A few farmhouses with pitched roofs, well away from the road.
  const houseGeo = new THREE.BoxGeometry(8, 3.6, 6);
  houseGeo.translate(0, 1.8, 0);
  const roofGeo = new THREE.CylinderGeometry(0.01, 4.6, 2.6, 4, 1).toNonIndexed();
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.scale(1.25, 1, 0.95);
  roofGeo.translate(0, 4.9, 0);
  roofGeo.computeVertexNormals();
  const walls = theme.houseWalls;
  const roofs = theme.houseRoofs;
  const houseRnd = makeRng((track.def.seed ?? 1) * 104729);
  for (let i = 0; i < (theme.houses === false ? 0 : 9); i++) {
    const p = pick(clear + 22, clear + 90, 80);
    if (!p) continue;
    const h = new THREE.Group();
    const body = new THREE.Mesh(houseGeo, toon(walls[Math.floor(houseRnd() * walls.length)]));
    const roof = new THREE.Mesh(roofGeo, toon(roofs[Math.floor(houseRnd() * roofs.length)]));
    for (const m of [body, roof]) {
      m.castShadow = true;
      m.receiveShadow = true;
      h.add(m);
    }
    h.position.set(p[0], 0, p[1]);
    h.rotation.y = Math.floor(houseRnd() * 4) * (Math.PI / 2) + (houseRnd() - 0.5) * 0.3;
    group.add(h);
  }
  return group;
}
