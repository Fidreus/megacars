// Worker thread: replays submitted races to measure their laps, away from
// the main thread that runs the online races (a replay takes up to ~1 s).

import { parentPort } from 'node:worker_threads';
import { DEFAULT_TUNING } from '../shared/config/tuning.ts';
import { replayLaps } from '../shared/game/records.ts';
import type { RaceSpec } from '../shared/net/protocol.ts';

parentPort?.on('message', (job: { id: number; spec: RaceSpec; replay: string }) => {
  let result: { laps: number[] } | { error: string };
  try {
    result = replayLaps(job.spec, job.replay, DEFAULT_TUNING);
  } catch {
    result = { error: 'bad race' };
  }
  parentPort?.postMessage({ id: job.id, result });
});
