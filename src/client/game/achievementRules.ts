// The achievements, as a table of rules. Each rule is fed what the client sees
// (simulation events and a car's state every tick, an end-of-race summary, a
// medal won, a season ended, a track published) and moves its own meter.
// To add an achievement for a new feature: add one entry to ACHIEVEMENTS and,
// if it needs something the inputs below do not carry, one more input kind.

import type { League } from '../../shared/game/leagues.ts';
import { Ev, type SimEvent } from '../../shared/sim/events.ts';
import type { CarState } from '../../shared/sim/car.ts';
import type { World } from '../../shared/sim/world.ts';
import type { Track } from '../../shared/track/types.ts';
import { TRACK_LIST } from '../../shared/track/defs/index.ts';
import type { MedalTotals } from './medals.ts';
import type { SeasonOutcome } from './career.ts';

/** What the local player's race came to (offline: when they cross the line; online: at the results). */
export interface RaceSummary {
  track: string;
  league: League;
  mode: 'quick' | 'cup' | 'career' | 'online';
  /** Cars in the race, and the place the player finished in (1 = winner). */
  cars: number;
  place: number;
  laps: number;
  weapons: boolean;
  /** Raced with the headlights on. */
  night: boolean;
  /** Cars wrecked by this player's weapons, and the damage left at the line (0..1). */
  kills: number;
  damage: number;
  /** The rules saw the whole race (not so online: the world there is predicted). */
  live: boolean;
  /** An elimination race, and the grid slot the player started from (1 = front). */
  elimination?: boolean;
  start?: number;
  /** Out of an elimination race (not a finish: no clean-finish achievements). */
  eliminated?: boolean;
}

export type AchInput =
  | { kind: 'raceStart' }
  /** A simulation event in a race of one person at this screen. */
  | { kind: 'event'; e: SimEvent; w: World; me: CarState }
  /** Every simulation tick of such a race. */
  | { kind: 'tick'; w: World; me: CarState; track: Track }
  | { kind: 'race'; r: RaceSummary }
  | { kind: 'medal'; track: string; league: League; medal: number; totals: MedalTotals }
  | { kind: 'season'; outcome: SeasonOutcome }
  | { kind: 'publish' }
  /** Every driving school lesson has been passed. */
  | { kind: 'school' };

/** One rule's progress: a number that reaches the goal, a set of keys, and notes for the race at hand. */
export interface Meter {
  get(): number;
  set(n: number): void;
  /** Raise to n if higher. */
  max(n: number): void;
  add(n?: number): void;
  /** Count a distinct key (the value is how many there are). */
  addKey(key: string): void;
  /** Notes that live for one race (cleared at the start of the next). */
  readonly scratch: Record<string, number>;
}

export interface AchievementRule {
  id: string;
  /** Short, in capitals. */
  name: string;
  /** One line, 28 letters or fewer (it fits the banner). */
  desc: string;
  /** Count to reach (default 1); more than 1 shows progress. */
  goal?: number;
  feed(m: Meter, input: AchInput): void;
}

const GAME_TRACKS = TRACK_LIST.length;
const JUMP_M = 40;
const LONG_SHOT = 55;
const LONG_DRIFT_TICKS = 240;

const won = (r: RaceSummary) => r.place === 1 && r.cars >= 2;

