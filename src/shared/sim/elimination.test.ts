import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { createRaceWorld } from '../game/raceSetup.ts';
import type { RaceSpec } from '../net/protocol.ts';
import { applySnapshot, encodeSnapshot } from '../net/snapshot.ts';
import { getTrack } from '../track/builder.ts';
import { TRACK_LIST } from '../track/defs/index.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { TIVOLI_TWIST } from '../track/defs/tivoliTwist.ts';
import {
  ELIM, carsLeft, elimDanger, elimEvery, isCleared, lapsToElimination, stallTicks, startElimination, stepElimination,
} from './elimination.ts';
import { Ev } from './events.ts';
import { neutralInput, type CarInput } from './input.ts';
import { stepWorld } from './step.ts';
import { createWorld, RacePhase, standings, type World } from './world.ts';

const track = getTrack(GREEN_VALLEY);

/** A racing world of n cars, set up for elimination, cars spread out by race distance. */
function field(n: number): World {
  const w = createWorld(track, n, 1, { laps: 3 });
  startElimination(w, track);
  w.cars.forEach((c, i) => {
    c.aiDriven = 1;
    c.lap = 1;
    c.raceDist = 500 - i * 10;
  });
  return w;
}

/** The leader crosses the line: one more lap completed. */
function leaderLap(w: World, leader = 0): void {
  w.cars[leader].lap++;
  w.cars[leader].raceDist += track.length;
}

function events(w: World, kind: number) {
  return w.events.list.slice(0, w.events.count).filter((e) => e.kind === kind);
}

function step(w: World): void {
  w.events.count = 0;
  stepElimination(w, track);
  w.tick++;
}

function spec(trackId: string, cars: number, over: Partial<RaceSpec> = {}): RaceSpec {
  return {
    id: 1, track: trackId, laps: 3, seed: 5, countdownTicks: 1, weapons: true, mode: 'elimination',
    entrants: Array.from({ length: cars }, (_, i) => ({ name: `CAR ${i}`, color: '#fff', playerId: -1, skill: 0.95 })),
    ...over,
  };
}

/** Step a built race to its end (or a tick limit); `inputs` for people's cars. */
function run(built: ReturnType<typeof createRaceWorld>, maxTicks: number, inputs: (CarInput | undefined)[] = []) {
  const { world, track: t, tunings } = built;
  const out: { car: number; place: number; lap: number; tick: number }[] = [];
  while (world.race.phase !== RacePhase.Finished && world.tick < maxTicks) {
    stepWorld(world, t, inputs, tunings);
    for (const e of events(world, Ev.Eliminated)) out.push({ car: e.car, place: e.other, lap: e.value, tick: world.tick });
  }
  return out;
}

describe('elimination interval', () => {
  it('one lap per elimination on full-size tracks, two or three on the short ones', () => {
    for (const def of TRACK_LIST) {
      const every = elimEvery(getTrack(def).length);
      if (def.lapScale && def.lapScale > 1) {
        expect(every, def.id).toBeGreaterThanOrEqual(2);
        expect(every, def.id).toBeLessThanOrEqual(3);
      } else {
        expect(every, def.id).toBe(1);
      }
    }
  });

  it('is fixed in the world and sets the laps the race takes', () => {
    const { world } = createRaceWorld(spec(TIVOLI_TWIST.id, 8));
    expect(world.elim?.every).toBe(elimEvery(getTrack(TIVOLI_TWIST).length));
    expect(world.race.laps).toBe(7 * world.elim!.every);
    // A normal race has none of it.
    const normal = createRaceWorld({ ...spec(TIVOLI_TWIST.id, 8), mode: undefined });
    expect(normal.world.elim).toBeUndefined();
    expect(normal.world.race.laps).toBe(3);
  });
});

