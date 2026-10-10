// Track progress, checkpoints and lap timing.

import type { Track } from '../track/types.ts';
import type { CarState } from './car.ts';
import { Ev, pushEvent, type EventBuffer } from './events.ts';

/** Samples searched either side of the last known position (~1 m each). */
const SEARCH_WINDOW = 40;

/** Full search for the nearest centreline sample (spawn, respawn, teleport). */
export function resetProgress(car: CarState, track: Track): void {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < track.n; i++) {
    const dx = car.x - track.px[i];
    const dz = car.z - track.pz[i];
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  car.trackIdx = best;
  car.trackS = projectS(car, track, best);
  // Cars on the grid sit just behind the line: count that as negative distance.
  car.raceDist = car.trackS > track.length / 2 && car.lap === 0 ? car.trackS - track.length : car.trackS;
}

function projectS(car: CarState, track: Track, i: number): number {
  const L = track.length;
  let s = track.s[i] + (car.x - track.px[i]) * track.tx[i] + (car.z - track.pz[i]) * track.tz[i];
  if (s < 0) s += L;
  else if (s >= L) s -= L;
  return s;
}

/** True when moving forward by `ds` from `prevS` passes the point `c`. */
function crossed(prevS: number, ds: number, c: number, L: number): boolean {
  if (ds <= 0) return false;
  let rel = c - prevS;
  if (rel <= 0) rel += L;
  return rel <= ds;
}

export function updateProgress(car: CarState, track: Track, tick: number, ev: EventBuffer): void {
  const n = track.n;
  let best = car.trackIdx;
  let bestD = Infinity;
  for (let k = -SEARCH_WINDOW; k <= SEARCH_WINDOW; k++) {
    let i = car.trackIdx + k;
    if (i < 0) i += n;
    else if (i >= n) i -= n;
    const dx = car.x - track.px[i];
    const dz = car.z - track.pz[i];
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  car.trackIdx = best;
  const L = track.length;
  const prevS = car.trackS;
  const s = projectS(car, track, best);
  let ds = s - prevS;
  if (ds > L / 2) ds -= L;
  else if (ds < -L / 2) ds += L;
  car.trackS = s;
  car.raceDist += ds;

  // Wrong way: clearly moving backwards along the track.
  if (ds < -0.03) car.wrongWayTicks++;
  else if (ds > 0.03) car.wrongWayTicks = 0;

  const cps = track.checkpoints;
  const target = cps[car.nextCp];
  if (crossed(prevS, ds, target, L)) {
    if (car.nextCp === 0) {
      if (car.lap > 0) {
        const lapTicks = tick - car.lapStartTick;
        car.lastLapTicks = lapTicks;
        if (car.bestLapTicks === 0 || lapTicks < car.bestLapTicks) car.bestLapTicks = lapTicks;
        pushEvent(ev, Ev.Lap, car.id, car.lap, lapTicks, car.x, car.z);
      }
      car.lap++;
      car.lapStartTick = tick;
    }
    car.nextCp = (car.nextCp + 1) % cps.length;
  }
}
