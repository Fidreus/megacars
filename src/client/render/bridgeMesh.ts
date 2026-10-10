// Bridges: stone retaining walls under the raised road, a concrete deck where
// the road below passes underneath, abutments at the ends of the span and,
// for a broken bridge, sheer edges with hazard stripes and warning chevrons
// on the run-up. The raised road surface and its barriers come from the
// track mesh itself.

import * as THREE from 'three';
import { DECK_THICK } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { vertexToon } from './materials.ts';

const STONE = [new THREE.Color('#8f897a'), new THREE.Color('#7d7769'), new THREE.Color('#999282')];
const MORTAR = new THREE.Color('#6a655a');
const SLAB = new THREE.Color('#b9b6ac');
const SLAB_DARK = new THREE.Color('#8e8b83');
const UNDER = new THREE.Color('#55534e');
const YELLOW = new THREE.Color('#f2c230');
const BLACK = new THREE.Color('#1c1c20');

/** Barrier thickness (matches the track's walls). */
const T = 0.7;
/** How far before a broken bridge's edge the warning chevrons start. */
const WARN = 14;

export function buildBridges(track: Track): THREE.Group | null {
  if (track.bridges.length === 0) return null;
  const { n, px, pz, nx, nz, hw, s, deck, elev } = track;
  const runoff = track.def.runoff;
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (a: number[], b: number[], c: number[], color: THREE.Color) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) col.push(color.r, color.g, color.b);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) => {
    tri(a, b, c, color);
    tri(a, c, d, color);
  };
  const P = (i: number, off: number, y: number) => [px[i] + nx[i] * off, y, pz[i] + nz[i] * off];
  /** An upright post at sample i, `off` across the road, from y up, in hazard bands. */
  const post = (i: number, off: number, y: number) => {
    const r = 0.35;
    const ax = track.tx[i] * r, az = track.tz[i] * r;
    const bx = nx[i] * r, bz = nz[i] * r;
    const cx = px[i] + nx[i] * off, cz = pz[i] + nz[i] * off;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + ax * u + bx * v, cz + az * u + bz * v]);
    for (let band = 0; band < 4; band++) {
      const y0 = y + band * 0.4;
      const y1 = y0 + 0.4;
      const c = band % 2 === 0 ? BLACK : YELLOW;
      for (let e = 0; e < 4; e++) {
        const [x0, z0] = corners[e];
        const [x1, z1] = corners[(e + 1) % 4];
        quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], c);
      }
    }
    const top = y + 1.6;
    quad([corners[0][0], top, corners[0][1]], [corners[1][0], top, corners[1][1]], [corners[2][0], top, corners[2][1]], [corners[3][0], top, corners[3][1]], YELLOW);
  };
  // Shade on the ground under a deck (shadows are off on low graphics).
  const shade: number[] = [];
  const outer = (i: number) => hw[i] + runoff + T;
  const raised = (d: number) => d === 1 || d === 2;

  /** A face straight across the road at sample i, from y0 to y1. */
  const across = (i: number, y0: number, y1: number, color: THREE.Color) => {
    const w = outer(i);
    quad(P(i, -w, y0), P(i, w, y0), P(i, w, y1), P(i, -w, y1), color);
  };

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const di = deck[i];
    const dj = deck[j];
    if (raised(di) && raised(dj)) {
      const ei = elev[i];
      const ej = elev[j];
      for (const sgn of [-1, 1]) {
        const wi = outer(i) * sgn;
        const wj = outer(j) * sgn;
        if (di === 2 && dj === 2) {
          // The deck's edge: a concrete slab with a darker lower lip.
          const mid = 0.45;
          quad(P(i, wi, ei - mid), P(j, wj, ej - mid), P(j, wj, ej), P(i, wi, ei), SLAB);
          quad(P(i, wi, ei - DECK_THICK), P(j, wj, ej - DECK_THICK), P(j, wj, ej - mid), P(i, wi, ei - mid), SLAB_DARK);
        } else {
          // Stone retaining wall in 1 m courses, blocks staggered like brickwork.
          const top = Math.max(ei, ej);
          for (let r = 0; r < top; r++) {
            const yi0 = Math.min(r, ei);
            const yi1 = Math.min(r + 1, ei);
            const yj0 = Math.min(r, ej);
            const yj1 = Math.min(r + 1, ej);
            if (yi1 - yi0 <= 0.001 && yj1 - yj0 <= 0.001) continue;
            const block = Math.floor((s[i] + (r % 2) * 1.3) / 2.6);
            const joint = (s[i] + (r % 2) * 1.3) % 2.6 < 0.99;
            const c = joint && block % 3 === 0 ? MORTAR : STONE[(block + r * 7) % STONE.length];
            quad(P(i, wi, yi0), P(j, wj, yj0), P(j, wj, yj1), P(i, wi, yi1), c);
          }
        }
      }
      if (di === 2 && dj === 2) {
        const wi = outer(i);
        const wj = outer(j);
        quad(P(i, -wi, ei - DECK_THICK), P(j, -wj, ej - DECK_THICK), P(j, wj, ej - DECK_THICK), P(i, wi, ei - DECK_THICK), UNDER);
        shade.push(...P(i, -wi, 0.03), ...P(j, -wj, 0.03), ...P(j, wj, 0.03), ...P(i, -wi, 0.03), ...P(j, wj, 0.03), ...P(i, wi, 0.03));
      }
    }
    // Abutments where the span starts and ends.
    if ((di === 1 && dj === 2) || (di === 2 && dj === 1)) {
      const k = di === 1 ? i : j;
      across(k, 0, elev[k] - DECK_THICK, STONE[1]);
      across(k, elev[k] - DECK_THICK, elev[k] - DECK_THICK + 0.25, SLAB_DARK);
    }
    // The edges of a broken bridge: a sheer drop with a striped band on top.
    if ((di === 1 && dj === 3) || (di === 3 && dj === 1)) {
      const k = di === 1 ? i : j;
      const e = elev[k];
      across(k, 0, e - 0.7, STONE[0]);
      const w = outer(k);
      const cols = 10;
      for (let c = 0; c < cols; c++) {
        const a = -w + (2 * w * c) / cols;
        const b = -w + (2 * w * (c + 1)) / cols;
        quad(P(k, a, e - 0.7), P(k, b, e - 0.7), P(k, b, e + 0.02), P(k, a, e + 0.02), c % 2 === 0 ? YELLOW : BLACK);
      }
      // Hazard posts on both corners of the edge, on the barriers.
      const pw = hw[k] + runoff + T / 2;
      post(k, -pw, e);
      post(k, pw, e);
    }
  }

  // Warning chevrons on the road before a broken bridge's edge.
  for (const b of track.bridges) {
    if (!b.gap) continue;
    const lip = b.s - b.span;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (deck[i] !== 1 || deck[j] !== 1 || s[i] < lip - WARN || s[j] > lip) continue;
      const cols = 8;
      for (let c = 0; c < cols; c++) {
        const at = (k: number, cc: number) => {
          const w = hw[k] + 0.2;
          return P(k, -w + (2 * w * cc) / cols, elev[k] + 0.03);
        };
        const stripe = Math.floor((s[i] - lip) * 0.9 + Math.abs(c - cols / 2 + 0.5) * 0.9) % 2 === 0;
        quad(at(i, c), at(j, c), at(j, c + 1), at(i, c + 1), stripe ? YELLOW : BLACK);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, vertexToon({ side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = 'bridges';
  group.add(mesh);
  if (shade.length) {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(shade, 3));
    const dark = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.3, depthWrite: false }));
    dark.renderOrder = 1;
    group.add(dark);
  }
  return group;
}
