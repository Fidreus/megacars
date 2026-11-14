// Headless AI races: `npm run sim -- --seeds 20 --laps 3 --track greenvalley [--weapons] [--league super]`
import { DEFAULT_TUNING } from '../src/shared/config/tuning.ts';
import { leagueOf, leagueTuning } from '../src/shared/game/leagues.ts';
import { simulateRace } from '../src/shared/game/raceSim.ts';
import { TRACKS, DEFAULT_TRACK } from '../src/shared/track/defs/index.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const seeds = Number(arg('seeds', '20'));
const laps = Number(arg('laps', '3'));
const def = TRACKS[arg('track', DEFAULT_TRACK)];
const weapons = args.includes('--weapons');
const tuning = leagueTuning(DEFAULT_TUNING, leagueOf(arg('league', 'standard')));
if (!def) throw new Error('unknown track');

let failures = 0;
let respawns = 0;
const t0 = performance.now();
for (let seed = 1; seed <= seeds; seed++) {
  const r = simulateRace(def, seed, { laps, weapons, tuning });
  respawns += r.respawns;
  const ok = r.finished === r.cars;
  if (!ok) failures++;
  console.log(
    `seed ${String(seed).padStart(2)}  ${ok ? 'OK  ' : 'FAIL'} finished ${r.finished}/${r.cars}  ` +
      `winner ${r.winnerSeconds.toFixed(1)}s  best lap ${r.bestLapSeconds.toFixed(2)}s  ` +
      `respawns ${r.respawns}  wall hits ${r.wallHits}  car hits ${r.carHits}` +
      (weapons ? `  shots ${r.shots}  hits ${r.hits}  wrecks ${r.wrecks}  crates ${r.pickups}` : ''),
  );
}
console.log(`\n${def.name}: ${seeds - failures}/${seeds} races with every car finishing, ${respawns} respawns, ${((performance.now() - t0) / 1000).toFixed(1)} s wall time`);
process.exit(failures ? 1 : 0);
