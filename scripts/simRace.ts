// Headless AI races: `npm run sim -- --seeds 20 --laps 3 --track greenvalley [--weapons] [--league super] [--weather rain|changing] [--elimination]`
// `--track all` runs every track; `--league all` every league.
import { DEFAULT_TUNING } from '../src/shared/config/tuning.ts';
import { LEAGUES, leagueOf, leagueTuning } from '../src/shared/game/leagues.ts';
import { simulateRace } from '../src/shared/game/raceSim.ts';
import { TRACKS, TRACK_LIST, DEFAULT_TRACK } from '../src/shared/track/defs/index.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const seeds = Number(arg('seeds', '20'));
const laps = Number(arg('laps', '3'));
const trackArg = arg('track', DEFAULT_TRACK);
const defs = trackArg === 'all' ? TRACK_LIST : [TRACKS[trackArg]];
const weapons = args.includes('--weapons');
const elimination = args.includes('--elimination');
const weather = arg('weather', 'dry') as 'dry' | 'rain' | 'changing';
const leagueArg = arg('league', 'standard');
const leagues = leagueArg === 'all' ? LEAGUES : [leagueOf(leagueArg)];
if (defs.some((d) => !d)) throw new Error('unknown track');

let total = 0;
let totalFailures = 0;
for (const league of leagues) {
  const tuning = leagueTuning(DEFAULT_TUNING, league);
  for (const def of defs) {
    let failures = 0;
    let respawns = 0;
    let raceTime = 0;
    const t0 = performance.now();
    for (let seed = 1; seed <= seeds; seed++) {
      const r = simulateRace(def, seed, { laps, weapons, tuning, weather, league, elimination });
      respawns += r.respawns;
      raceTime += r.raceSeconds;
      const ok = elimination ? !!r.oneWinner : r.finished === r.cars;
      if (!ok) failures++;
      console.log(
        `seed ${String(seed).padStart(2)}  ${ok ? 'OK  ' : 'FAIL'} ` +
          (elimination ? `one winner ${r.oneWinner ? 'yes' : 'NO'}  race ${r.raceSeconds.toFixed(1)}s  leader laps ${r.leaderLaps}  ` : `finished ${r.finished}/${r.cars}  winner ${r.winnerSeconds.toFixed(1)}s  `) +
          `best lap ${r.bestLapSeconds.toFixed(2)}s  respawns ${r.respawns}  wall hits ${r.wallHits}  car hits ${r.carHits}` +
          (weapons ? `  shots ${r.shots}  hits ${r.hits}  wrecks ${r.wrecks}  crates ${r.pickups}` : ''),
      );
    }
    const what = elimination ? 'elimination races ending with one winner' : 'races with every car finishing';
    console.log(`\n${def.name} (${league}): ${seeds - failures}/${seeds} ${what}, average race ${(raceTime / seeds).toFixed(0)} s, ${respawns} respawns, ${((performance.now() - t0) / 1000).toFixed(1)} s wall time\n`);
    total += seeds;
    totalFailures += failures;
  }
}
if (total > seeds) console.log(`ALL: ${total - totalFailures}/${total} OK`);
process.exit(totalFailures ? 1 : 0);
