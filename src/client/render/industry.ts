// The nuclear power plant around Meltdown Ridge: cooling towers (with steam),
// reactor domes, turbine halls, striped chimneys, pipe runs along the track
// and yellow drums by the barriers. Placed with a seeded RNG away from the
// road, tall things further out so they don't hide the cars.

import * as THREE from 'three';
import { Surface } from '../../shared/config/surfaces.ts';
import { distanceToCentreline } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { makeRng } from '../../shared/math/rng.ts';
import { toon } from './materials.ts';
import type { KeepOut } from './props.ts';

export interface SteamSource {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface Industry {
  group: THREE.Group;
  keepOut: KeepOut[];
  steam: SteamSource[];
}

/** Hyperboloid cooling tower profile (radius, height) for a lathe. */
function towerGeometry(r: number, h: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    const waist = 0.62 + 0.38 * Math.pow(Math.abs(t - 0.68) / 0.68, 1.6);
    pts.push(new THREE.Vector2(r * waist, h * t));
  }
  const g = new THREE.LatheGeometry(pts, 20);
  g.computeVertexNormals();
  return g;
}

export function buildIndustry(track: Track, existing: readonly KeepOut[]): Industry {
  const group = new THREE.Group();
  group.name = 'industry';
  const keepOut: KeepOut[] = [];
  const steam: SteamSource[] = [];
  const rnd = makeRng((track.def.seed ?? 1) * 7717);
  const clear = track.def.width / 2 + track.def.runoff + 2;
  const b = track.bounds;
  const pad = 70;
  const free = (x: number, z: number, r: number) =>
    ![...existing, ...keepOut].some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < (k.r + r) ** 2);
  // The camera looks north, tilted 57°: something h metres tall hides the
  // ground up to 0.65·h north of it. Keep the road out of that shadow.
  const hidesRoad = (x: number, z: number, r: number, h: number) => {
    for (let dz = r; dz >= -r - h * 0.65; dz -= 2) {
      for (const dx of [-r, 0, r]) if (distanceToCentreline(track, x + dx, z + dz) < clear) return true;
    }
    return false;
  };
  const pick = (r: number, minGap: number, maxGap: number, h = 0, tries = 400): [number, number] | null => {
    for (let t = 0; t < tries; t++) {
      const x = b.minX - pad + rnd() * (b.maxX - b.minX + pad * 2);
      const z = b.minZ - pad + rnd() * (b.maxZ - b.minZ + pad * 2);
      const d = distanceToCentreline(track, x, z);
      if (d < clear + r + minGap || d > clear + r + maxGap) continue;
      if (!free(x, z, r) || hidesRoad(x, z, r, h)) continue;
      return [x, z];
    }
    return null;
  };
  const place = (obj: THREE.Object3D, x: number, z: number, r: number) => {
    obj.position.set(x, 0, z);
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(obj);
    keepOut.push({ x, z, r });
  };

  const concrete = toon('#b4b2aa');
  const supportColor = toon('#55585e');
  const concreteDark = toon('#8c8b85');
  const towerMat = toon('#c9c6bd', { side: THREE.DoubleSide });

  // Cooling towers, well away from the road (they are tall).
  const towerGeo = towerGeometry(17, 46);
  for (let k = 0; k < 5; k++) {
    const p = pick(19, 6, 90, 46);
    if (!p) continue;
    const t = new THREE.Mesh(towerGeo, towerMat);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(17.5, 17.5, 1.2, 20, 1, true), concreteDark);
    ring.position.y = 0.6;
    const g = new THREE.Group();
    g.add(t, ring);
    place(g, p[0], p[1], 19);
    steam.push({ x: p[0], y: 46, z: p[1], r: 9 });
  }

  // Reactor buildings: a cylinder with a dome.
  for (let k = 0; k < 3; k++) {
    const p = pick(13, 3, 50, 24);
    if (!p) continue;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 12, 24), concrete);
    body.position.y = 6;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(12, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#d8d6ce'));
    dome.position.y = 12;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(12.1, 12.1, 1, 24, 1, true), toon('#e8322a'));
    band.position.y = 10.5;
    g.add(body, dome, band);
    place(g, p[0], p[1], 13);
  }

  // Along the whole track: halls, tanks and transformer yards right behind
  // the barriers, lined up with the road, so it feels like driving through
  // the plant.
  const hallMat = toon('#9fa6a8');
  const tankMat = toon('#d8d6ce');
  const yardMat = toon('#6d7176');
  const stripeMats = ['#2f6fe0', '#e8322a', '#f2c230'].map((c) => toon(c));
  const step = 26;
  for (let i = 0; i < track.n; i += step) {
    for (const side of [-1, 1]) {
      if (rnd() > 0.8) continue;
      const kind = rnd();
      const r = kind < 0.4 ? 10 : kind < 0.7 ? 6 : 5;
      const h = kind < 0.4 ? 11 : kind < 0.7 ? 9 : 4;
      const gap = 1.5 + rnd() * 6;
      const off = (track.hw[i] + track.def.runoff + 1 + gap + r) * side;
      const x = track.px[i] + track.nx[i] * off;
      const z = track.pz[i] + track.nz[i] * off;
      if (distanceToCentreline(track, x, z) < clear + r - 0.5 || !free(x, z, r) || hidesRoad(x, z, r, h)) continue;
      const g = new THREE.Group();
      if (kind < 0.4) {
        // A hall, long side along the road.
        const hall = new THREE.Mesh(new THREE.BoxGeometry(2 * r * 1.6, h, r * 1.1), hallMat);
        hall.position.y = h / 2;
        const band = new THREE.Mesh(new THREE.BoxGeometry(2 * r * 1.6 + 0.2, 1, r * 1.1 + 0.2), stripeMats[Math.floor(rnd() * 3)]);
        band.position.y = h * 0.75;
        g.add(hall, band);
        for (let v = -2; v <= 2; v++) {
          const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 8), concreteDark);
          vent.position.set(v * r * 0.55, h + 0.6, 0);
          g.add(vent);
        }
        g.rotation.y = Math.atan2(-track.tz[i], track.tx[i]);
      } else if (kind < 0.7) {
        // Storage tanks in a row.
        for (const dx of [-r * 0.9, r * 0.9]) {
          const tank = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r * 0.75, h, 16), tankMat);
          tank.position.set(dx, h / 2, 0);
          const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.76, 0.8, 16), concreteDark);
          lid.position.set(dx, h + 0.4, 0);
          g.add(tank, lid);
        }
        g.rotation.y = Math.atan2(-track.tz[i], track.tx[i]);
      } else {
        // Transformer yard: a fenced pad with boxes and pylons.
        const pad = new THREE.Mesh(new THREE.BoxGeometry(r * 2, 0.3, r * 1.6), concreteDark);
        pad.position.y = 0.15;
        g.add(pad);
        for (let t = 0; t < 4; t++) {
          const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 1.2), yardMat);
          box.position.set(-r * 0.6 + t * r * 0.4, 1.4, (t % 2 ? 1 : -1) * r * 0.3);
          g.add(box);
        }
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.4), supportColor);
        pylon.position.set(r * 0.8, h / 2, 0);
        g.add(pylon);
      }
      place(g, x, z, r);
    }
  }

  // Turbine halls: long boxes with a stripe and roof vents.
  for (let k = 0; k < 3; k++) {
    const p = pick(16, 6, 50, 12);
    if (!p) continue;
    const g = new THREE.Group();
    const hall = new THREE.Mesh(new THREE.BoxGeometry(30, 11, 14), toon('#9fa6a8'));
    hall.position.y = 5.5;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(30.2, 1.2, 14.2), toon('#2f6fe0'));
    stripe.position.y = 8.4;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 14), concreteDark);
    roof.position.y = 11.3;
    g.add(hall, stripe, roof);
    for (let v = -2; v <= 2; v++) {
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 8), concreteDark);
      vent.position.set(v * 5.5, 12.4, 0);
      g.add(vent);
    }
    g.rotation.y = Math.floor(rnd() * 4) * (Math.PI / 2);
    place(g, p[0], p[1], 16);
  }

  // Red and white chimneys.
  for (let k = 0; k < 3; k++) {
    const p = pick(3, 8, 70, 40);
    if (!p) continue;
    const g = new THREE.Group();
    for (let s = 0; s < 8; s++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(1.5 - s * 0.05, 1.55 - s * 0.05, 5, 10), toon(s % 2 === 0 ? '#d42a24' : '#eeeeea'));
      seg.position.y = 2.5 + s * 5;
      g.add(seg);
    }
    place(g, p[0], p[1], 3);
    steam.push({ x: p[0], y: 40, z: p[1], r: 1.2 });
  }

  // Pipe runs on supports alongside the track, outside the barriers.
  const pipeMat = toon('#5d8a6a');
  const supportMat = toon('#55585e');
  const runs = 6;
  for (let k = 0; k < runs; k++) {
    const i0 = Math.floor(rnd() * track.n);
    const len = 30 + Math.floor(rnd() * 40);
    const side = rnd() < 0.5 ? -1 : 1;
    const off = (track.hw[i0] + track.def.runoff + 3.5) * side;
    const pts: THREE.Vector3[] = [];
    let ok = true;
    for (let j = 0; j <= len; j += 3) {
      const i = (i0 + j) % track.n;
      if (Math.abs(track.curv[i]) > 0.01) ok = false;
      pts.push(new THREE.Vector3(track.px[i] + track.nx[i] * off, 2.2, track.pz[i] + track.nz[i] * off));
    }
    if (!ok || pts.length < 4 || pts.some((q) => !free(q.x, q.z, 2))) continue;
    const curve = new THREE.CatmullRomCurve3(pts);
    for (const dy of [0, 1.1]) {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 2, 0.45, 6), pipeMat);
      tube.position.y = dy;
      tube.castShadow = true;
      group.add(tube);
    }
    for (let j = 0; j < pts.length; j += 2) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.6, 0.4), supportMat);
      s.position.set(pts[j].x, 1.8, pts[j].z);
      s.castShadow = true;
      group.add(s);
    }
  }

  // Yellow drums in little clusters by the barriers.
  const drumGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10).translate(0, 0.55, 0);
  const drums = new THREE.InstancedMesh(drumGeo, toon('#ffffff'), 160);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let nd = 0;
  for (let c = 0; c < 30 && nd < 150; c++) {
    const p = pick(2, 0.5, 8, 1, 60);
    if (!p) continue;
    const count = 2 + Math.floor(rnd() * 4);
    for (let d = 0; d < count; d++) {
      dummy.position.set(p[0] + (rnd() - 0.5) * 2.4, 0, p[1] + (rnd() - 0.5) * 2.4);
      dummy.rotation.set(0, rnd() * 6, rnd() < 0.15 ? Math.PI / 2 : 0);
      dummy.updateMatrix();
      drums.setMatrixAt(nd, dummy.matrix);
      drums.setColorAt(nd++, color.set(rnd() < 0.8 ? '#f2c230' : '#3f8f3a'));
    }
  }
  drums.count = nd;
  drums.castShadow = true;
  group.add(drums);
  // Water channels (rectangular water patches) carry on beyond the walls.
  const waterMat = toon('#3f80aa');
  for (const p of track.def.patches ?? []) {
    if (p.hx === undefined || p.hz === undefined || (p.surface !== Surface.ShallowWater && p.surface !== Surface.DeepWater)) continue;
    const len = 160;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(p.hx * 2, len).rotateX(-Math.PI / 2), waterMat);
    water.position.set(p.x, -0.035, p.z);
    water.receiveShadow = true;
    group.add(water);
    for (const sx of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, len), concrete);
      edge.position.set(p.x + sx * (p.hx + 0.4), 0.2, p.z);
      edge.receiveShadow = true;
      group.add(edge);
    }
  }
  return { group, keepOut, steam };
}
