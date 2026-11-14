import type { TrackDef } from '../types.ts';

// The driving school's circuit (client/game/school). Not in TRACK_LIST: it is
// never raced, so it has no records, medals or place in the championship or the
// daily rotation. It is registered by the school only. Right turns all the way
// round but one: a medium corner, a hairpin, a left turn and a long sweeper.
export const SCHOOL_ID = 'school';

export const SCHOOL: TrackDef = {
  id: SCHOOL_ID,
  name: 'Driving School',
  theme: 'countryside',
  width: 16,
  runoff: 6,
  startAt: 0.3,
  seed: 3,
  path: [
    { x: 520, z: 0, r: 42 }, // medium corner, 90° right
    { x: 520, z: 280, r: 18 }, // hairpin, first half
    { x: 484, z: 280, r: 18 }, // hairpin, second half
    { x: 484, z: 100, r: 42 }, // 90° left
    { x: 0, z: 100, r: 50 }, // sweeper, first half
    { x: 0, z: 0, r: 50 }, // sweeper, second half
  ],
};
