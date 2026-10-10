// Sanity checks for track definitions, run by tests and the track tools.

import { segmentsIntersect } from '../math/geom.ts';
import type { Track } from './types.ts';

export interface ValidateOptions {
  /** Allow the centreline to cross itself (figure-8 tracks). */
  allowCrossing?: boolean;
}

export function validateTrack(track: Track, opts: ValidateOptions = {}): string[] {
  const errors = [...track.errors];
  const { n, px, pz, hw, s, length } = track;
  const runoff = track.def.runoff;

  // Separate parts of the track must not overlap (walls would interpenetrate).
  const minGap = 2 * (Math.max(...hw) + runoff) + 1;
  const cell = minGap;
  const buckets = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < n; i++) {
    const k = key(px[i], pz[i]);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(i);
  }
  let reported = 0;
  for (let i = 0; i < n && reported < 5; i++) {
    const cx = Math.floor(px[i] / cell);
    const cz = Math.floor(pz[i] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const j of buckets.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (j <= i) continue;
          let along = Math.abs(s[j] - s[i]);
          along = Math.min(along, length - along);
          if (along < minGap * 2.2) continue;
          const d = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
          if (d < minGap && !opts.allowCrossing) {
            errors.push(`sections at s=${s[i].toFixed(0)} and s=${s[j].toFixed(0)} are only ${d.toFixed(1)} m apart (need ${minGap.toFixed(1)})`);
            reported++;
          }
        }
      }
    }
  }

  // The centreline itself must not cross (unless explicitly allowed).
  if (!opts.allowCrossing) {
    for (let i = 0; i < n && reported < 8; i += 2) {
      const i2 = (i + 2) % n;
      for (let j = i + 6; j < n; j += 2) {
        const j2 = (j + 2) % n;
        if (j2 === i) continue;
        if (segmentsIntersect(px[i], pz[i], px[i2], pz[i2], px[j], pz[j], px[j2], pz[j2])) {
          errors.push(`centreline crosses itself near s=${s[i].toFixed(0)} and s=${s[j].toFixed(0)}`);
          reported++;
        }
      }
    }
  }

  // The start grid must sit on a straight.
  for (const slot of track.grid) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (px[i] - slot.x) ** 2 + (pz[i] - slot.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (Math.abs(track.curv[best]) > 1e-6) {
      errors.push('start grid is not on a straight');
      break;
    }
  }
  return errors;
}
