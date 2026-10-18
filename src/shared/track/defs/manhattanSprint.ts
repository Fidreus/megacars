import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// A compact Manhattan circuit: a long start straight down the avenue, then two
// long right-hand sweepers around the block, a tight side-street chicane that
// flicks left and right between the towers, and a last right-hander back onto
// the avenue. Wet asphalt on the exit of the chicane.
export const MANHATTAN_SPRINT: TrackDef = {
  id: 'manhattan',
  name: 'Manhattan Sprint',
  theme: 'city',
  width: 19,
  // Wider through the sweepers: 24 m at the apex.
  cornerWiden: 2.5,
  runoff: 4,
  startAt: 0.45,
  laps: 3,
  // Short laps: three for every lap chosen in the menu.
  lapScale: 3,
  seed: 34,
  path: [
    { x: 140, z: 0, r: 60 }, // long right sweeper off the start straight
    { x: 140, z: 170, r: 50 }, // right, along the bottom of the block
    { x: -30, z: 170, r: 45 }, // right, up the side street
    { x: -30, z: 90, r: 35 }, // chicane: left
    { x: -140, z: 90, r: 45 }, // and right up the west avenue
    { x: -140, z: 0, r: 30 }, // right onto the start straight
  ],
  patches: [
    // Wet asphalt where the chicane spits you out.
    { surface: Surface.Wet, x: -82, z: 90, r: 9 },
  ],
  landmarks: [
    { kind: 'tower', x: 40, z: 95 },
    { kind: 'liberty', x: -82, z: 58 },
    { kind: 'board', x: 25, z: 140 },
    { kind: 'subway', x: 0, z: 128 },
  ],
};
