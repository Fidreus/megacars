import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// A pretzel of three loops that crosses itself twice. Out of the start the
// road climbs to a broken bridge and jumps the gap over the road below (too
// slow and you drop into the hole); on the way back you dive under that very
// jump. Later the lap passes under a viaduct and comes home over the top of it.
export const TWIN_BRIDGES: TrackDef = {
  id: 'twinbridges',
  name: 'Twin Bridges',
  theme: 'countryside',
  width: 15,
  runoff: 4,
  startAt: 0.55,
  laps: 3,
  seed: 5,
  path: [
    { x: 300, z: -100, r: 60 }, // right, down toward the jump
    { x: 500, z: 100, r: 60 }, // left after the landing
    { x: 670, z: 100, r: 36 }, // left
    { x: 670, z: -100, r: 36 }, // left
    { x: 500, z: -100, r: 60 }, // left, down under the jump
    { x: 300, z: 100, r: 60 }, // right
    { x: 100, z: 100, r: 60 }, // right, under the viaduct
    { x: -100, z: -100, r: 60 }, // left
    { x: -270, z: -100, r: 34 }, // left
    { x: -270, z: 100, r: 34 }, // left
    { x: -100, z: 100, r: 60 }, // left, up onto the viaduct
    { x: 100, z: -100, r: 60 }, // right onto the start straight
  ],
  patches: [
    { surface: Surface.Gravel, x: -262, z: 92, r: 22, runoff: true },
    { surface: Surface.Oil, x: 670, z: 0, r: 7 },
  ],
  bridges: [
    { x: 400, z: 0, upper: 0, height: 5.5, span: 14, ramp: 45, gap: true },
    { x: 0, z: 0, upper: 1, height: 5.5, span: 15, ramp: 45 },
  ],
};
