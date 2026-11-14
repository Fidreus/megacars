// Sanity checks for track definitions, run by tests and the track tools.

import { segmentsIntersect } from '../math/geom.ts';
import type { Track } from './types.ts';
import { DMath } from '../math/dmath.ts';

export interface ValidateOptions {
  /** Allow the centreline to cross itself (figure-8 tracks). */
  allowCrossing?: boolean;
}

export function validateTrack(track: Track, opts: ValidateOptions = {}): string[] {
  const errors = [...track.errors];
  const { n, px, pz, hw, s, length, deck, elev } = track;
  const runoff = track.def.runoff;
  // A bridge's upper pass and the road under it may overlap.
  const up = (d: number) => d >= 1 && d <= 3;
  const crossing = (i: number, j: number) => (up(deck[i]) && deck[j] === 4) || (up(deck[j]) && deck[i] === 4);
  errors.push(...checkBridges(track));

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
          if (along < minGap * 2.2 || crossing(i, j)) continue;
          const d = DMath.hypot(px[j] - px[i], pz[j] - pz[i]);
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
        if (j2 === i || crossing(i, j)) continue;
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
      const d = DMath.sq(px[i] - slot.x) + DMath.sq(pz[i] - slot.z);
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

/**
 * Bridges: the slopes up to a bridge must stay clear of the road below, and
 * wherever the road below runs under the upper road, the upper road must be
 * high enough to drive over its barriers.
 */
function checkBridges(track: Track): string[] {
  const { n, px, pz, nx, nz, hw, s, deck, elev } = track;
  const runoff = track.def.runoff;
  const errors: string[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < n; i++) {
    if (deck[i] >= 1 && deck[i] <= 3) upper.push(i);
    else if (deck[i] === 4) lower.push(i);
  }
  const nearest = (x: number, z: number, list: number[]) => {
    let best = -1;
    let bestD = Infinity;
    for (const j of list) {
      const d = DMath.sq(px[j] - x) + DMath.sq(pz[j] - z);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return { j: best, d: Math.sqrt(bestD) };
  };
  for (const [list, other] of [[upper, lower], [lower, upper]] as const) {
    for (const i of list) {
      for (const side of [-1, 1]) {
        const reach = (hw[i] + runoff) * side;
        const x = px[i] + nx[i] * reach;
        const z = pz[i] + nz[i] * reach;
        const { j, d } = nearest(x, z, other);
        if (j < 0 || d > hw[j] + runoff + 0.7) continue;
        const hi = list === upper ? i : j;
        if (deck[hi] === 1 && list === upper) {
          errors.push(`bridge slope at s=${s[i].toFixed(0)} reaches the road below (make the span longer)`);
          return errors;
        }
        if (deck[hi] !== 3 && elev[hi] < 3.2) {
          errors.push(`road at s=${s[i].toFixed(0)} passes under the bridge at s=${s[hi].toFixed(0)}, which is only ${elev[hi].toFixed(1)} m high there`);
          return errors;
        }
      }
    }
  }
  return errors;
}
