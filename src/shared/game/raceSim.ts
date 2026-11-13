// Headless race runner: all-AI races for balance checks, soak tests and CI.

import { DT } from '../config/constants.ts';
import { DEFAULT_TUNING, type CarTuning } from '../config/tuning.ts';
import { makeRng } from '../math/rng.ts';
import { getTrack } from '../track/builder.ts';
import type { TrackDef } from '../track/types.ts';
import { Ev } from '../sim/events.ts';
import { stepWorld } from '../sim/step.ts';
import { createWorld, RacePhase, standings, type World } from '../sim/world.ts';
import { PERSONAS } from '../ai/persona.ts';
import { setPersona } from './personaSetup.ts';

export interface SimRaceResult {
  seed: number;
  finished: number;
  cars: number;
  raceSeconds: number;
  winnerSeconds: number;
  bestLapSeconds: number;
  respawns: number;
  wallHits: number;
  carHits: number;
  shots: number;
  hits: number;
  wrecks: number;
  order: number[];
}

export function simulateRace(def: TrackDef, seed: number, opts: { cars?: number; laps?: number; tuning?: CarTuning; weapons?: boolean; personas?: boolean } = {}): SimRaceResult {
  const track = getTrack(def);
  const carCount = opts.cars ?? 8;
  const world: World = createWorld(track, carCount, seed, { laps: opts.laps ?? 3, countdownTicks: 1, weapons: opts.weapons });
  const rnd = makeRng(seed * 7 + 1);
  for (const c of world.cars) {
    c.aiDriven = 1;
    c.aiSkill = 0.88 + rnd() * 0.12;
    // A different mix of personalities for every seed (off: all drive alike).
    if (opts.personas !== false) setPersona(c, (seed * 3 + c.id) % PERSONAS.length);
  }
  const tunings = [opts.tuning ?? DEFAULT_TUNING];
  let wallHits = 0;
  let carHits = 0;
  let shots = 0;
  let hits = 0;
  let wrecks = 0;
  const maxTicks = 60 * 60 * 8;
  while (world.race.phase !== RacePhase.Finished && world.tick < maxTicks) {
    stepWorld(world, track, [], tunings);
    for (let k = 0; k < world.events.count; k++) {
      const e = world.events.list[k];
      if (e.kind === Ev.WallHit) wallHits++;
      else if (e.kind === Ev.CarHit) carHits++;
      else if (e.kind === Ev.Fire) shots++;
      else if (e.kind === Ev.Explosion && e.value !== 3) hits++;
      else if (e.kind === Ev.Wreck) wrecks++;
    }
  }
  const best = Math.min(...world.cars.map((c) => c.bestLapTicks || Infinity));
  const winner = world.race.finishOrder[0];
  return {
    seed,
    finished: world.race.finishOrder.length,
    cars: carCount,
    raceSeconds: (world.tick - world.race.startTick) * DT,
    winnerSeconds: winner !== undefined ? (world.cars[winner].finishTick - world.race.startTick) * DT : NaN,
    bestLapSeconds: best * DT,
    respawns: world.cars.reduce((a, c) => a + c.respawns, 0),
    wallHits,
    carHits,
    shots,
    hits,
    wrecks,
    order: standings(world),
  };
}
