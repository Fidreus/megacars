import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// Winter: fast and flowing, but nothing grips quite like it should. Ice on
// the exit of the big sweeper, packed snow in the left-hander and on the
// hairpin, deep snow beyond the road edge.
export const FROST_RING: TrackDef = {
  id: 'frostring',
  name: 'Frost Ring',
  theme: 'winter',
  width: 17,
  runoff: 6,
  runoffSurface: Surface.Snow,
  startAt: 0.4,
  laps: 3,
  seed: 5,
  path: [
    { x: 400, z: 0, r: 60 }, // A: right
    { x: 400, z: 220, r: 90 }, // B: big right sweeper (icy exit)
    { x: 100, z: 220, r: 30 }, // C: left
    { x: 100, z: 330, r: 40 }, // D: right
    { x: -250, z: 330, r: 70 }, // E: right
    { x: -250, z: 120, r: 35 }, // F: right
    { x: -80, z: 120, r: 30 }, // G: left
    { x: -80, z: 0, r: 30 }, // H: right onto the start straight
  ],
  patches: [
    { surface: Surface.Ice, x: 300, z: 222, r: 24 },
    { surface: Surface.Snow, x: 108, z: 230, r: 18 },
    { surface: Surface.Ice, x: -160, z: 330, r: 16 },
    { surface: Surface.Snow, x: -88, z: 112, r: 20 },
  ],
};
