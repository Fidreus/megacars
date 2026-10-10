import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// The first track: wide and forgiving, with generous run-off. A long main
// straight into a 90° right-hander, a gravel corner, a wide U-turn, two more
// 90s, a long sweeper with ice on the exit and a fast kink home.
export const GREEN_VALLEY: TrackDef = {
  id: 'greenvalley',
  name: 'Green Valley',
  theme: 'countryside',
  width: 18,
  runoff: 6,
  startAt: 0.42,
  laps: 3,
  seed: 1,
  path: [
    { x: 360, z: 0, r: 28 }, // A: 90° right at the end of the main straight
    { x: 360, z: 200, r: 40 }, // B: gravel 90° right
    { x: 150, z: 200, r: 24 }, // C1: U-turn, first half (left)
    { x: 150, z: 248, r: 24 }, // C2: U-turn, second half (left)
    { x: 250, z: 248, r: 26 }, // D: 90° right
    { x: 250, z: 400, r: 32 }, // E: 90° right onto the bottom straight
    { x: -100, z: 400, r: 180 }, // F: long sweeper (icy exit)
    { x: -290, z: 170, r: 60 }, // G: fast kink
    { x: -290, z: 0, r: 34 }, // H: onto the main straight
  ],
  patches: [
    { surface: Surface.Gravel, x: 345, z: 185, r: 34, runoff: true },
    { surface: Surface.Ice, x: -168, z: 340, r: 26 },
  ],
};
