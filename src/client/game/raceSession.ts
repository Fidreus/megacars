// A race (or practice session) running locally: the world, who drives which
// car, names and colours. It is built from a RaceSpec like online races, so
// championships can bring their own drivers and upgraded cars.

import { cloneTuning, type CarTuning } from '../../shared/config/tuning.ts';
import { AI_NAMES, AI_SKILL, CAR_COLORS } from '../../shared/game/roster.ts';
import { leagueOf, type League } from '../../shared/game/leagues.ts';
import { createRaceWorld } from '../../shared/game/raceSetup.ts';
import { makeRng } from '../../shared/math/rng.ts';
import type { Entrant, RaceSpec } from '../../shared/net/protocol.ts';
import type { Track } from '../../shared/track/types.ts';
import { neutralInput, type CarInput } from '../../shared/sim/input.ts';
import { stepWorld } from '../../shared/sim/step.ts';
import { COUNTDOWN_TICKS, type World } from '../../shared/sim/world.ts';
import type { GameSession } from './session.ts';
import type { RaceSettings } from './settings.ts';
import { raceLaps } from '../../shared/track/defs/index.ts';

export class RaceSession implements GameSession {
  readonly settings: RaceSettings;
  readonly spec: RaceSpec;
  readonly track: Track;
  readonly world: World;
  readonly tunings: CarTuning[];
  readonly inputs: CarInput[];
  /** Car id of each local player (P1, P2). */
  readonly playerCars: number[];
  readonly names: string[];
  readonly colors: string[];
  readonly models: number[];
  readonly league: League;

  /**
   * A race from menu settings, or from a ready-made spec (championships).
   * Local players have playerId 0 and 1 in the spec.
   */
  constructor(settings: RaceSettings, baseTuning: CarTuning, seed = Date.now() & 0xffff, spec?: RaceSpec) {
    this.settings = settings;
    this.spec = spec ?? specFromSettings(settings, seed);
    const built = createRaceWorld(this.spec, baseTuning);
    this.track = built.track;
    this.world = built.world;
    // Stock standard cars share the live-tuned object (tuning panel); upgraded
    // cars and other leagues get their own.
    this.tunings = this.spec.entrants.some((e) => e.loadout) || leagueOf(this.spec.league) !== 'standard' ? built.tunings : [baseTuning];
    this.inputs = this.world.cars.map(() => neutralInput());
    this.playerCars = [];
    for (const p of [0, 1]) {
      const car = this.spec.entrants.findIndex((e) => e.playerId === p);
      if (car >= 0) this.playerCars.push(car);
    }
    this.names = this.spec.entrants.map((e) => e.name);
    this.colors = this.spec.entrants.map((e) => e.color);
    this.models = this.spec.entrants.map((e) => e.loadout?.car ?? -1);
    this.league = leagueOf(this.spec.league);
  }

  step(): void {
    stepWorld(this.world, this.track, this.inputs, this.tunings);
  }
}

/** Computer cars at the front of the grid, people at the back. */
function specFromSettings(settings: RaceSettings, seed: number): RaceSpec {
  const humans = settings.players;
  const count = Math.min(8, humans + settings.opponents);
  const rnd = makeRng(seed);
  const names = [...AI_NAMES].sort(() => rnd() - 0.5);
  const entrants: Entrant[] = [];
  for (let k = 0; k < count - humans; k++) {
    entrants.push({
      name: names[k % names.length],
      color: CAR_COLORS[(2 + k) % CAR_COLORS.length],
      playerId: -1,
      skill: AI_SKILL[settings.difficulty] + (rnd() - 0.5) * 0.06,
    });
  }
  for (let p = 0; p < humans; p++) {
    entrants.push({ name: humans === 1 ? 'YOU' : `P${p + 1}`, color: CAR_COLORS[p], playerId: p, skill: AI_SKILL[1] });
  }
  return {
    id: 0,
    track: settings.track,
    laps: settings.practice ? 0 : raceLaps(settings.track, settings.laps),
    seed,
    countdownTicks: settings.practice ? 0 : COUNTDOWN_TICKS,
    weapons: settings.weapons,
    entrants,
    league: settings.league,
  };
}

/** An all-AI practice session for the title screen. */
export function attractSession(settings: RaceSettings, tuning: CarTuning): RaceSession {
  const s = new RaceSession({ ...settings, players: 1, opponents: 7, practice: true }, cloneTuning(tuning), 7);
  for (const car of s.world.cars) {
    car.human = 0;
    car.aiDriven = 1;
    car.aiSkill = 0.9 + (car.id % 4) * 0.03;
  }
  s.playerCars.length = 0;
  return s;
}
