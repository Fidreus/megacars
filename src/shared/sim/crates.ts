// Item crates: rows of two or three crates across the road at a few places
// round the lap. Driving through one gives the car an item (missiles, mines,
// a turbo, a repair) and the crate comes back a few seconds later. Only in
// races with weapons on. Where they stand comes from the track's geometry;
// which ones are there is world state (`World.crates`), and what a crate
// gives is a hash of world values, so every machine agrees.

import type { CarTuning } from '../config/tuning.ts';
import { clamp, smoothstep } from '../math/angle.ts';
import { hash3 } from '../math/rng.ts';
import type { Track } from '../track/types.ts';
import { sampleU } from '../track/pit.ts';
import type { CarState } from './car.ts';
import { CATCH_UP } from './catchUp.ts';
import { Ev, pushEvent, type EventBuffer } from './events.ts';
import { SPECIAL_NAMES, SpecialItem } from './specials.ts';

export const CRATE = {
  /** Ticks a taken crate stays away (6 s). */
  respawnTicks: 360,
  /** Pickup reach: the car's circles plus this. */
  radius: 0.75,
  /** One row per this many metres of lap, within the limits below. */
  rowEvery: 500,
  minRows: 2,
  maxRows: 5,
  /** Three crates in a row on roads at least this wide, else two. */
  wideRoad: 15,
  /** Keep this far from the barrier line (metres from the crate centre). */
  edgeGap: 2.4,
  /** Corners tighter than this radius count as tight: no crates in them or in their braking zone. */
  tightR: 70,
  brakeZone: 45,
  /** Bends gentler than this radius may hold a row. */
  gentleR: 160,
  /** Kept clear around catch-up pads, ramps (and the landing after them) and bridges. */
  padGap: 20,
  rampBefore: 25,
  landing: 70,
  bridgeGap: 35,
};

/** A crate's place on the track. */
export interface CrateSpot {
  x: number;
  z: number;
  y: number;
  /** Distance along the centreline, and sideways from it (positive = right). */
  s: number;
  lat: number;
  /** Which row it belongs to (0-based, in lap order), and its centreline sample. */
  row: number;
  i: number;
}

// ------------------------------------------------------------------ contents

/** Item kinds a crate can hold (sent in Ev.CratePickup's `other`). */
export const CrateItem = { Missiles: 1, Mines: 2, Turbo: 3, Repair: 4, Homing: 5, Oil: 6, Shield: 7 } as const;

export interface CrateContent {
  item: number;
  /** HUD readout: "+2 MISSILES". */
  label: string;
  /** Weight for the leader and for the last car (lerped by race position). */
  front: number;
  back: number;
  /** How much of it this car can take now (0 = full up: the crate gives something else). */
  room: (car: CarState) => number;
  /** Give up to `room`; returns the amount for the readout. */
  give: (car: CarState) => number;
}

/** Ammunition caps, the same as the shop's. */
export const CRATE_CAPS = { missiles: 12, mines: 8, turbos: 6 };

/** Damage a repair crate mends. */
export const CRATE_REPAIR = 0.3;

/**
 * What crates hold. Cars at the back get more of what helps them catch up
 * and fight (turbo, missiles, repair), the leader more mines. Add a row here
 * for a new item kind.
 */
export const CRATE_ITEMS: CrateContent[] = [
  {
    item: CrateItem.Missiles, label: 'MISSILES', front: 3, back: 4,
    room: (c) => Math.min(2, CRATE_CAPS.missiles - c.missiles),
    give: (c) => {
      const n = Math.min(2, CRATE_CAPS.missiles - c.missiles);
      c.missiles += n;
      return n;
    },
  },
  {
    item: CrateItem.Mines, label: 'MINES', front: 4, back: 1.5,
    room: (c) => Math.min(2, CRATE_CAPS.mines - c.mines),
    give: (c) => {
      const n = Math.min(2, CRATE_CAPS.mines - c.mines);
      c.mines += n;
      return n;
    },
  },
  {
    item: CrateItem.Turbo, label: 'TURBO', front: 1.5, back: 3,
    room: (c) => Math.min(1, CRATE_CAPS.turbos - c.turbos),
    give: (c) => {
      const n = Math.min(1, CRATE_CAPS.turbos - c.turbos);
      c.turbos += n;
      return n;
    },
  },
  {
    // Only worth it with some damage to mend; the readout shows the percent mended.
    item: CrateItem.Repair, label: 'REPAIR', front: 1, back: 2.5,
    room: (c) => (c.damage >= 0.08 ? 1 : 0),
    give: (c) => {
      const n = Math.min(c.damage, CRATE_REPAIR);
      c.damage -= n;
      return Math.round(n * 100);
    },
  },
  // Special items (specials.ts): rarer, only into an empty slot (a held one is kept).
  specialRow(CrateItem.Homing, SpecialItem.Homing, 1.8, 3.6),
  specialRow(CrateItem.Oil, SpecialItem.Oil, 3.4, 1.3),
  specialRow(CrateItem.Shield, SpecialItem.Shield, 3, 2.2),
];

