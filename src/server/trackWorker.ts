// Worker thread: checks player tracks (a share code) away from the main
// thread that runs the online races. A full build takes a few hundred ms, so
// it is done here too and the built track sent back to be cached; the AI test
// (for publishing) races eight computer cars round it.

import { parentPort } from 'node:worker_threads';
import { simulateRace } from '../shared/game/raceSim.ts';
import { buildTrack } from '../shared/track/builder.ts';
import { checkTrackDef, decodeTrack } from '../shared/track/custom.ts';
import type { Track, TrackDef } from '../shared/track/types.ts';

export interface TrackJob {
  id: number;
  code: string;
  /** Send the fully built track back. */
  build?: boolean;
  /** Race the AI round it: every car must finish. */
  ai?: boolean;
}

export type TrackJobResult =
  | { id: number; error: string }
  | { id: number; def: TrackDef; length: number; track?: Track; bestLap?: number };

parentPort?.on('message', (job: TrackJob) => {
  let result: TrackJobResult;
  try {
    const def = decodeTrack(job.code);
    if (!def) result = { id: job.id, error: 'not a track' };
    else {
      const check = checkTrackDef(def);
      const problem = check.errors[0] ?? check.missing[0];
      if (problem) result = { id: job.id, error: problem };
      else {
        let bestLap: number | undefined;
        if (job.ai) {
          const races = [1, 2].map((seed) => simulateRace(def, seed, { laps: 2 }));
          const unfinished = races.reduce((a, r) => a + r.cars - r.finished, 0);
          bestLap = Math.min(...races.map((r) => r.bestLapSeconds));
          if (unfinished) {
            parentPort?.postMessage({ id: job.id, error: 'the computer cars cannot get round it' } satisfies TrackJobResult);
            return;
          }
        }
        result = { id: job.id, def, length: check.track.length, track: job.build ? buildTrack(def) : undefined, bestLap };
      }
    }
  } catch {
    result = { id: job.id, error: 'the track does not build' };
  }
  parentPort?.postMessage(result);
});
