import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// Through a nuclear power plant: a start straight between the cooling
// towers, a tight chicane round the reactor halls, a coolant leak in the
// fast corner, and a jump over the coolant channel on the long back straight
// (come up short and you wade out). All concrete, no run-off grass.
export const MELTDOWN: TrackDef = {
  id: 'meltdown',
  name: 'Meltdown Ridge',
  theme: 'nuclear',
  width: 18,
  runoff: 5,
  runoffSurface: Surface.Asphalt,
  startAt: 0.4,
  laps: 3,
  seed: 7,
  path: [
    { x: 420, z: 0, r: 35 }, // A: right, past the turbine hall
    { x: 420, z: 180, r: 25 }, // B: right into the reactor complex
    { x: 300, z: 180, r: 20 }, // C: left (chicane)
    { x: 300, z: 300, r: 20 }, // D: left
    { x: 460, z: 300, r: 40 }, // E: right (coolant leak)
    { x: 460, z: 460, r: 50 }, // F: right onto the back straight
    { x: -200, z: 460, r: 60 }, // G: right after the jump
    { x: -200, z: 120, r: 30 }, // H: right
    { x: -60, z: 120, r: 22 }, // I: left
    { x: -60, z: 0, r: 22 }, // J: right onto the start straight
  ],
  patches: [
    { surface: Surface.Wet, x: 470, z: 330, r: 22, runoff: true },
    { surface: Surface.Oil, x: 452, z: 372, r: 6 },
    // The coolant channel under the jump.
    { surface: Surface.ShallowWater, x: 84, z: 460, r: 0, hx: 9, hz: 20, runoff: true },
    { surface: Surface.Wet, x: -130, z: 120, r: 16 },
  ],
  ramps: [{ x: 112, z: 460, length: 11, height: 1.7 }],
};
