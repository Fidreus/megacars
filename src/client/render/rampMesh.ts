// Jump ramps: a wedge across the road in yellow/black hazard stripes with a
// dark lip face, built from the track's ramp list.

import * as THREE from 'three';
import { sampleIndexAt } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { vertexToon } from './materials.ts';

const YELLOW = new THREE.Color('#f2c230');
const BLACK = new THREE.Color('#1c1c20');
const CONCRETE = new THREE.Color('#8a8a86');

export function buildRamps(track: Track): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ramps';
  for (const r of track.ramps) {
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
    const i0 = sampleIndexAt(track, r.s0);
    const i1 = sampleIndexAt(track, r.s1);
    const len = r.s1 - r.s0;
    const cols = 8;
    // Points across the ramp at sample i: column c from left (-) to right (+).
    const at = (i: number, c: number, onTop: boolean): number[] => {
      const w = track.hw[i] + 0.4;
      const off = -w + (2 * w * c) / cols;
      const h = onTop ? Math.max(0, Math.min(r.height, ((track.s[i] - r.s0) / len) * r.height)) + 0.02 : 0.02;
      return [track.px[i] + track.nx[i] * off, h, track.pz[i] + track.nz[i] * off];
    };
    for (let i = i0; i < i1; i++) {
      for (let c = 0; c < cols; c++) {
        // Chevrons pointing along the direction of travel.
        const stripe = Math.floor((track.s[i] - r.s0) * 0.9 + Math.abs(c - cols / 2 + 0.5) * 0.9) % 2 === 0;
        quad(at(i, c, true), at(i + 1, c, true), at(i + 1, c + 1, true), at(i, c + 1, true), stripe ? YELLOW : BLACK);
      }
      // Side walls.
      quad(at(i, 0, false), at(i + 1, 0, false), at(i + 1, 0, true), at(i, 0, true), CONCRETE);
      quad(at(i, cols, true), at(i + 1, cols, true), at(i + 1, cols, false), at(i, cols, false), CONCRETE);
    }
    // The lip: a vertical face with hazard stripes.
    for (let c = 0; c < cols; c++) {
      quad(at(i1, c, false), at(i1, c, true), at(i1, c + 1, true), at(i1, c + 1, false), c % 2 === 0 ? YELLOW : BLACK);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, vertexToon({ side: THREE.DoubleSide }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