function specialRow(item: number, special: number, front: number, back: number): CrateContent {
  return {
    item, label: SPECIAL_NAMES[special], front, back,
    room: (c) => (c.special === SpecialItem.None ? 1 : 0),
    give: (c) => {
      c.special = special;
      return 1;
    },
  };
}

/** The content for an item kind (null if unknown). */
export function crateContent(item: number): CrateContent | null {
  for (const c of CRATE_ITEMS) if (c.item === item) return c;
  return null;
}

/**
 * What crate `crate` gives this car at `tick`, weighted by its race place
 * among `carCount` cars. Null when the car is full of everything.
 */
export function rollCrate(seed: number, crate: number, tick: number, car: CarState, carCount: number): CrateContent | null {
  const back = carCount > 1 ? clamp((car.place - 1) / (carCount - 1), 0, 1) : 0.5;
  let total = 0;
  for (const c of CRATE_ITEMS) if (c.room(car) > 0) total += c.front + (c.back - c.front) * back;
  if (total <= 0) return null;
  let r = hash3(seed, crate + 1, tick) * total;
  let last: CrateContent | null = null;
  for (const c of CRATE_ITEMS) {
    if (c.room(car) <= 0) continue;
    last = c;
    r -= c.front + (c.back - c.front) * back;
    if (r < 0) return c;
  }
  return last;
}

/** True if any crate content has room for this car. */
export function wantsCrate(car: CarState): boolean {
  for (const c of CRATE_ITEMS) if (c.room(car) > 0) return true;
  return false;
}

// ----------------------------------------------------------------- placement

/** Rows a lap of this length gets. */
export function crateRowCount(length: number): number {
  return clamp(Math.round(length / CRATE.rowEvery), CRATE.minRows, CRATE.maxRows);
}

/** True where a row may stand: on the ground, off the start straight, clear of pads, ramps, bridges and tight corners. */
export function crateSpotAllowed(track: Track, i: number): boolean {
  const { n, curv, deck, s, length } = track;
  const at = s[i];
  if (deck[i] !== 0 || track.elev[i] !== 0) return false;
  if (Math.abs(curv[i]) > 1 / CRATE.gentleR) return false;
  // The start straight: grid, start line and pit lane (with room either side).
  const u = sampleU(track, i);
  const pit = track.pit;
  let gridBack = 0;
  for (const g of track.grid) gridBack = Math.min(gridBack, (g.x - track.px[0]) * track.tx[0] + (g.z - track.pz[0]) * track.tz[0]);
  const lo = Math.min(pit ? pit.a : 0, gridBack - 10) - 20;
  const hi = Math.max(pit ? pit.b : 0, 20) + 20;
  if (u > lo && u < hi) return false;
  // A tight corner here or close ahead (its braking zone).
  for (let d = 0; d <= CRATE.brakeZone; d += 2) {
    if (Math.abs(curv[(i + d) % n]) > 1 / CRATE.tightR) return false;
  }
  const near = (a: number, from: number, to: number) => {
    let d = a - from;
    d -= Math.floor(d / length) * length;
    return d <= to - from;
  };
  for (const p of track.boosts) if (near(at, p - CRATE.padGap, p + CATCH_UP.length + CRATE.padGap)) return false;
  for (const r of track.ramps) if (near(at, r.s0 - CRATE.rampBefore, r.s1 + CRATE.landing)) return false;
  for (const b of track.bridges) {
    const reach = b.span + b.ramp + CRATE.bridgeGap;
    if (near(at, b.s - reach, b.s + reach) || near(at, b.sLower - CRATE.bridgeGap, b.sLower + CRATE.bridgeGap)) return false;
  }
  // Bridge approaches and embankments near this point.
  for (let d = -CRATE.padGap; d <= CRATE.padGap; d += 4) if (deck[(i + d + n) % n] !== 0) return false;
  return true;
}

