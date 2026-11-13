// Solo race time of every computer personality against a driver without one,
// per difficulty: `node scripts/personaLaps.ts [--weapons] [--league super]`
import { DEFAULT_TUNING } from '../src/shared/config/tuning.ts';
import { leagueOf, leagueTuning } from '../src/shared/game/leagues.ts';
import { AI_NAMES, AI_SKILL } from '../src/shared/game/roster.ts';
import { PERSONAS } from '../src/shared/ai/persona.ts';
import { setPersona } from '../src/shared/game/personaSetup.ts';
import { getTrack } from '../src/shared/track/builder.ts';
import { TRACK_LIST } from '../src/shared/track/defs/index.ts';
import { Ev } from '../src/shared/sim/events.ts';
import { stepWorld } from '../src/shared/sim/step.ts';
import { createWorld, RacePhase } from '../src/shared/sim/world.ts';

const args = process.argv.slice(2);
const li = args.indexOf('--league');
const tuning = leagueTuning(DEFAULT_TUNING, leagueOf(li >= 0 ? args[li + 1] : 'standard'));
const weapons = args.includes('--weapons');
const oi = args.indexOf('--only');
const who = [-1, ...PERSONAS.map((_, i) => i).filter((i) => oi < 0 || AI_NAMES[i] === args[oi + 1])];

/** Race time (s) and wall hits of one persona alone on a track, summed over a few start phases. */
function solo(trackIdx: number, skill: number, persona: number): { time: number; walls: number } {
  const track = getTrack(TRACK_LIST[trackIdx]);
  let time = 0;
  let walls = 0;
  for (const cd of [1, 37, 71]) {
    const w = createWorld(track, 1, 3, { laps: 3, countdownTicks: cd, weapons });
    const c = w.cars[0];
    c.aiDriven = 1;
    c.aiSkill = skill;
    setPersona(c, persona);
    while (w.race.phase !== RacePhase.Finished && w.tick < 60 * 60 * 10) {
      stepWorld(w, track, [], [tuning]);
      for (let k = 0; k < w.events.count; k++) if (w.events.list[k].kind === Ev.WallHit) walls++;
    }
    time += c.finishTick - w.race.startTick;
  }
  return { time, walls };
}

for (let d = 0; d < AI_SKILL.length; d++) {
  console.log(`\n${['EASY', 'MEDIUM', 'HARD'][d]} (skill ${AI_SKILL[d]})  time vs no personality, per track, then mean`);
  const base = TRACK_LIST.map((_, t) => solo(t, AI_SKILL[d], -1).time);
  let fieldMean = 0;
  for (const p of who) {
    let sum = 0;
    let walls = 0;
    const cells: string[] = [];
    TRACK_LIST.forEach((_, t) => {
      const r = solo(t, AI_SKILL[d], p);
      const rel = (r.time / base[t] - 1) * 100;
      sum += rel;
      walls += r.walls;
      cells.push(`${rel >= 0 ? '+' : ''}${rel.toFixed(1)}`.padStart(5));
    });
    const mean = sum / TRACK_LIST.length;
    if (p >= 0) fieldMean += mean / (who.length - 1);
    console.log(`${(p < 0 ? '(none)' : AI_NAMES[p]).padEnd(11)} ${cells.join(' ')}  mean ${mean >= 0 ? '+' : ''}${mean.toFixed(2)}%  walls ${walls}`);
  }
  console.log(`field mean ${fieldMean >= 0 ? '+' : ''}${fieldMean.toFixed(2)}%`);
}
