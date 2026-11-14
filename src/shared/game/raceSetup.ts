// Builds the starting world of a race from its spec. The server and every
// client run this with the same spec and get identical worlds and handling.

import { DEFAULT_TUNING, type CarTuning } from '../config/tuning.ts';
import type { RaceSpec } from '../net/protocol.ts';
import { getTrack } from '../track/builder.ts';
import { trackDef } from '../track/defs/index.ts';
import type { Track } from '../track/types.ts';
import { createWorld, type World } from '../sim/world.ts';
import { leagueTuning } from './leagues.ts';
import { defaultLoadout, tuningFor } from './shop.ts';
import { applyPersona } from './personaSetup.ts';
import { weatherPlanFor } from './weather.ts';
import { isElimination } from './raceMode.ts';
import { startElimination } from '../sim/elimination.ts';

export function createRaceWorld(spec: RaceSpec, base: CarTuning = DEFAULT_TUNING): { track: Track; world: World; tunings: CarTuning[] } {
  const def = trackDef(spec.track);
  if (!def) throw new Error(`unknown track ${spec.track}`);
  const track = getTrack(def);
  const world = createWorld(track, spec.entrants.length, spec.seed, {
    laps: spec.laps,
    countdownTicks: spec.countdownTicks,
    weapons: spec.weapons,
  });
  if (isElimination(spec)) startElimination(world, track);
  // Elimination sets its own lap count: the weather is spread over the race it really is.
  world.weather = weatherPlanFor({ ...spec, laps: world.race.laps }, track);
  const tunings: CarTuning[] = [];
  base = leagueTuning(base, spec.league);
  if (spec.damageSlows === false) base = { ...base, damageSlow: 0 };
  spec.entrants.forEach((e, i) => {
    const car = world.cars[i];
    car.aiSkill = e.skill;
    if (e.playerId >= 0) car.human = 1;
    else car.aiDriven = 1;
    const l = e.loadout ?? defaultLoadout();
    tunings.push(tuningFor(base, l));
    if (e.loadout) {
      // Ammo is kept even with weapons off, so it carries over to later races.
      car.missiles = l.missiles;
      car.mines = l.mines;
      car.turbos = l.turbos;
      car.special = l.special ?? 0;
      car.damage = l.damage;
    }
    applyPersona(car, e, spec.entrants);
  });
  return { track, world, tunings };
}
