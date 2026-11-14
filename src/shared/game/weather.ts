// Which weather a race gets: from the menu choice, the room, or the season's
// seed, and the plan the simulation follows (see sim/weather.ts).

import { hash3 } from '../math/rng.ts';
import type { RaceSpec } from '../net/protocol.ts';
import type { Track } from '../track/types.ts';
import { makeWeatherPlan, type Weather, type WeatherPlan } from '../sim/weather.ts';
import { leagueOf, type League } from './leagues.ts';

export type { Weather } from '../sim/weather.ts';

/** What the menus offer: a weather, or RANDOM (decided per race). */
export type WeatherChoice = Weather | 'random';

export const WEATHER_CHOICES: readonly WeatherChoice[] = ['dry', 'rain', 'changing', 'random'];

/** A race's weather from its spec (absent or unknown = dry). */
export function weatherOf(spec: Pick<RaceSpec, 'weather'> | null | undefined): Weather {
  const w = spec?.weather;
  return w === 'rain' || w === 'changing' ? w : 'dry';
}

export function weatherChoiceOf(v: unknown): WeatherChoice {
  return WEATHER_CHOICES.includes(v as WeatherChoice) ? (v as WeatherChoice) : 'dry';
}

/** RANDOM: dry a bit more often than not. */
export function pickWeather(choice: unknown, seed: number): Weather {
  const c = weatherChoiceOf(choice);
  if (c !== 'random') return c;
  const r = hash3(seed, 71, 4243);
  return r < 0.45 ? 'dry' : r < 0.72 ? 'rain' : 'changing';
}

/** Championship and career races: mostly dry, about one in four wet or changing. */
export function seasonWeather(seed: number, race: number): Weather {
  const r = hash3(seed, race, 4244);
  return r < 0.75 ? 'dry' : r < 0.87 ? 'rain' : 'changing';
}

/** The spec field: absent when dry, so dry specs stay as they were. */
export function weatherField(w: Weather): { weather?: Weather } {
  return w === 'dry' ? {} : { weather: w };
}

/** A front runner's average speed in each league (m/s), measured with the simulator. */
const LEAGUE_PACE: Record<League, number> = { standard: 40, super: 51, mega: 59 };

/** Roughly how long a race of this spec takes (ticks): the rain in a changing race is placed in it. */
export function expectedRaceTicks(track: Track, spec: Pick<RaceSpec, 'laps' | 'league'>): number {
  const laps = spec.laps > 0 ? spec.laps : 3;
  return Math.round((laps * track.length * 60) / LEAGUE_PACE[leagueOf(spec.league)]);
}

export function weatherPlanFor(spec: RaceSpec, track: Track): WeatherPlan | undefined {
  const w = weatherOf(spec);
  if (w === 'dry') return undefined;
  return makeWeatherPlan(w, spec.seed, spec.countdownTicks, expectedRaceTicks(track, spec));
}