describe('who goes out and when', () => {
  it('the last car by race distance goes when the leader completes a lap, not before', () => {
    const w = field(4);
    for (let k = 0; k < 100; k++) step(w);
    expect(carsLeft(w)).toBe(4);
    leaderLap(w);
    step(w);
    expect(w.cars[3].outOrder).toBe(1);
    expect(w.cars[3].outLap).toBe(1);
    const e = events(w, Ev.Eliminated);
    expect(e.length).toBe(1);
    expect(e[0].car).toBe(3);
    expect(e[0].other).toBe(4);
    // Nothing more until the next lap of the leader.
    for (let k = 0; k < 100; k++) step(w);
    expect(carsLeft(w)).toBe(3);
  });

  it('every second or third lap on a short track', () => {
    const w = field(4);
    w.elim!.every = 3;
    leaderLap(w);
    step(w);
    leaderLap(w);
    step(w);
    expect(carsLeft(w)).toBe(4);
    expect(lapsToElimination(w)).toBe(1);
    leaderLap(w);
    step(w);
    expect(carsLeft(w)).toBe(3);
    expect(w.cars[3].outLap).toBe(3);
    expect(lapsToElimination(w)).toBe(3);
  });

  it('a wrecked car can be the one that goes, and a tie goes to the car further back on the grid', () => {
    const w = field(4);
    w.cars[1].raceDist = 100;
    w.cars[2].raceDist = 100;
    w.cars[2].wreckTicks = 50;
    leaderLap(w);
    step(w);
    expect(w.cars[2].outOrder).toBe(1);
    expect(w.cars[1].outOrder).toBe(0);
  });

  it('classifies by the order of elimination and ends with one winner', () => {
    const w = field(4);
    const startTick = w.tick;
    for (let lap = 0; lap < 3; lap++) {
      leaderLap(w);
      step(w);
    }
    expect(carsLeft(w)).toBe(1);
    expect(w.cars[0].finished).toBe(1);
    expect(w.race.finishOrder).toEqual([0]);
    expect(w.race.phase).toBe(RacePhase.Racing);
    expect(standings(w)).toEqual([0, 1, 2, 3]);
    // The end follows a moment later, with the full classification.
    for (let k = 0; k < ELIM.endDelay + 2; k++) step(w);
    expect(w.race.phase).toBe(RacePhase.Finished);
    expect(w.race.finishOrder).toEqual([0, 1, 2, 3]);
    expect(w.cars.map((c) => c.outLap)).toEqual([0, 3, 2, 1]);
    expect(w.race.endTick).toBeGreaterThan(startTick);
  });

  it('places in standings: cars still in by distance, then the last out first', () => {
    const w = field(5);
    leaderLap(w);
    step(w);
    // The car that went out is behind everybody still in, even ones further back on the road.
    w.cars[3].raceDist = -100;
    expect(standings(w)).toEqual([0, 1, 2, 3, 4]);
    leaderLap(w);
    step(w);
    expect(w.cars[3].outOrder).toBe(2);
    expect(standings(w)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('a race always ends', () => {
  it('nobody completes a lap (everybody stuck or parked): the last car goes on the stall limit', () => {
    const w = field(3);
    const limit = stallTicks(track, 1);
    for (let k = 0; k < limit; k++) step(w);
    expect(carsLeft(w)).toBe(3);
    step(w);
    expect(carsLeft(w)).toBe(2);
    expect(w.cars[2].outOrder).toBe(1);
    // The next one counts from that elimination.
    for (let k = 0; k < limit; k++) step(w);
    expect(carsLeft(w)).toBe(1);
  });

  it('once every person is out, the computer cars go one by one quickly', () => {
    const w = field(5);
    w.cars[4].human = 1;
    w.cars[4].aiDriven = 0;
    leaderLap(w);
    step(w);
    expect(w.cars[4].outOrder).toBe(1);
    const at = w.tick;
    while (carsLeft(w) > 1 && w.tick < at + 10 * ELIM.rapidTicks) step(w);
    expect(carsLeft(w)).toBe(1);
    expect(w.tick - at).toBeLessThanOrEqual(3 * ELIM.rapidTicks + 1);
  });

  it('eliminated cars burn, are cleared away and never towed back', () => {
    const built = createRaceWorld(spec(GREEN_VALLEY.id, 3));
    const { world } = built;
    run(built, 200);
    const car = world.cars[2];
    car.raceDist = -1e6;
    // The leader is credited with a completed lap.
    world.cars[0].lap = Math.max(...world.cars.map((c) => c.lap)) + 1;
    let towed = 0;
    for (let k = 0; k < 400; k++) {
      stepWorld(world, built.track, [], built.tunings);
      towed += events(world, Ev.Respawn).filter((e) => e.car === 2).length;
    }
    expect(car.outOrder).toBe(1);
    expect(towed).toBe(0);
    expect(car.wreckTicks).toBeGreaterThan(0);
    expect(isCleared(car, world.tick)).toBe(true);
    expect(car.ghostTicks).toBeGreaterThan(0);
  });

  it('the last two cars both wrecked: they are towed back and the race still ends', () => {
    let wrecked = false;
    // Wreck both survivors at once right after the first elimination.
    const b2 = createRaceWorld(spec(GREEN_VALLEY.id, 3, { weapons: true }));
    while (b2.world.race.phase !== RacePhase.Finished && b2.world.tick < 60 * 60 * 6) {
      stepWorld(b2.world, b2.track, [], b2.tunings);
      if (!wrecked && carsLeft(b2.world) === 2) {
        wrecked = true;
        for (const c of b2.world.cars) if (c.outOrder === 0) c.damage = 1;
      }
    }
    expect(wrecked).toBe(true);
    expect(b2.world.race.phase).toBe(RacePhase.Finished);
    expect(carsLeft(b2.world)).toBe(1);
  });

  it('a person who stops driving goes out and the race goes on to one winner', () => {
    const s = spec(GREEN_VALLEY.id, 4);
    s.entrants[3] = { name: 'YOU', color: '#f00', playerId: 0, skill: 0.95 };
    const built = createRaceWorld(s);
    const out = run(built, 60 * 60 * 12, [undefined, undefined, undefined, neutralInput()]);
    expect(out[0].car).toBe(3);
    expect(out[0].place).toBe(4);
    expect(built.world.race.phase).toBe(RacePhase.Finished);
    expect(carsLeft(built.world)).toBe(1);
    // After the person went out the others went quickly.
    expect(out[2].tick - out[0].tick).toBeLessThanOrEqual(2 * ELIM.rapidTicks + 1);
  });

  it('a full race of computer cars on a short track: seven out, every few laps, one winner', () => {
    const built = createRaceWorld(spec(TIVOLI_TWIST.id, 8));
    const out = run(built, 60 * 60 * 15);
    const { world } = built;
    expect(world.race.phase).toBe(RacePhase.Finished);
    expect(out.length).toBe(7);
    expect(out.map((o) => o.place)).toEqual([8, 7, 6, 5, 4, 3, 2]);
    // Laps of the leader, a multiple of the interval (all at the line, none on the stall limit).
    out.forEach((o, k) => expect(o.lap).toBe((k + 1) * world.elim!.every));
    expect(world.race.finishOrder.length).toBe(8);
    expect(new Set(world.race.finishOrder).size).toBe(8);
    expect(world.cars.filter((c) => c.finished).length).toBe(1);
  });
});

describe('computer drivers in danger', () => {
  it('last is in most danger, second last some, the others none', () => {
    const w = field(4);
    w.cars.forEach((c, i) => { c.place = i + 1; });
    expect(w.cars.map((c) => elimDanger(w, c))).toEqual([0, 0, 0.5, 1]);
    const normal = createWorld(track, 4, 1, { laps: 3 });
    normal.cars.forEach((c, i) => { c.place = i + 1; });
    expect(normal.cars.map((c) => elimDanger(normal, c))).toEqual([0, 0, 0, 0]);
  });
});

describe('snapshots', () => {
  it('a world restored in the middle of an elimination race runs on identically', () => {
    const s = spec(TIVOLI_TWIST.id, 6);
    const a = createRaceWorld(s, DEFAULT_TUNING);
    // Until a couple of cars are out (one of them still burning).
    while (carsLeft(a.world) > 4 || a.world.tick - Math.max(...a.world.cars.map((c) => c.outTick)) < 30) stepWorld(a.world, a.track, [], a.tunings);
    const inputs = a.world.cars.map(() => neutralInput());
    const snap = encodeSnapshot(a.world, inputs, { lead: 0, lastInputTick: 0 });
    const b = createRaceWorld(s, DEFAULT_TUNING);
    expect(applySnapshot(snap, b.world, inputs.map(() => neutralInput()))).toBe(a.world.tick);
    for (let k = 0; k < 60 * 60 * 3 && a.world.race.phase !== RacePhase.Finished; k++) {
      stepWorld(a.world, a.track, [], a.tunings);
      stepWorld(b.world, b.track, [], b.tunings);
    }
    expect(b.world.tick).toBe(a.world.tick);
    expect(b.world.cars.map((c) => [c.x, c.z, c.outOrder, c.outLap])).toEqual(a.world.cars.map((c) => [c.x, c.z, c.outOrder, c.outLap]));
    expect(b.world.race.finishOrder).toEqual(a.world.race.finishOrder);
  });
});
