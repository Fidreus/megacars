// A race (or practice session) running locally: the world, who drives which
// car, names and colours. The same rules run on the server for online play.

import { cloneTuning, type CarTuning } from '../../shared/config/tuning.ts';
import { makeRng } from '../../shared/math/rng.ts';
import { getTrack } from '../../shared/track/builder.ts';
import { TRACKS } from '../../shared/track/defs/index.ts';
import type { Track } from '../../shared/track/types.ts';
import { neutralInput, type CarInput } from '../../shared/sim/input.ts';
import { stepWorld } from '../../shared/sim/step.ts';
import { COUNTDOWN_TICKS, createWorld, type World } from '../../shared/sim/world.ts';
import { CAR_COLORS } from '../render/materials.ts';
import { AI_NAMES } from './names.ts';
import type { RaceSettings } from './settings.ts';

const SKILL = [0.86, 0.93, 1.0];

export class RaceSession {
  readonly settings: RaceSettings;
  readonly track: Track;
  readonly world: World;
  readonly tunings: CarTuning[];
  readonly inputs: CarInput[];
  /** Car id of each local player (P1, P2). */
  readonly playerCars: number[];
  readonly names: string[];
  readonly colors: string[];

  constructor(settings: RaceSettings, baseTuning: CarTuning, seed = Date.now() & 0xffff) {
    this.settings = settings;
    this.track = getTrack(TRACKS[settings.track]);
    const humans = settings.players;
    const count = Math.min(8, humans + settings.opponents);
    this.world = createWorld(this.track, count, seed, {
      laps: settings.practice ? 0 : settings.laps,
      countdownTicks: settings.practice ? 0 : COUNTDOWN_TICKS,
    });
    // One shared tuning object so live tuning affects everybody (upgrades come later).
    this.tunings = [baseTuning];
    this.inputs = this.world.cars.map(() => neutralInput());
    // People start at the back of the grid and work their way up.
    this.playerCars = [];
    for (let p = 0; p < humans; p++) this.playerCars.push(count - humans + p);
    const rnd = makeRng(seed);
    const names = [...AI_NAMES].sort(() => rnd() - 0.5);
    this.names = [];
    this.colors = [];
    let aiColor = 2;
    for (const car of this.world.cars) {
      const p = this.playerCars.indexOf(car.id);
      if (p >= 0) {
        car.human = 1;
        this.names.push(humans === 1 ? 'YOU' : `P${p + 1}`);
        this.colors.push(CAR_COLORS[p]);
      } else {
        car.aiDriven = 1;
        car.aiSkill = SKILL[settings.difficulty] + (rnd() - 0.5) * 0.06;
        this.names.push(names[car.id % names.length]);
        this.colors.push(CAR_COLORS[aiColor++ % CAR_COLORS.length]);
      }
    }
  }

  step(): void {
    stepWorld(this.world, this.track, this.inputs, this.tunings);
  }
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
