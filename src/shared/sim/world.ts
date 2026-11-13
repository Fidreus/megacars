// The complete simulation state. Everything that affects the future lives
// here, so a world can be copied, sent over the network and re-simulated.

import { elevationAt, sampleIndexAt } from '../track/builder.ts';
import type { Track } from '../track/types.ts';
import { createCar, type CarState } from './car.ts';
import { makeEventBuffer, type EventBuffer } from './events.ts';
import { resetProgress } from './race.ts';
import { giveStartAmmo, type Shot } from './weapons.ts';
import { clearDriftBoost } from './driftBoost.ts';

export const RacePhase = { Countdown: 0, Racing: 1, Finished: 2 } as const;

export interface RaceState {
  phase: number;
  /** Laps to finish; 0 = free practice (no finish). */
  laps: number;
  /** Tick at which the lights go green. */
  startTick: number;
  /** Tick the first car finished (0 = nobody yet). */
  firstFinishTick: number;
  /** Tick the race ended (0 = still running). */
  endTick: number;
  /** Car ids in finishing order. */
  finishOrder: number[];
  /** 1 = weapons and damage on. */
  weapons: number;
}

export interface World {
  tick: number;
  rng: number;
  cars: CarState[];
  race: RaceState;
  /** Missiles and mines (slots with kind 0 are free). */
  shots: Shot[];
  events: EventBuffer;
}

export interface WorldOptions {
  laps?: number;
  /** Ticks of countdown before the start (0 = start immediately). */
  countdownTicks?: number;
  /** Weapons and damage. */
  weapons?: boolean;
}

/** Ticks from the start lights going out to the end of a 3-light countdown. */
export const COUNTDOWN_TICKS = 210;

export function createWorld(track: Track, carCount: number, seed: number, opts: WorldOptions = {}): World {
  const cars: CarState[] = [];
  for (let i = 0; i < carCount; i++) {
    const slot = track.grid[i % track.grid.length];
    const car = createCar(i, slot.x, slot.z, slot.heading);
    resetProgress(car, track);
    giveStartAmmo(car, !!opts.weapons);
    cars.push(car);
  }
  const countdown = opts.countdownTicks ?? 0;
  return {
    tick: 0,
    rng: seed | 0,
    cars,
    race: {
      phase: countdown > 0 ? RacePhase.Countdown : RacePhase.Racing,
      laps: opts.laps ?? 0,
      startTick: countdown,
      firstFinishTick: 0,
      endTick: 0,
      finishOrder: [],
      weapons: opts.weapons ? 1 : 0,
    },
    shots: [],
    events: makeEventBuffer(),
  };
}

/** Car ids ordered by race position: finishers first, then by distance covered. */
export function standings(w: World): number[] {
  const order = w.cars.map((c) => c.id);
  const finishIndex = new Map(w.race.finishOrder.map((id, i) => [id, i]));
  order.sort((a, b) => {
    const fa = finishIndex.get(a);
    const fb = finishIndex.get(b);
    if (fa !== undefined || fb !== undefined) return (fa ?? 1e9) - (fb ?? 1e9);
    return w.cars[b].raceDist - w.cars[a].raceDist;
  });
  return order;
}

const elev = { h: 0, slope: 0, gap: 0 };

/** Put a car back on the centreline near its current progress, stopped. */
export function respawnCar(car: CarState, track: Track, s: number): void {
  const i = sampleIndexAt(track, s);
  // Keep race distance continuous across the jump.
  let ds = track.s[i] - car.trackS;
  if (ds > track.length / 2) ds -= track.length;
  else if (ds < -track.length / 2) ds += track.length;
  car.raceDist += ds;
  car.x = track.px[i];
  car.z = track.pz[i];
  elevationAt(track, track.s[i], elev);
  car.y = elev.h;
  car.vx = car.vz = car.vy = 0;
  car.airborne = 0;
  car.turboTicks = 0;
  car.wreckTicks = 0;
  car.heading = Math.atan2(track.tx[i], -track.tz[i]);
  car.angVel = 0;
  car.steer = 0;
  car.sliding = 0;
  car.modeTicks = 0;
  car.spinTicks = 0;
  car.slip = 0;
  car.trackIdx = i;
  car.trackS = track.s[i];
  car.stuckTicks = 0;
  car.aiReverseTicks = 0;
  car.wrongWayTicks = 0;
  car.ghostTicks = 90;
  clearDriftBoost(car);
  car.draft = 0;
}
