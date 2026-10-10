// Top-down debug overlay: barriers (red), racing line coloured by planned
// speed (red slow → green fast), checkpoints (yellow) and the centreline.

import * as THREE from 'three';
import type { CarTuning } from '../../shared/config/tuning.ts';
import { AI_PARAMS } from '../../shared/ai/driver.ts';
import { sampleIndexAt } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';

export function buildTrackDebugView(track: Track, t: CarTuning): THREE.Group {
  const g = new THREE.Group();
  g.name = 'trackDebug';
  const y = 0.2;
  const lineMat = (color: string | null) =>
    new THREE.LineBasicMaterial({ color: color ?? '#ffffff', vertexColors: color === null, depthTest: false, transparent: true });

  const w = track.walls;
  const wallPos = new Float32Array(w.count * 6);
  for (let i = 0; i < w.count; i++) {
    wallPos.set([w.ax[i], y, w.az[i], w.bx[i], y, w.bz[i]], i * 6);
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.BufferAttribute(wallPos, 3));
  g.add(new THREE.LineSegments(wallGeo, lineMat('#ff3b30')));

  const n = track.n;
  const linePos = new Float32Array((n + 1) * 3);
  const lineCol = new Float32Array((n + 1) * 3);
  const aLat = t.aSlide * AI_PARAMS.latSlide;
  const c = new THREE.Color();
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    linePos.set([track.line.x[i], y, track.line.z[i]], k * 3);
    const kap = Math.abs(track.line.curv[i]);
    const v = kap > 1e-4 ? Math.min(t.vTop, Math.sqrt(aLat / kap)) : t.vTop;
    c.setHSL((v / t.vTop) * 0.33, 1, 0.5);
    lineCol.set([c.r, c.g, c.b], k * 3);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
  g.add(new THREE.Line(lineGeo, lineMat(null)));

  const centre = new Float32Array((n + 1) * 3);
  for (let k = 0; k <= n; k++) centre.set([track.px[k % n], y, track.pz[k % n]], k * 3);
  const centreGeo = new THREE.BufferGeometry();
  centreGeo.setAttribute('position', new THREE.BufferAttribute(centre, 3));
  g.add(new THREE.Line(centreGeo, lineMat('#7f7f7f')));

  const cps = track.checkpoints;
  const cpPos = new Float32Array(cps.length * 6);
  cps.forEach((s, k) => {
    const i = sampleIndexAt(track, s);
    const r = track.hw[i] + track.def.runoff;
    cpPos.set([
      track.px[i] - track.nx[i] * r, y, track.pz[i] - track.nz[i] * r,
      track.px[i] + track.nx[i] * r, y, track.pz[i] + track.nz[i] * r,
    ], k * 6);
  });
  const cpGeo = new THREE.BufferGeometry();
  cpGeo.setAttribute('position', new THREE.BufferAttribute(cpPos, 3));
  g.add(new THREE.LineSegments(cpGeo, lineMat('#ffd60a')));

  g.traverse((o) => (o.renderOrder = 10));
  g.visible = false;
  return g;
}
