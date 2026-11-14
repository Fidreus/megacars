// Offline championship: one race on every track, points and prize money
// after each, the shop in between. Saved in localStorage so it can be
// continued later.

import { leagueOf, type League } from '../../shared/game/leagues.ts';
import { AI_NAMES, AI_SKILL, CAR_COLORS } from '../../shared/game/roster.ts';
import {
  aiLoadout, averageLevel, loadoutOf, newProfile, raceResults, settle, type Profile,
} from '../../shared/game/shop.ts';
import { makeRng } from '../../shared/math/rng.ts';
import type { Entrant, RaceSpec } from '../../shared/net/protocol.ts';
import { COUNTDOWN_TICKS, type World } from '../../shared/sim/world.ts';
import { TRACK_LIST, raceLaps } from '../../shared/track/defs/index.ts';
import type { StandingsRow } from '../ui/screens/shop.ts';
import type { RaceSettings } from './settings.ts';
import { driverNotes, recordDuel, type Duel } from './rival.ts';
import { seasonWeather, weatherField, type Weather } from '../../shared/game/weather.ts';

const KEY = 'megacars.cup.v1';

export interface CupDriver {
  name: string;
  color: string;
  /** Local player index (0/1), or -1 for a computer driver. */
  player: number;
  skill: number;
  profile: Profile;
  /** Place in the latest race (0 = none yet). */
  lastPlace: number;
}

export interface Championship {
  version: 1;
  tracks: string[];
  /** Index of the next race to run (= races done). */
  race: number;
  laps: number;
  difficulty: number;
  weapons: boolean;
  /** Car class for the whole championship (older saves: standard). */
  league?: League;
  seed: number;
  drivers: CupDriver[];
  /** Driver index for each car of the race being run. */
  grid: number[];
  /** Career: driver index of the season's rival, and the head-to-head so far. */
  rival?: number;
  duel?: Duel;
}

export function newChampionship(s: RaceSettings): Championship {
  const seed = Date.now() & 0xffff;
  const rnd = makeRng(seed);
  const names = [...AI_NAMES].sort(() => rnd() - 0.5);
  const drivers: CupDriver[] = [];
  const ai = Math.max(1, Math.min(8 - s.players, s.opponents));
  for (let k = 0; k < ai; k++) {
    drivers.push({
      name: names[k % names.length],
      color: CAR_COLORS[(2 + k) % CAR_COLORS.length],
      player: -1,
      skill: AI_SKILL[s.difficulty],
      profile: newProfile(),
      lastPlace: 0,
    });
  }
  for (let p = 0; p < s.players; p++) {
    drivers.push({
      name: s.players === 1 ? 'YOU' : `P${p + 1}`,
      color: CAR_COLORS[p],
      player: p,
      skill: AI_SKILL[1],
      profile: newProfile(),
      lastPlace: 0,
    });
  }
  return {
    version: 1,
    tracks: TRACK_LIST.map((t) => t.id),
    race: 0,
    laps: s.laps,
    difficulty: s.difficulty,
    weapons: s.weapons,
    league: s.league,
    seed,
    drivers,
    grid: [],
  };
}

export function isOver(c: Championship): boolean {
  return c.race >= c.tracks.length;
}

/** The people's profiles, P1 first. */
export function humanDrivers(c: Championship): CupDriver[] {
  return c.drivers.filter((d) => d.player >= 0).sort((a, b) => a.player - b.player);
}

/** The next race: fewest points start at the front, the leader at the back. */
export function nextRaceSpec(c: Championship): RaceSpec {
  const order = c.drivers.map((_, i) => i).sort((a, b) => c.drivers[a].profile.points - c.drivers[b].profile.points || a - b);
  c.grid = order;
  const rnd = makeRng(c.seed + c.race * 101);
  const level = averageLevel(humanDrivers(c).map((d) => d.profile));
  const entrants: Entrant[] = order.map((i) => {
    const d = c.drivers[i];
    const loadout = d.player >= 0 ? loadoutOf(d.profile) : aiLoadout(level, c.difficulty, rnd);
    // The rival goes for player 1 a little harder.
    const rival = i === c.rival ? { rival: 0 } : {};
    return { name: d.name, color: d.color, playerId: d.player, skill: d.skill, loadout, ...rival };
  });
  return {
    id: c.race + 1,
    track: c.tracks[c.race],
    laps: raceLaps(c.tracks[c.race], c.laps),
    seed: c.seed + c.race,
    countdownTicks: COUNTDOWN_TICKS,
    weapons: c.weapons,
    entrants,
    league: leagueOf(c.league),
    ...weatherField(cupWeather(c)),
  };
}

/** The next race's weather, decided by the season's seed (mostly dry). */
export function cupWeather(c: Championship): Weather {
  return seasonWeather(c.seed, c.race);
}

/** Points and prize money once a race is over. */
export function settleRace(c: Championship, world: World): void {
  for (const r of raceResults(world)) {
    const d = c.drivers[c.grid[r.car]];
    d.lastPlace = r.place;
    if (d.player >= 0) {
      settle(d.profile, world, r);
    } else {
      d.profile.points += r.points;
      d.profile.lastEarned = r.prize + r.bonus - r.tow;
      if (r.place === 1) d.profile.wins++;
    }
  }
  recordDuel(c);
  c.race++;
}

export function standingsRows(c: Championship): StandingsRow[] {
  return c.drivers.map((d) => ({
    name: d.name,
    color: d.color,
    points: d.profile.points,
    earned: d.profile.lastEarned,
    racePlace: d.lastPlace,
    human: d.player >= 0,
    ...driverNotes(d),
    rival: c.rival !== undefined && c.drivers[c.rival] === d,
  }));
}

/** The overall leader (ties: more wins). */
export function leader(c: Championship): CupDriver {
  return [...c.drivers].sort((a, b) => b.profile.points - a.profile.points || b.profile.wins - a.profile.wins)[0];
}

export function saveCup(c: Championship | null): void {
  try {
    if (c && !isOver(c)) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // Not saved; the cup still works this session.
  }
}

export function loadCup(): Championship | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Championship;
    if (c.version !== 1 || !Array.isArray(c.drivers) || isOver(c)) return null;
    return c;
  } catch {
    return null;
  }
}