/** Where the crates stand: rows spread round the lap, two or three across the road each. */
export function placeCrates(track: Track): CrateSpot[] {
  const { n, s, length } = track;
  const candidates: number[] = [];
  for (let i = 0; i < n; i += 2) if (crateSpotAllowed(track, i)) candidates.push(i);
  const rows = crateRowCount(length);
  const gap = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, length - d);
  };
  // Even spacing round the lap: try the pattern of `rows` equally spaced
  // targets at many offsets and take the candidate nearest each target. The
  // offset that places the most rows, then the one that moves them least, wins.
  const minGap = Math.min(150, length / (rows * 2.5));
  const window = length / (rows * 2);
  let picked: number[] = [];
  let bestCost = Infinity;
  const trial: number[] = [];
  for (let offset = 0; offset < length / rows; offset += 8) {
    trial.length = 0;
    let cost = 0;
    for (let k = 0; k < rows; k++) {
      const target = (offset + (k * length) / rows) % length;
      let best = -1;
      let bestD = window;
      for (const c of candidates) {
        const d = gap(s[c], target);
        if (d < bestD && trial.every((p) => gap(s[p], s[c]) >= minGap)) {
          bestD = d;
          best = c;
        }
      }
      if (best >= 0) {
        trial.push(best);
        cost += bestD;
      }
    }
    // Every row missed costs more than any displacement.
    cost += (rows - trial.length) * length;
    if (cost < bestCost) {
      bestCost = cost;
      picked = [...trial];
    }
  }
  picked.sort((a, b) => s[a] - s[b]);
  const spots: CrateSpot[] = [];
  picked.forEach((i, row) => {
    const hw = track.hw[i];
    const reach = Math.max(0, hw - CRATE.edgeGap);
    const lats = 2 * hw >= CRATE.wideRoad ? [-reach * 0.75, 0, reach * 0.75] : [-reach * 0.6, reach * 0.6];
    for (const lat of lats) {
      spots.push({ x: track.px[i] + track.nx[i] * lat, z: track.pz[i] + track.nz[i] * lat, y: track.elev[i], s: s[i], lat, row, i });
    }
  });
  return spots;
}

// ------------------------------------------------------------------ the race

/**
 * Respawn taken crates and let cars pick up the ones they touch. Call once a
 * tick while racing with weapons on, after the cars have moved.
 */
export function stepCrates(
  crates: number[], track: Track, cars: readonly CarState[], tunings: readonly CarTuning[], seed: number, tick: number, ev: EventBuffer,
): void {
  const spots = track.crates;
  for (let k = 0; k < crates.length; k++) {
    if (crates[k] > 0 && --crates[k] === 0) pushEvent(ev, Ev.CrateBack, -1, k, 0, spots[k].x, spots[k].z);
  }
  for (const car of cars) {
    if (car.finished || car.wreckTicks > 0 || car.airborne) continue;
    const t = tunings[car.id] ?? tunings[0];
    const fx = Math.sin(car.heading);
    const fz = -Math.cos(car.heading);
    const rr = t.circleR + CRATE.radius;
    for (let k = 0; k < spots.length; k++) {
      if (crates[k] !== 0) continue;
      const sp = spots[k];
      let ds = Math.abs(car.trackS - sp.s);
      if (ds > track.length / 2) ds = track.length - ds;
      if (ds > 8 || Math.abs(car.y - sp.y) > 1.2) continue;
      let touch = false;
      for (const off of [t.circleOffset, -t.circleOffset]) {
        const dx = car.x + fx * off - sp.x;
        const dz = car.z + fz * off - sp.z;
        if (dx * dx + dz * dz < rr * rr) touch = true;
      }
      if (!touch) continue;
      const c = rollCrate(seed, k, tick, car, cars.length);
      // Full of everything: drive through, the crate stays for somebody else.
      if (!c) continue;
      const amount = c.give(car);
      crates[k] = CRATE.respawnTicks;
      pushEvent(ev, Ev.CratePickup, car.id, c.item, amount, sp.x, sp.z);
    }
  }
}

/** How far to stray from the racing line (at the look-ahead point) to run through a crate close to it. */
export const CRATE_AI = {
  /** Crates this far ahead (m) are looked at; full lean from `full` in. */
  ahead: 55,
  full: 35,
  /** Never shifts further than this off the line for a crate. */
  maxShift: 2.6,
};

/**
 * Sideways shift (m, positive = right) a computer driver may add to its line
 * to run through the nearest standing crate ahead that is close to it. 0 when
 * there is none, or the car needs nothing.
 */
export function crateLean(car: CarState, track: Track, crates: readonly number[]): number {
  if (crates.length === 0 || car.finished || !wantsCrate(car)) return 0;
  const spots = track.crates;
  let best = 0;
  let bestAhead = Infinity;
  for (let k = 0; k < spots.length; k++) {
    if (crates[k] !== 0) continue;
    const sp = spots[k];
    let ahead = sp.s - car.trackS;
    if (ahead < 0) ahead += track.length;
    if (ahead < 3 || ahead > CRATE_AI.ahead) continue;
    // Where the racing line crosses this row.
    const shift = sp.lat - track.line.off[sp.i];
    if (Math.abs(shift) > CRATE_AI.maxShift) continue;
    // The nearest row ahead decides; in it, the crate closest to the line.
    if (ahead < bestAhead - 1 || (Math.abs(ahead - bestAhead) <= 1 && Math.abs(shift) < Math.abs(best))) {
      bestAhead = ahead;
      best = shift;
    }
  }
  if (bestAhead === Infinity) return 0;
  return best * (1 - smoothstep(CRATE_AI.full, CRATE_AI.ahead, bestAhead));
}
