// Builds the starting world of a race from its spec. The server and every
// client run this with the same spec and get identical worlds.

import type { RaceSpec } from '../net/protocol.ts';
import { getTrack } from '../track/builder.ts';
import { TRACKS } from '../track/defs/index.ts';
import type { Track } from '../track/types.ts';
import { createWorld, type World } from '../sim/world.ts';

export function createRaceWorld(spec: RaceSpec): { track: Track; world: World } {
  const def = TRACKS[spec.track];
  if (!def) throw new Error(`unknown track ${spec.track}`);
  const track = getTrack(def);
  const world = createWorld(track, spec.entrants.length, spec.seed, {
    laps: spec.laps,
    countdownTicks: spec.countdownTicks,
    weapons: spec.weapons,
  });
  spec.entrants.forEach((e, i) => {
    const car = world.cars[i];
    car.aiSkill = e.skill;
    if (e.playerId >= 0) car.human = 1;
    else car.aiDriven = 1;
  });
  return { track, world };
}
