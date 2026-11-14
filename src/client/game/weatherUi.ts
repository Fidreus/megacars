// Weather in the menus: the single race setting, the room's race setting,
// and how a race's weather is named (snow instead of rain on a winter track).

import { WEATHER_CHOICES, weatherChoiceOf, weatherOf, type Weather, type WeatherChoice } from '../../shared/game/weather.ts';
import type { RaceSpec, RoomConfig } from '../../shared/net/protocol.ts';
import { trackDef } from '../../shared/track/defs/index.ts';
import { themeOf } from '../render/theme.ts';
import { cycle, type MenuItem } from '../ui/menu.ts';
import type { RaceSettings } from './settings.ts';
import { cupWeather, type Championship } from './championship.ts';

/** True where it snows instead of rains. */
export function snowyTrack(trackId: string): boolean {
  const def = trackDef(trackId);
  return !!def && !!themeOf(def.theme).snow;
}

export function weatherName(w: WeatherChoice, snowy = false): string {
  if (w === 'rain') return snowy ? 'SNOW' : 'RAIN';
  if (w === 'changing') return 'CHANGING';
  return w === 'random' ? 'RANDOM' : 'DRY';
}

/** Single race: WEATHER: DRY / RAIN / CHANGING / RANDOM. */
export function weatherSettingItem(s: RaceSettings, changed: () => void): MenuItem {
  return {
    label: () => `WEATHER: ${weatherName(weatherChoiceOf(s.weather), snowyTrack(s.track))}`,
    change: (d: number) => {
      s.weather = WEATHER_CHOICES[cycle(WEATHER_CHOICES.indexOf(weatherChoiceOf(s.weather)), WEATHER_CHOICES.length, d)];
      changed();
    },
  };
}

/** The room's weather (public rooms always pick one at random). */
export function roomWeather(cfg: RoomConfig | undefined): WeatherChoice {
  return cfg?.public ? 'random' : weatherChoiceOf(cfg?.weather);
}

export function roomWeatherItem(cfg: () => RoomConfig | undefined, notHost: () => boolean, configure: (c: Partial<RoomConfig>) => void): MenuItem {
  return {
    label: () => `WEATHER: ${weatherName(roomWeather(cfg()), snowyTrack(cfg()?.track ?? ''))}${cfg()?.public ? ' (PUBLIC ROOM)' : ''}`,
    disabled: () => notHost() || !!cfg()?.public,
    change: (d: number) => {
      const i = WEATHER_CHOICES.indexOf(roomWeather(cfg()));
      configure({ weather: WEATHER_CHOICES[cycle(i, WEATHER_CHOICES.length, d)] });
    },
  };
}

/** For a one-line summary: '' when dry. */
export function weatherNote(w: WeatherChoice, snowy = false): string {
  return w === 'dry' ? '' : weatherName(w, snowy);
}

/** A race's weather for the screen before it: '' when dry. */
export function raceWeatherNote(spec: Pick<RaceSpec, 'weather' | 'track'>): string {
  const w: Weather = weatherOf(spec);
  return w === 'dry' ? '' : weatherName(w, snowyTrack(spec.track));
}

/** After the championship race title: ' - RAIN' (nothing when dry). */
export function cupWeatherNote(cup: Championship): string {
  const n = raceWeatherNote({ weather: cupWeather(cup), track: cup.tracks[cup.race] ?? '' });
  return n ? ` - ${n}` : '';
}