export const ACHIEVEMENTS: readonly AchievementRule[] = [
  // The first ten minutes.
  {
    id: 'finish', name: 'OFF THE GRID', desc: 'FINISH A RACE',
    feed: (m, i) => { if (i.kind === 'race') m.set(1); },
  },
  {
    id: 'school', name: 'LICENSED TO DRIFT', desc: 'FINISH THE DRIVING SCHOOL',
    feed: (m, i) => { if (i.kind === 'school') m.set(1); },
  },
  {
    id: 'win', name: 'NUMBER ONE', desc: 'WIN A RACE',
    feed: (m, i) => { if (i.kind === 'race' && won(i.r)) m.set(1); },
  },
  {
    id: 'firstBlood', name: 'FIRST BLOOD', desc: 'WRECK A CAR',
    feed: (m, i) => { if (i.kind === 'event' && i.e.kind === Ev.Wreck && i.e.other === i.me.id && i.e.car !== i.me.id) m.set(1); },
  },
  {
    id: 'airmail', name: 'AIRMAIL', desc: `JUMP ${JUMP_M} M IN ONE LEAP`,
    feed: (m, i) => {
      const s = m.scratch;
      if (i.kind === 'event' && i.e.kind === Ev.Respawn && i.e.car === i.me.id) s.air = 0;
      if (i.kind !== 'tick') return;
      const car = i.me;
      if (car.airborne > 0 && !s.air) {
        s.air = 1;
        s.x = car.x;
        s.z = car.z;
      } else if (car.airborne === 0 && s.air) {
        s.air = 0;
        if (car.wreckTicks === 0 && Math.hypot(car.x - s.x, car.z - s.z) >= JUMP_M) m.set(1);
      }
    },
  },
  {
    id: 'drift', name: 'SIDEWAYS SAM', desc: `HOLD ONE DRIFT FOR ${LONG_DRIFT_TICKS / 60} SECONDS`,
    feed: (m, i) => {
      if (i.kind !== 'tick') return;
      const c = i.me;
      const on = c.sliding > 0 && c.airborne === 0 && c.spinTicks === 0 && c.wreckTicks === 0 && Math.hypot(c.vx, c.vz) > 12;
      m.scratch.t = on ? (m.scratch.t ?? 0) + 1 : 0;
      if (m.scratch.t >= LONG_DRIFT_TICKS) m.set(1);
    },
  },
  {
    id: 'night', name: 'NIGHT RIDER', desc: 'FINISH A RACE AT NIGHT',
    feed: (m, i) => { if (i.kind === 'race' && i.r.night) m.set(1); },
  },
  {
    id: 'lapped', name: 'SEE YOU LATER', desc: 'LAP A SLOWER CAR',
    feed: (m, i) => {
      if (i.kind !== 'tick' || i.me.finished || i.me.wreckTicks > 0) return;
      for (const o of i.w.cars) {
        if (o.id !== i.me.id && !o.finished && i.me.raceDist - o.raceDist > i.track.length && i.me.place < o.place) m.set(1);
      }
    },
  },
  {
    id: 'longBomb', name: 'LONG BOMB', desc: `MISSILE HIT FROM ${LONG_SHOT} M AWAY`,
    feed: (m, i) => {
      if (i.kind !== 'event' || i.e.kind !== Ev.Explosion || i.e.value !== 1 || i.e.other !== i.me.id || i.e.car === i.me.id) return;
      if (Math.hypot(i.e.x - i.me.x, i.e.z - i.me.z) >= LONG_SHOT) m.set(1);
    },
  },
  {
    id: 'heatSeeker', name: 'HEAT SEEKER', desc: 'HIT WITH 3 HOMING MISSILES', goal: 3,
    feed: (m, i) => {
      if (i.kind === 'event' && i.e.kind === Ev.Explosion && i.e.value === 4 && i.e.other === i.me.id && i.e.car !== i.me.id) m.add();
    },
  },
  {
    id: 'notToday', name: 'NOT TODAY', desc: 'BLOCK A HIT WITH A SHIELD',
    feed: (m, i) => { if (i.kind === 'event' && i.e.kind === Ev.ShieldBlock && i.e.car === i.me.id && i.e.other !== i.me.id) m.set(1); },
  },

  // A few evenings.
  {
    id: 'podiums', name: 'PODIUM REGULAR', desc: '10 PODIUM FINISHES', goal: 10,
    feed: (m, i) => { if (i.kind === 'race' && i.r.cars >= 4 && i.r.place <= 3) m.add(); },
  },
  {
    id: 'wrecker', name: 'DEMOLITION DERBY', desc: 'WRECK 3 CARS IN ONE RACE',
    feed: (m, i) => { if (i.kind === 'race' && i.r.kills >= 3) m.set(1); },
  },
  {
    id: 'allLeagues', name: 'CLASS ACT', desc: 'FINISH A RACE IN EACH LEAGUE', goal: 3,
    feed: (m, i) => { if (i.kind === 'race') m.addKey(i.r.league); },
  },
  {
    id: 'comeback', name: 'COMEBACK KID', desc: 'WIN AFTER BEING LAST',
    feed: (m, i) => {
      if (i.kind === 'event' && i.e.kind === Ev.Lap && i.e.car === i.me.id && i.w.cars.length >= 4 && i.me.place === i.w.cars.length) m.scratch.last = 1;
      if (i.kind === 'race' && i.r.live && won(i.r) && m.scratch.last) m.set(1);
    },
  },
  {
    id: 'pacifist', name: 'HANDS OFF', desc: 'WIN WITHOUT FIRING A WEAPON',
    feed: (m, i) => {
      if (i.kind === 'event' && i.e.kind === Ev.Fire && i.e.car === i.me.id) m.scratch.fired = 1;
      if (i.kind === 'race' && i.r.live && i.r.weapons && i.r.cars >= 4 && won(i.r) && !m.scratch.fired) m.set(1);
    },
  },
  {
    id: 'untouched', name: 'UNTOUCHED', desc: 'FINISH WITH UNDER 5% DAMAGE',
    feed: (m, i) => { if (i.kind === 'race' && i.r.cars >= 2 && i.r.laps >= 2 && i.r.damage < 0.05 && !i.r.eliminated) m.set(1); },
  },
  {
    id: 'medalSet', name: 'FULL SET', desc: 'BRONZE, SILVER AND GOLD', goal: 3,
    feed: (m, i) => {
      if (i.kind === 'medal') m.max(+(i.totals.exact[1] > 0) + +(i.totals.exact[2] > 0) + +(i.totals.exact[3] > 0));
    },
  },
  {
    id: 'promoted', name: 'MOVING UP', desc: 'GET PROMOTED IN THE CAREER',
    feed: (m, i) => { if (i.kind === 'season' && i.outcome === 'promoted') m.set(1); },
  },
  {
    id: 'publish', name: 'ARCHITECT', desc: 'PUBLISH A TRACK',
    feed: (m, i) => { if (i.kind === 'publish') m.set(1); },
  },
  {
    id: 'onlineWin', name: 'WORLD CLASS', desc: 'WIN AN ONLINE RACE',
    feed: (m, i) => { if (i.kind === 'race' && i.r.mode === 'online' && won(i.r)) m.set(1); },
  },

  // Weeks.
  {
    id: 'grandTour', name: 'GRAND TOUR', desc: 'WIN ON EVERY TRACK', goal: GAME_TRACKS,
    feed: (m, i) => { if (i.kind === 'race' && won(i.r) && TRACK_LIST.some((t) => t.id === i.r.track)) m.addKey(i.r.track); },
  },
  {
    id: 'wins25', name: 'SERIAL WINNER', desc: 'WIN 25 RACES', goal: 25,
    feed: (m, i) => { if (i.kind === 'race' && won(i.r)) m.add(); },
  },
  {
    id: 'wrecks50', name: 'WRECKING CREW', desc: 'WRECK 50 CARS', goal: 50,
    feed: (m, i) => { if (i.kind === 'event' && i.e.kind === Ev.Wreck && i.e.other === i.me.id && i.e.car !== i.me.id) m.add(); },
  },
  {
    id: 'champion', name: 'MEGACARS CHAMPION', desc: 'WIN DIVISION 1',
    feed: (m, i) => { if (i.kind === 'season' && (i.outcome === 'champion' || i.outcome === 'defended')) m.set(1); },
  },
  {
    id: 'defender', name: 'TITLE DEFENDER', desc: 'DEFEND YOUR TITLE',
    feed: (m, i) => { if (i.kind === 'season' && i.outcome === 'defended') m.set(1); },
  },
  {
    id: 'goldLeague', name: 'GOLD STANDARD', desc: 'ALL GOLD IN ONE LEAGUE', goal: GAME_TRACKS,
    feed: (m, i) => { if (i.kind === 'medal') m.max(Math.max(i.totals.gold.standard, i.totals.gold.super, i.totals.gold.mega)); },
  },
  {
    id: 'goldAll', name: 'MIDAS TOUCH', desc: 'ALL GOLD IN ALL LEAGUES', goal: GAME_TRACKS * 3,
    feed: (m, i) => { if (i.kind === 'medal') m.max(i.totals.gold.standard + i.totals.gold.super + i.totals.gold.mega); },
  },
  // Elimination races.
  {
    id: 'elimWin', name: 'LAST CAR STANDING', desc: 'WIN AN ELIMINATION RACE',
    feed: (m, i) => { if (i.kind === 'race' && i.r.elimination && won(i.r)) m.set(1); },
  },
  {
    id: 'elimSurvivor', name: 'SURVIVOR', desc: 'FINAL TWO FROM LAST ON GRID',
    feed: (m, i) => { if (i.kind === 'race' && i.r.elimination && i.r.cars >= 6 && i.r.start === i.r.cars && i.r.place <= 2) m.set(1); },
  },
];

export const ACHIEVEMENT_IDS: ReadonlySet<string> = new Set(ACHIEVEMENTS.map((a) => a.id));
