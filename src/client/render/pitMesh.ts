// The pit lane: its tarmac and markings, the concrete island between it and
// the road, and a row of garages behind its outer wall. Geometry comes from
// the shared pit layout (pit.ts), so it lines up with the physics.

import * as THREE from 'three';
import { laneOffset, PIT, type Pit } from '../../shared/track/pit.ts';
import type { Track } from '../../shared/track/types.ts';
import { toon } from './materials.ts';

/** World position of a point in the straight's coordinates, at height y. */
function at(p: Pit, u: number, lat: number, y: number): [number, number, number] {
  return [p.ox + p.tx * u + p.nx * lat * p.side, y, p.oz + p.tz * u + p.nz * lat * p.side];
}

/** Coloured triangles built quad by quad (corners in order around the quad). */
class Quads {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  add(a: number[], b: number[], c: number[], d: number[], color: THREE.Color): void {
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) this.col.push(color.r, color.g, color.b);
  }
  mesh(name: string, shadows: boolean): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    m.castShadow = shadows;
    m.name = name;
    return m;
  }
}

/** A flat strip along the lane between two lateral offsets (relative to the lane centre or absolute). */
function strip(q: Quads, p: Pit, u0: number, u1: number, lat0: (u: number) => number, lat1: (u: number) => number, y: number, c: THREE.Color): void {
  const step = 1;
  for (let u = u0; u < u1 - 1e-6; u += step) {
    const v = Math.min(u1, u + step);
    q.add(at(p, u, lat0(u), y), at(p, v, lat0(v), y), at(p, v, lat1(v), y), at(p, u, lat1(u), y), c);
  }
}

