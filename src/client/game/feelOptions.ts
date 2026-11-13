// OPTIONS > GAME FEEL: vibration and slow motion on/off.

import type { MenuItem } from '../ui/menu.ts';
import type { RaceSettings } from './settings.ts';

export function feelItems(s: RaceSettings, save: () => void, onVibration: (on: boolean) => void): MenuItem[] {
  return [
    {
      label: () => `VIBRATION: ${s.vibration !== false ? 'ON' : 'OFF'}`,
      change: () => {
        s.vibration = s.vibration === false;
        onVibration(s.vibration);
        save();
      },
    },
    {
      label: () => `SLOW MOTION ON WRECKS: ${s.slowMotion !== false ? 'ON' : 'OFF'}`,
      change: () => {
        s.slowMotion = s.slowMotion === false;
        save();
      },
    },
  ];
}
