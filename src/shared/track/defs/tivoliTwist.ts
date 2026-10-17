import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// A compact fun-fair circuit for a few players and many laps: a short start
// straight, a quick right-left kink, then a roller-coaster wave of four
// alternating 90° bends - left, right, left, right - made for linking
// drifts, and back up the side past the fairground. Spilled lemonade makes
// one bend of the wave slippery.
export const TIVOLI_TWIST: TrackDef = {
  id: 'tivoli',
  name: 'Tivoli Twist',
  theme: 'tivoli',
  width: 19,
  // Wider still through the bends: 24 m at the apex.
  cornerWiden: 2.5,
  runoff: 4,
  startAt: 0.45,
  laps: 3,
  // Short laps: three for every lap chosen in the menu.
  lapScale: 3,
  seed: 13,
  path: [
    { x: 90, z: 0, r: 24 }, // right, off the start straight
    { x: 90, z: 45, r: 18 }, // kink: left
    { x: 150, z: 45, r: 18 }, // and right again
    { x: 150, z: 110, r: 24 }, // right into the wave
    { x: 105, z: 155, r: 22 }, // the wave: right,
    { x: 55, z: 105, r: 22 }, // left,
    { x: 5, z: 155, r: 22 }, // right,
    { x: -45, z: 105, r: 22 }, // left,
    { x: -95, z: 155, r: 22 }, // right
    { x: -125, z: 110, r: 22 }, // up the side
    { x: -125, z: 0, r: 24 }, // right onto the start straight
  ],
  patches: [
    // Spilled lemonade.
    { surface: Surface.Wet, x: 5, z: 150, r: 9 },
  ],
  landmarks: [
    { kind: 'ferriswheel', x: 5, z: 64 },
    { kind: 'carousel', x: -80, z: 55 },
    { kind: 'bigtop', x: 115, z: 85 },
  ],
};
