import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// A compact circuit in the tobacco country: a long start straight, then three
// hairpins stacked like cigars in a box - right, left, right - each a full
// 180° half-circle made for one long, smoking drift. A wide loop up the
// west side brings you back. Ash gums up the exit of the second hairpin.
export const CIGAR_CIRCUIT: TrackDef = {
  id: 'cigars',
  name: 'Cigar Circuit',
  theme: 'cigar',
  width: 19,
  // Wide through the hairpins: 24 m at the apex.
  cornerWiden: 2.5,
  runoff: 4,
  startAt: 0.45,
  laps: 3,
  // Short laps: three for every lap chosen in the menu.
  lapScale: 3,
  seed: 21,
  path: [
    { x: 100, z: 0, r: 26 }, // right: first hairpin, half-circle
    { x: 100, z: 52, r: 26 },
    { x: -50, z: 52, r: 26 }, // left: second hairpin
    { x: -50, z: 104, r: 26 },
    { x: 100, z: 104, r: 26 }, // right: third hairpin
    { x: 100, z: 156, r: 26 },
    { x: -110, z: 156, r: 30 }, // up the west side
    { x: -110, z: 0, r: 30 }, // and onto the start straight
  ],
  patches: [
    // Ash on the way out of the second hairpin.
    { surface: Surface.Gravel, x: -5, z: 104, r: 9 },
  ],
  landmarks: [
    { kind: 'factory', x: 20, z: -75 },
    { kind: 'cigar', x: -75, z: -70 },
    { kind: 'humidor', x: 150, z: -60 },
  ],
};
