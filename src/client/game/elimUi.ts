// Elimination races in the menus: the single race MODE setting, the room's
// mode, and how the laps setting reads when it does not apply.

import { RACE_MODES, raceModeOf, type RaceMode } from '../../shared/game/raceMode.ts';
import type { RoomConfig } from '../../shared/net/protocol.ts';
import { elimEvery } from '../../shared/sim/elimination.ts';
import { getTrack } from '../../shared/track/builder.ts';
import { trackDef } from '../../shared/track/defs/index.ts';
import { cycle, type MenuItem } from '../ui/menu.ts';
import type { RaceSettings } from './settings.ts';

export function modeName(m: RaceMode): string {
  return m === 'elimination' ? 'ELIMINATION' : 'RACE';
}

/** Leader laps between eliminations on a track (0 if the track is unknown here). */
export function trackElimEvery(trackId: string): number {
  const def = trackDef(trackId);
  return def ? elimEvery(getTrack(def).length) : 0;
}

/** "EVERY LAP" / "EVERY 3 LAPS" ('' if unknown). */
export function everyText(every: number): string {
  return every === 1 ? 'EVERY LAP' : every > 1 ? `EVERY ${every} LAPS` : '';
}

/** Single race: MODE: RACE / ELIMINATION. */
export function raceModeItem(s: RaceSettings, changed: () => void): MenuItem {
  return {
    label: () => `MODE: ${modeName(raceModeOf(s.mode))}`,
    change: (d: number) => {
      s.mode = RACE_MODES[cycle(RACE_MODES.indexOf(raceModeOf(s.mode)), RACE_MODES.length, d)];
      changed();
    },
  };
}

/** What the LAPS line says in an elimination race (null in a normal one). */
export function elimLapsLabel(mode: unknown, trackId: string): string | null {
  // Short: the interval shows on the HUD and in the lobby summary.
  return raceModeOf(mode) === 'elimination' && trackId !== null ? 'LAPS: - (ELIMINATION)' : null;
}

/** The room's mode (public rooms always race). */
export function roomMode(cfg: RoomConfig | undefined): RaceMode {
  return cfg?.public ? 'race' : raceModeOf(cfg?.mode);
}

export function roomModeItem(cfg: () => RoomConfig | undefined, notHost: () => boolean, configure: (c: Partial<RoomConfig>) => void): MenuItem {
  return {
    label: () => `MODE: ${modeName(roomMode(cfg()))}${cfg()?.public ? ' (PUBLIC ROOM)' : ''}`,
    disabled: () => notHost() || !!cfg()?.public,
    change: (d: number) => {
      const i = RACE_MODES.indexOf(roomMode(cfg()));
      configure({ mode: RACE_MODES[cycle(i, RACE_MODES.length, d)] });
    },
  };
}

/** The lobby summary's laps part in an elimination room (null in a normal one). */
export function roomElimNote(cfg: RoomConfig): string | null {
  if (roomMode(cfg) !== 'elimination') return null;
  const every = everyText(trackElimEvery(cfg.track));
  return every ? `ELIMINATION - OUT ${every}` : 'ELIMINATION';
}
