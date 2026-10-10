import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// Desert: narrower and more technical. A tight right-left chicane after the
// first corner, a fast sweeper, then a twisty infield with an oil slick and
// sandy corners before the long run back to the line.
export const DUST_BOWL: TrackDef = {
  id: 'dustbowl',
  name: 'Dust Bowl',
  theme: 'desert',
  width: 16,
  runoff: 5,
  runoffSurface: Surface.Gravel,
  startAt: 0.45,
  laps: 3,
  seed: 3,
  path: [
    { x: 300, z: 0, r: 30 }, // A: right at the end of the start straight
    { x: 300, z: 140, r: 22 }, // B: right
    { x: 180, z: 140, r: 18 }, // C: left (chicane)
    { x: 180, z: 260, r: 26 }, // D: left
    { x: 380, z: 260, r: 40 }, // E: right
    { x: 380, z: 420, r: 60 }, // F: long right onto the back straight
    { x: -60, z: 420, r: 30 }, // G: right
    { x: -60, z: 300, r: 20 }, // H: right
    { x: 60, z: 300, r: 20 }, // I: left
    { x: 60, z: 160, r: 24 }, // J: left
    { x: -200, z: 160, r: 35 }, // K: right
    { x: -200, z: 0, r: 40 }, // L: right onto the start straight
  ],
  patches: [
    { surface: Surface.Gravel, x: 186, z: 150, r: 22, runoff: true },
    { surface: Surface.Oil, x: 20, z: 420, r: 9 },
    { surface: Surface.Gravel, x: -52, z: 292, r: 20, runoff: true },
    { surface: Surface.Oil, x: 60, z: 230, r: 7 },
  ],
};
