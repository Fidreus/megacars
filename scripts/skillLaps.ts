// Solo AI lap times per skill: `node scripts/skillLaps.ts [--league super]`
import { DT } from '../src/shared/config/constants.ts';
import { DEFAULT_TUNING } from '../src/shared/config/tuning.ts';
import { leagueOf, leagueTuning } from '../src/shared/game/leagues.ts';
import { AI_SKILL } from '../src/shared/game/roster.ts';
import { getTrack } from '../src/shared/track/builder.ts';
import { TRACK_LIST } from '../src/shared/track/defs/index.ts';
import { Ev } from '../src/shared/sim/events.ts';
import { stepWorld } from '../src/shared/sim/step.ts';
import { createWorld, RacePhase } from '../src/shared/sim/world.ts';

const args = process.argv.slice(2);
const li = args.indexOf('--league');
const tuning = leagueTuning(DEFAULT_TUNING, leagueOf(li >= 0 ? args[li + 1] : 'standard'));
const skills = args.includes('--sweep') ? [0.7, 0.75, 0.8, 0.86, 0.93, 1] : [...AI_SKILL];
for (const def of TRACK_LIST) {
  const track = getTrack(def);
  const row: string[] = [];
  for (const skill of skills) {
   let sum = 0, best = Infinity, walls = 0, worst = 0;
   // Different countdowns shift the tick phase, so the line wander differs.
   for (const cd of [1, 37, 71, 113]) {
    const w = createWorld(track, 1, 3, { laps: 3, countdownTicks: cd });
    const c = w.cars[0];
    c.aiDriven = 1;
    c.aiSkill = skill;
    while (w.race.phase !== RacePhase.Finished && w.tick < 60 * 60 * 10) {
      stepWorld(w, track, [], [tuning]);
      for (let k = 0; k < w.events.count; k++) if (w.events.list[k].kind === Ev.WallHit) walls++;
    }
    const total = (c.finishTick - w.race.startTick) * DT;
    sum += total / 3;
    worst = Math.max(worst, total / 3);
    best = Math.min(best, c.bestLapTicks * DT);
   }
    row.push(`${skill.toFixed(2)}: ${(sum / 4).toFixed(2)} avg (best ${best.toFixed(2)}, worst avg ${worst.toFixed(2)}) w${walls}`);
  }
  console.log(def.name.padEnd(16), row.join('  |  '));
}
