// Race settings chosen in the menu, remembered between visits.

import { DEFAULT_TRACK, TRACKS } from '../../shared/track/defs/index.ts';

export const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD'] as const;

export interface RaceSettings {
  track: string;
  players: 1 | 2;
  opponents: number;
  laps: number;
  difficulty: number;
  mood: string;
  /** Free practice: no laps to finish, no countdown. */
  practice: boolean;
}

export const DEFAULT_SETTINGS: RaceSettings = {
  track: DEFAULT_TRACK,
  players: 1,
  opponents: 7,
  laps: 3,
  difficulty: 1,
  mood: 'day',
  practice: false,
};

const KEY = 'megacars.settings.v1';

export function loadSettings(): RaceSettings {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
  } catch {
    // Storage blocked or corrupt: use defaults.
  }
  if (!TRACKS[s.track]) s.track = DEFAULT_TRACK;
  s.players = s.players === 2 ? 2 : 1;
  s.opponents = Math.max(0, Math.min(8 - s.players, Math.round(s.opponents)));
  s.laps = Math.max(1, Math.min(9, Math.round(s.laps)));
  s.difficulty = Math.max(0, Math.min(2, Math.round(s.difficulty)));
  return s;
}

export function saveSettings(s: RaceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not fatal; settings just won't be remembered.
  }
}
