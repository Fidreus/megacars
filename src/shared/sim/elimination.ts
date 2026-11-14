// Elimination races: each time the leader completes a lap (every second or
// third lap on the short tracks) the last car still running is out. The last
// car left wins. Everything is derived from world state (the cars' laps, race
// distance and elimination marks), so the server, every client and the
// replayer agree.

import type { Track } from '../track/types.ts';
import type { CarState } from './car.ts';
import { Ev, pushEvent } from './events.ts';
import { RacePhase, type World } from './world.ts';

export const ELIM = {
  /** Leader distance (m) between eliminations: about one lap of a full-size track. */
  distance: 2100,
  /** At most this many leader laps between eliminations. */
  maxEvery: 3,
  /** An eliminated car burns on the road this long, then is cleared away (no collisions, not drawn). */
  clearTicks: 120,
  /**
   * Nobody completes the leader's lap in time (everybody stuck, wrecked or
   * parked): the last car goes anyway once a car at this pace (m/s) would have.
   */
  stallSpeed: 15,
  /** Every person in the race is out: the computer cars go one by one this often. */
  rapidTicks: 60 * 6,
  /** From the last elimination to the end of the race. */
  endDelay: 60 * 3,
  /** Computer drivers in danger of going out: added to the damage that sends them into the pits. */
  pitShift: 0.35,
};

/** Fixed for the race (from the spec and the track). */
export interface ElimPlan {
  /** Leader laps per elimination. */
  every: number;
  /** The track's lap length (m). */
  lapLength: number;
}

/** Leader laps between eliminations on a track: 1 on full-size tracks, 2 or 3 on the short ones. */
export function elimEvery(trackLength: number): number {
  return Math.max(1, Math.min(ELIM.maxEvery, Math.round(ELIM.distance / Math.max(1, trackLength))));
}

/** Leader laps the whole race takes if every elimination comes at the line. */
export function elimLaps(every: number, cars: number): number {
  return Math.max(1, cars - 1) * every;
}

/** Turn a freshly built world into an elimination race (needs two cars or more). */
export function startElimination(w: World, track: Track): void {
  if (w.cars.length < 2) return;
  const every = elimEvery(track.length);
  w.elim = { every, lapLength: track.length };
  w.race.laps = elimLaps(every, w.cars.length);
}

export function isOut(car: CarState): boolean {
  return car.outOrder > 0;
}

/** An eliminated car that has burnt out and been cleared off the road (hidden, no collisions). */
export function isCleared(car: CarState, tick: number): boolean {
  return car.outOrder > 0 && tick - car.outTick >= ELIM.clearTicks;
}

/** Cars still in the race. */
export function carsLeft(w: World): number {
  let n = 0;
  for (const c of w.cars) if (c.outOrder === 0) n++;
  return n;
}

/** Laps the leader has completed (cars still in). */
export function leaderLaps(w: World): number {
  let best = 0;
  for (const c of w.cars) if (c.outOrder === 0 && c.lap - 1 > best) best = c.lap - 1;
  return best;
}

/** Eliminations so far. */
export function outCount(w: World): number {
  let n = 0;
  for (const c of w.cars) if (c.outOrder > 0) n++;
  return n;
}

/** Leader laps still to go before the next car is out (1 = this lap). */
export function lapsToElimination(w: World): number {
  if (!w.elim) return 0;
  return Math.max(1, (outCount(w) + 1) * w.elim.every - leaderLaps(w));
}

/** Ticks the stall rule allows between eliminations. */
export function stallTicks(track: Track, every: number): number {
  return Math.round(((every * track.length) / ELIM.stallSpeed) * 60);
}

/**
 * 0..1: how close a car is to going out (last = 1, second last = 0.5). The
 * computer drivers pit less and use their turbos and weapons when it is high.
 */
