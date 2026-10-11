import { Surface } from '../../config/surfaces.ts';
import type { TrackDef } from '../types.ts';

// Short, wide and busy: a figure of three loops around a brewery, crossing
// itself twice - and both crossings are broken bridges, so every lap jumps
// over the road twice and dives under both jumps. Tight corners in between
// keep the pack together; spilled beer makes a couple of them slippery.
export const BREWERY_BASH: TrackDef = {
  id: 'brewerybash',
  name: 'Brewery Bash',
  theme: 'brewery',
  width: 20,
  runoff: 3,
  startAt: 0.5,
  laps: 4,
  seed: 11,
  path: [
    { x: -85, z: -200, r: 26 }, // left, down the west side of the top loop
    { x: -85, z: -85, r: 40 }, // left, down toward the first jump
    { x: 85, z: 85, r: 26 }, // right after the landing
    { x: -85, z: 255, r: 40 }, // left, under nothing yet: into the bottom loop
    { x: -85, z: 340, r: 24 }, // left
    { x: 30, z: 340, r: 22 }, // right: a kink in the bottom straight
    { x: 50, z: 310, r: 22 }, // left
    { x: 85, z: 310, r: 22 }, // left, up the east side
    { x: 85, z: 255, r: 40 }, // left, up toward the second jump
    { x: -85, z: 85, r: 26 }, // right after the landing
    { x: 85, z: -85, r: 40 }, // left, up into the top loop
    { x: 85, z: -200, r: 26 }, // left onto the start straight
  ],
  patches: [
    // Spilled beer: as slippery as oil.
    { surface: Surface.Oil, x: -70, z: 330, r: 8 },
    { surface: Surface.Oil, x: 75, z: 78, r: 7 },
  ],
  landmarks: [
    { kind: 'brewhouse', x: 0, z: -138 },
    { kind: 'mug', x: 0, z: 88 },
    { kind: 'tent', x: -10, z: 292 },
  ],
  bridges: [
    { x: 0, z: 0, upper: 0, height: 5.5, span: 15, ramp: 40, gap: true },
    { x: 0, z: 170, upper: 1, height: 5.5, span: 15, ramp: 40, gap: true },
  ],
};
