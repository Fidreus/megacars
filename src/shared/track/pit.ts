// Pit lane: a short detour beside the start straight. It leaves the road
// before the start line, runs behind a concrete island and rejoins after it.
// Between the first and the last line painted across the lane the car is
// repaired: driving the whole way through mends a fixed share, and every
// second spent there mends more, so slowing down (or stopping) pays off.
//
// The start straight is straight, so the lane is described in the straight's
// own coordinates: u along it from the start line (negative before it) and
// lat sideways from the centreline, positive toward the pit side.

import { smoothstep } from '../math/angle.ts';
import type { Track } from './types.ts';
import { DMath } from '../math/dmath.ts';

export const PIT = {
  /** Half width of the lane. */
  laneHalf: 4,
  /** Width of the concrete island between the road and the lane (more than a car is wide). */
  island: 3,
  /** Damage mended by driving from the first line to the last, however fast. */
  throughRepair: 0.45,
  /** Damage mended per second between the lines on top of that. */
  repairPerSecond: 0.12,
  /** Rough spacing of the lines painted across the lane. */
  bayEvery: 6,
  /** Room behind the outer wall for the garages. */
  garage: 10,
  /** Longest lane (each way from the start line) and the shortest that is worth it. */
  maxHalf: 90,
  minLength: 90,
  /** Gap kept to the corners at either end of the straight. */
  cornerGap: 8,
};

export interface Pit {
  side: 1 | -1;
  /** The start line point and the straight's direction (tangent and right normal). */
  ox: number;
  oz: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  /** Where the lane leaves the road (a < 0) and rejoins it (b > 0), and how long each bend is. */
  a: number;
  b: number;
  ramp: number;
  /** Sideways: the road's barrier line, the lane centre on the road, and the lane centre behind the island. */
  barrier: number;
  roadOff: number;
  pitOff: number;
  /** The pit box (along): where the island is. */
  box0: number;
  box1: number;
  /** The repair zone (along): the first and the last line across the lane. */
  zone0: number;
  zone1: number;
}

/** Where the lines across the lane are painted (along); the first and last bound the repair zone. */
export function pitLines(p: Pit): number[] {
  const n = Math.max(2, Math.round((p.zone1 - p.zone0) / PIT.bayEvery));
  return Array.from({ length: n + 1 }, (_, k) => p.zone0 + ((p.zone1 - p.zone0) * k) / n);
}

/** Damage mended in one tick between the lines: `along` metres driven forward, `dt` seconds spent. */
export function pitRepair(p: Pit, along: number, dt: number): number {
  return (PIT.throughRepair * along) / (p.zone1 - p.zone0) + PIT.repairPerSecond * dt;
}

/** Lane centre (lat) at `u`. */
export function laneOffset(p: Pit, u: number): number {
  const k = Math.min(smoothstep(p.a, p.a + p.ramp, u), 1 - smoothstep(p.b - p.ramp, p.b, u));
  return p.roadOff + (p.pitOff - p.roadOff) * k;
}

/** Where the outer barrier runs (lat) at `u`: the road's barrier, bulging out around the lane. */
export function pitWallOffset(p: Pit, u: number): number {
  if (u <= p.a || u >= p.b) return p.barrier;
  return Math.max(p.barrier, laneOffset(p, u) + PIT.laneHalf + 0.4);
}

/** The straight's coordinates of a point. */
export function pitLocal(p: Pit, x: number, z: number, out: { u: number; lat: number }): void {
  const dx = x - p.ox;
  const dz = z - p.oz;
  out.u = dx * p.tx + dz * p.tz;
  out.lat = p.side * (dx * p.nx + dz * p.nz);
}

const local = { u: 0, lat: 0 };

/** Between the first and last line across the lane, behind the island: where the car gets repaired. */
export function inPitBox(p: Pit | null, x: number, z: number): boolean {
  if (!p) return false;
  pitLocal(p, x, z, local);
  return local.u >= p.zone0 && local.u <= p.zone1 && local.lat >= p.barrier + PIT.island && local.lat <= p.pitOff + PIT.laneHalf + 0.4;
}

/** On the pit lane (anywhere from leaving the road to rejoining it). */
export function onPitLane(p: Pit | null, x: number, z: number): boolean {
  if (!p) return false;
  pitLocal(p, x, z, local);
  return local.u >= p.a && local.u <= p.b && Math.abs(local.lat - laneOffset(p, local.u)) <= PIT.laneHalf + 0.5;
}

/** Beyond the road, up to the pit's outer wall (lane, island, the open grass by the bends): no weapons here. */
export function inPitArea(p: Pit | null, x: number, z: number): boolean {
  if (!p) return false;
  pitLocal(p, x, z, local);
  // From (just inside) the road's barrier line out: the road itself is never pit area.
  return local.u >= p.a && local.u <= p.b && local.lat > p.barrier - 1 && local.lat <= pitWallOffset(p, local.u) + 0.1;
}

/** Along-distance (u) of a centreline sample: the distance from the start line, negative before it. */
export function sampleU(track: Track, i: number): number {
  const s = track.s[i];
  return s > track.length / 2 ? s - track.length : s;
}

/**
 * Lay out the pit lane on the start straight, on the side with more room
 * (garages included). Null when the straight is too short or both sides are
 * too close to other parts of the track.
 */
export function buildPit(track: Track): Pit | null {
  const { n, curv, deck, hw, def } = track;
  const straight = (i: number) => Math.abs(curv[i]) < 1e-6 && deck[i] === 0;
  let before = 0;
  while (before < n && straight((n - 1 - before + n) % n)) before++;
  let after = 0;
  while (after < n && straight(after)) after++;
  const a = -Math.min(PIT.maxHalf, before - PIT.cornerGap);
  const b = Math.min(PIT.maxHalf, after - PIT.cornerGap);
  if (b - a < PIT.minLength) return null;
  const ramp = Math.min(40, (b - a) * 0.3);
  const barrier = hw[0] + def.runoff;
  const pitOff = barrier + PIT.island + PIT.laneHalf;
  const outer = pitOff + PIT.laneHalf + PIT.garage;
  // Room on each side: the closest other part of the track (its barrier) to the pit area.
  // A side needs clearly more room to win: on a symmetric straight the two
  // differ only by rounding, and that must not move the pits (left on a tie).
  let best: 1 | -1 = -1;
  let bestRoom = -Infinity;
  for (const side of [-1, 1] as const) {
    let room = Infinity;
    for (let u = a; u <= b; u += 4) {
      for (const lat of [barrier + 2, outer]) {
        const x = track.px[0] + track.tx[0] * u + track.nx[0] * lat * side;
        const z = track.pz[0] + track.tz[0] * u + track.nz[0] * lat * side;
        for (let j = 0; j < n; j++) {
          const uj = sampleU(track, j);
          if (uj > a - 30 && uj < b + 30) continue;
          room = Math.min(room, DMath.hypot(track.px[j] - x, track.pz[j] - z) - hw[j] - def.runoff);
        }
      }
    }
    if (room > bestRoom + 0.01) {
      bestRoom = room;
      best = side;
    }
  }
  if (bestRoom < 4) return null;
  return {
    side: best,
    ox: track.px[0], oz: track.pz[0], tx: track.tx[0], tz: track.tz[0], nx: track.nx[0], nz: track.nz[0],
    a, b, ramp,
    barrier,
    roadOff: hw[0] - PIT.laneHalf,
    pitOff,
    box0: a + ramp + 4,
    box1: b - ramp - 4,
    zone0: a + ramp + 7,
    zone1: b - ramp - 7,
  };
}
