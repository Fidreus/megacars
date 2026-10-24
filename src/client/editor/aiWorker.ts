// The editor's AI TEST, off the main thread: eight computer cars race the
// track (two short races) and the verdict comes back as one line.

import { simulateRace } from '../../shared/game/raceSim.ts';
import { decodeTrack } from '../../shared/track/custom.ts';

self.onmessage = (e: MessageEvent<{ code: string }>) => {
  const def = decodeTrack(e.data.code);
  if (!def) {
    self.postMessage({ ok: false, text: 'AI TEST: NOT A TRACK' });
    return;
  }
  try {
    const races = [1, 2].map((seed) => simulateRace(def, seed, { laps: 2 }));
    const finished = races.reduce((a, r) => a + r.finished, 0);
    const cars = races.reduce((a, r) => a + r.cars, 0);
    const best = Math.min(...races.map((r) => r.bestLapSeconds));
    const walls = Math.round(races.reduce((a, r) => a + r.wallHits, 0) / races.length / 8);
    const resets = races.reduce((a, r) => a + r.respawns, 0);
    const ok = finished === cars;
    self.postMessage({
      ok,
      text: `${ok ? 'AI TEST OK' : `AI TEST: ONLY ${finished} OF ${cars} CARS FINISHED`} - BEST LAP ${Number.isFinite(best) ? best.toFixed(1) : '-'} S - ${walls} WALL HITS A CAR - ${resets} RESETS`,
    });
  } catch {
    self.postMessage({ ok: false, text: 'AI TEST: THE TRACK BROKE THE RACE' });
  }
};