function textTexture(text: string, bg: string, fg: string, w = 128, h = 32): THREE.CanvasTexture {
  const cvs = document.createElement('canvas');
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `bold ${Math.round(h * 0.75)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(cvs);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildPitView(track: Track, asphaltColor: string): THREE.Group | null {
  const p = track.pit;
  if (!p) return null;
  const g = new THREE.Group();
  g.name = 'pit';
  const H = PIT.laneHalf;
  const lane = (d: number) => (u: number) => laneOffset(p, u) + d;
  const flat = (lat: number) => () => lat;

  // --- Tarmac and markings.
  const ground = new Quads();
  const asphalt = new THREE.Color(asphaltColor);
  const white = new THREE.Color('#e6e6e0');
  const yellow = new THREE.Color('#f2c230');
  strip(ground, p, p.a, p.b, lane(-H), lane(H), 0.006, asphalt);
  strip(ground, p, p.a + 4, p.b - 4, lane(H - 0.55), lane(H - 0.3), 0.012, white);
  // The pit box: yellow edge toward the island and a bay for each car.
  strip(ground, p, p.box0, p.box1, flat(p.barrier + PIT.island + 0.3), flat(p.barrier + PIT.island + 0.55), 0.012, yellow);
  for (let u = p.box0 + 4; u + 5 <= p.box1 - 2; u += 9) {
    for (const [u0, u1] of [[u, u + 0.25], [u + 5, u + 5.25]]) {
      strip(ground, p, u0, u1, flat(p.pitOff - 2.2), flat(p.pitOff + H - 0.6), 0.012, yellow);
    }
  }
  g.add(ground.mesh('pitLane', false));

  // --- The island: a concrete block with a striped top, like the barriers.
  const island = new Quads();
  const concrete = new THREE.Color('#9a9a98');
  const dark = new THREE.Color('#6e6e6c');
  const red = new THREE.Color('#c8261f');
  const ih = 0.9;
  const i0 = p.barrier;
  const i1 = p.barrier + PIT.island;
  island.add(at(p, p.box0, i0, 0), at(p, p.box1, i0, 0), at(p, p.box1, i0, ih), at(p, p.box0, i0, ih), concrete);
  island.add(at(p, p.box0, i1, 0), at(p, p.box1, i1, 0), at(p, p.box1, i1, ih), at(p, p.box0, i1, ih), dark);
  island.add(at(p, p.box0, i0, 0), at(p, p.box0, i1, 0), at(p, p.box0, i1, ih), at(p, p.box0, i0, ih), concrete);
  island.add(at(p, p.box1, i0, 0), at(p, p.box1, i1, 0), at(p, p.box1, i1, ih), at(p, p.box1, i0, ih), concrete);
  for (let u = p.box0, k = 0; u < p.box1 - 1e-6; u += 3, k++) {
    const v = Math.min(p.box1, u + 3);
    island.add(at(p, u, i0, ih), at(p, v, i0, ih), at(p, v, i1, ih), at(p, u, i1, ih), k % 2 === 0 ? red : white);
  }
  g.add(island.mesh('pitIsland', true));

  // --- Garages behind the outer wall. On the camera's side of the lane they
  // stay low so they don't hide it.
  const nearCamera = p.nz * p.side > 0.3;
  const gh = nearCamera ? 1.6 : 4.2;
  const g0 = p.pitOff + H + 1.6;
  const g1 = p.pitOff + H + PIT.garage - 1;
  const garage = new Quads();
  const wallC = new THREE.Color('#d8d4cc');
  const roofC = new THREE.Color('#5d6470');
  const doorC = new THREE.Color('#2a2c33');
  const stripe = new THREE.Color('#c8261f');
  garage.add(at(p, p.box0, g0, 0), at(p, p.box1, g0, 0), at(p, p.box1, g0, gh), at(p, p.box0, g0, gh), wallC);
  garage.add(at(p, p.box0, g1, 0), at(p, p.box1, g1, 0), at(p, p.box1, g1, gh), at(p, p.box0, g1, gh), wallC);
  garage.add(at(p, p.box0, g0, 0), at(p, p.box0, g1, 0), at(p, p.box0, g1, gh), at(p, p.box0, g0, gh), wallC);
  garage.add(at(p, p.box1, g0, 0), at(p, p.box1, g1, 0), at(p, p.box1, g1, gh), at(p, p.box1, g0, gh), wallC);
  garage.add(at(p, p.box0, g0, gh), at(p, p.box1, g0, gh), at(p, p.box1, g1, gh), at(p, p.box0, g1, gh), roofC);
  // A red band along the roof edge and a door for each bay, facing the lane.
  const front = g0 - 0.02;
  garage.add(at(p, p.box0, front, gh - 0.4), at(p, p.box1, front, gh - 0.4), at(p, p.box1, front, gh), at(p, p.box0, front, gh), stripe);
  for (let u = p.box0 + 4; u + 5 <= p.box1 - 2; u += 9) {
    garage.add(at(p, u + 0.4, front, 0), at(p, u + 4.6, front, 0), at(p, u + 4.6, front, gh * 0.72), at(p, u + 0.4, front, gh * 0.72), doorC);
  }
  g.add(garage.mesh('pitGarage', true));

  // --- "PIT" on the garage roof and on the lane at the way in.
  const roofSign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(24, p.box1 - p.box0 - 4), g1 - g0 - 2), toon('#ffffff', { map: textTexture('PIT', '#c8261f', '#ffffff') }));
  const mid = at(p, (p.box0 + p.box1) / 2, (g0 + g1) / 2, gh + 0.03);
  roofSign.position.set(mid[0], mid[1], mid[2]);
  roofSign.rotation.set(-Math.PI / 2, 0, 0);
  // Text along the lane, readable from the north-facing camera.
  roofSign.rotation.z = -Math.atan2(p.tz, p.tx) + (p.tx < 0 ? Math.PI : 0);
  g.add(roofSign);
  const entry = p.a + p.ramp + 1;
  const laneSign = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), toon('#ffffff', { map: textTexture('PIT', '#3c3d44', '#f2c230', 64, 24), transparent: false }));
  const ls = at(p, entry, p.pitOff, 0.014);
  laneSign.position.set(ls[0], ls[1], ls[2]);
  laneSign.rotation.set(-Math.PI / 2, 0, 0);
  laneSign.rotation.z = roofSign.rotation.z;
  g.add(laneSign);
  return g;
}
