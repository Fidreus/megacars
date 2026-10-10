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
  /** Missiles, mines, turbo and damage. */
  weapons: boolean;
  /** 0 a song per track, 1 shuffle, 2 off. */
  musicMode: number;
  /** 0..10 */
  musicVolume: number;
  soundVolume: number;
  /** 0 automatic, 1 high, 2 medium, 3 low. */
  graphics: number;
  /** Touch gas: while the steering thumb is down, always, or a gas button. */
  touchGas: 'thumb' | 'always' | 'button';
  /** Older saves: automatic gas on/off. */
  touchAutoGas?: boolean;
  /** Touch steering: drag the left thumb, or two arrow buttons. */
  touchSteer: 'slide' | 'buttons';
  /** Bumped when the default volumes change, so saved settings pick them up once. */
  audioRev?: number;
}

/** Current default-volume revision (2: music starts on the second lowest step). */
const AUDIO_REV = 2;

export const DEFAULT_SETTINGS: RaceSettings = {
  track: DEFAULT_TRACK,
  players: 1,
  opponents: 7,
  laps: 3,
  difficulty: 1,
  mood: 'day',
  practice: false,
  weapons: true,
  musicMode: 0,
  musicVolume: 1,
  soundVolume: 7,
  graphics: 0,
  touchGas: 'thumb',
  touchSteer: 'slide',
  audioRev: AUDIO_REV,
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
  s.weapons = s.weapons !== false;
  s.musicMode = [0, 1, 2].includes(s.musicMode) ? s.musicMode : 0;
  if ((s.audioRev ?? 1) < AUDIO_REV) {
    s.musicVolume = DEFAULT_SETTINGS.musicVolume;
    s.audioRev = AUDIO_REV;
  }
  s.musicVolume = Math.max(0, Math.min(10, Math.round(s.musicVolume)));
  s.soundVolume = Math.max(0, Math.min(10, Math.round(s.soundVolume)));
  s.graphics = [0, 1, 2, 3].includes(s.graphics) ? s.graphics : 0;
  if (!['thumb', 'always', 'button'].includes(s.touchGas)) s.touchGas = s.touchAutoGas === false ? 'button' : 'thumb';
  delete s.touchAutoGas;
  s.touchSteer = s.touchSteer === 'buttons' ? 'buttons' : 'slide';
  return s;
}

export function saveSettings(s: RaceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not fatal; settings just won't be remembered.
  }
}
