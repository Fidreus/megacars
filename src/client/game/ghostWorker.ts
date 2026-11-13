// Re-runs a world record's race off the main thread (a whole practice
// session can take a second or more) and sends back its best lap's ghost.

import { DEFAULT_TUNING } from '../../shared/config/tuning.ts';
import { extractBestLap } from '../../shared/game/ghost.ts';
import type { RaceSpec } from '../../shared/net/protocol.ts';

self.onmessage = (e: MessageEvent<{ id: number; spec: RaceSpec; replay: string }>) => {
  const { id, spec, replay } = e.data;
  try {
    const out = extractBestLap(spec, replay, DEFAULT_TUNING);
    if ('error' in out) self.postMessage({ id, error: out.error });
    else self.postMessage({ id, ticks: out.lap.ticks, data: out.lap.data }, { transfer: [out.lap.data.buffer] });
  } catch {
    self.postMessage({ id, error: 'bad race' });
  }
};