export function elimDanger(w: World, car: CarState): number {
  if (!w.elim || car.outOrder > 0 || car.finished) return 0;
  const left = carsLeft(w);
  if (left < 2) return 0;
  // Cars still in hold places 1..left (the eliminated rank below them).
  if (car.place >= left) return 1;
  return car.place === left - 1 ? 0.5 : 0;
}

/**
 * An eliminated car each tick, after the wreck's own step (instead of its
 * tow): it slides to a stop burning, then is cleared away.
 */
export function stepOutCar(car: CarState, tick: number): void {
  if (tick - car.outTick < ELIM.clearTicks) {
    car.ghostTicks = 0;
  } else {
    car.vx = car.vz = car.vy = 0;
    car.angVel = 0;
    // Out of everybody's way for the rest of the race.
    car.ghostTicks = 2;
  }
  car.turboTicks = 0;
  car.draft = 0;
  car.wreckTicks = Math.max(1, car.wreckTicks);
}

function eliminate(w: World, car: CarState, place: number, lap: number): void {
  car.outOrder = w.cars.length - place + 1;
  car.outTick = w.tick;
  car.outLap = lap;
  // Blows up like a wreck, but no tow: stepOutCar keeps it out.
  car.wreckTicks = Math.max(1, car.wreckTicks);
  car.turboTicks = 0;
  car.spinTicks = 0;
  pushEvent(w.events, Ev.Eliminated, car.id, place, lap, car.x, car.z);
}

function crown(w: World, car: CarState): void {
  const race = w.race;
  car.finished = 1;
  car.finishTick = w.tick;
  race.firstFinishTick = w.tick;
  race.finishOrder.push(car.id);
  // Cool-down on autopilot, out of everybody's way.
  car.aiDriven = 1;
  car.ghostTicks = 30000;
  pushEvent(w.events, Ev.Finish, car.id, 1, w.tick - race.startTick, car.x, car.z);
}

/**
 * The elimination rule, once a tick after the cars have moved (instead of
 * the normal finish). The last car still in goes when the leader completes
 * its lap, or when the stall limit runs out; once every person is out the
 * rest go quickly. One car left: it wins, and the race ends a moment later.
 */
export function stepElimination(w: World, track: Track): void {
  const plan = w.elim;
  const race = w.race;
  if (!plan || race.phase !== RacePhase.Racing) return;
  const cars = w.cars;
  let left = 0;
  let out = 0;
  let lastOut = race.startTick;
  let laps = 0;
  let humans = 0;
  let humansIn = 0;
  let last: CarState | null = null;
  for (const c of cars) {
    if (c.human) humans++;
    if (c.outOrder > 0) {
      out++;
      if (c.outTick > lastOut) lastOut = c.outTick;
      continue;
    }
    left++;
    if (c.human) humansIn++;
    if (c.lap - 1 > laps) laps = c.lap - 1;
    // Furthest back by race distance; a tie goes to the car further back on the grid.
    if (!last || c.raceDist <= last.raceDist) last = c;
  }
  if (left <= 1) {
    if (race.finishOrder.length > 0 && w.tick >= race.firstFinishTick + ELIM.endDelay) endRace(w);
    return;
  }
  const due = laps >= (out + 1) * plan.every;
  const wait = humans > 0 && humansIn === 0 ? ELIM.rapidTicks : stallTicks(track, plan.every);
  if (!due && w.tick < lastOut + wait) return;
  eliminate(w, last!, left, laps);
  if (left - 1 === 1) {
    for (const c of cars) if (c.outOrder === 0) crown(w, c);
  }
}

function endRace(w: World): void {
  const race = w.race;
  race.phase = RacePhase.Finished;
  race.endTick = w.tick;
  // The final classification: the winner, then the last out to the first.
  for (let k = w.cars.length; k >= 1; k--) {
    for (const c of w.cars) if (c.outOrder === k && !race.finishOrder.includes(c.id)) race.finishOrder.push(c.id);
  }
  pushEvent(w.events, Ev.RaceEnd, -1, -1, 0, 0, 0);
}
