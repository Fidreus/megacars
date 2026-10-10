import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// Test circuit for tuning the handling: a long main straight into a tight
// 90° corner (the drift benchmark), a medium gravel corner, a hairpin, a 90°
// left-hander, a long icy sweeper and a fast kink back onto the straight.
export const PROVING_GROUND: TrackDef = {
  id: 'proving',
  name: 'Proving Ground',
  theme: 'countryside',
  width: 12,
  runoff: 3.5,
  startAt: 0.42,
  laps: 3,
  seed: 1,
  path: [
    { x: 280, z: 0, r: 14 }, // A: benchmark 90° right
    { x: 280, z: 150, r: 30 }, // B: gravel 90° right
    { x: 120, z: 150, r: 12 }, // C1: hairpin, first half (left)
    { x: 120, z: 174, r: 12 }, // C2: hairpin, second half (left)
    { x: 200, z: 174, r: 14 }, // D: 90° right
    { x: 200, z: 300, r: 22 }, // E: 90° right onto the bottom straight
    { x: -80, z: 300, r: 150 }, // F: long sweeper (icy)
    { x: -230, z: 120, r: 40 }, // G: fast kink
    { x: -230, z: 0, r: 25 }, // H: onto the main straight
  ],
  patches: [
    { surface: Surface.Gravel, x: 280, z: 150, r: 26, runoff: true },
    { surface: Surface.Ice, x: -74, z: 286, r: 22 },
  ],
};
