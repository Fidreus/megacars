// Catch-up boost pads: three chevrons across the road at each pad. They stay
// dim, and light up and pulse while the player's car is far enough behind to
// use them (see shared/sim/catchUp.ts).

import * as THREE from 'three';
import { CATCH_UP } from '../../shared/sim/catchUp.ts';
import { pointAt, sampleIndexAt } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';

const DIM = new THREE.Color('#5a6a80');
const LIT = new THREE.Color('#40e0ff');
const LIT2 = new THREE.Color('#ffffff');

/** One material for every pad, so lighting them up is a colour change. */
const padMaterial = new THREE.MeshBasicMaterial({ color: DIM.clone(), transparent: true, opacity: 0.55, depthWrite: false });

/** Light the pads (the player may use them) or dim them; `time` drives the pulse. */
export function setBoostPadsLit(lit: boolean, time: number): void {
  if (lit) {
    const k = 0.5 + 0.5 * Math.sin(time * 10);
    padMaterial.color.copy(LIT).lerp(LIT2, k * 0.6);
    padMaterial.opacity = 0.95;
  } else {
    padMaterial.color.copy(DIM);
    padMaterial.opacity = 0.55;
  }
}

/** A chevron pointing along +z... built flat, pointing in the direction of travel. */
function chevron(w: number, len: number, thick: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(0, len);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2 - thick, 0);
  s.lineTo(0, len - thick * 1.4);
  s.lineTo(-w / 2 + thick, 0);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export function buildBoostPads(track: Track): THREE.Group {
  const g = new THREE.Group();
  g.name = 'boostPads';
  const p = { x: 0, z: 0, heading: 0 };
  for (const s0 of track.boosts) {
    const i = sampleIndexAt(track, s0);
    const w = track.hw[i] * 2 - 2;
    for (let k = 0; k < 3; k++) {
      pointAt(track, s0 + (k + 0.3) * (CATCH_UP.length / 3), p);
      const geo = chevron(w, 1.8, 0.7);
      // Lay it flat with its point toward the direction of travel.
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(-p.heading);
      geo.translate(p.x, track.elev[i] + 0.02, p.z);
      const m = new THREE.Mesh(geo, padMaterial);
      m.renderOrder = 1;
      g.add(m);
    }
  }
  return g;
}
