import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import type { RaceSpec } from '../net/protocol.ts';
import { quantizeInput, type CarInput } from '../sim/input.ts';
import { stepWorld } from '../sim/step.ts';
import { createRaceWorld } from './raceSetup.ts';
import { insertRecord, replayLaps, ReplayRecorder, specProblem } from './records.ts';

function spec(opponents: number, laps: number): RaceSpec {
  const entrants = [];
  for (let k = 0; k < opponents; k++) entrants.push({ name: `AI${k}`, color: '#fff', playerId: -1, skill: 0.9 });
  entrants.push({ name: 'YOU', color: '#f00', playerId: 0, skill: 0.9 });
  return { id: 0, track: 'greenvalley', laps, seed: 1234, countdownTicks: 60, weapons: opponents > 0, entrants };
}

/** A crude driver: aim at the centreline a little ahead, gas on. */
function drive(spec: RaceSpec, ticks: number): { rec: ReplayRecorder; best: number } {
  const { track, world, tunings } = createRaceWorld(spec, DEFAULT_TUNING);
  const me = spec.entrants.length - 1;
  const car = world.cars[me];
  const inputs: CarInput[] = world.cars.map(() => ({ steer: 0, throttle: 0, brake: 0, buttons: 0 }));
  const rec = new ReplayRecorder();
  for (let n = 0; n < ticks; n++) {
    const j = (car.trackIdx + 14) % track.n;
    const want = Math.atan2(track.px[j] - car.x, -(track.pz[j] - car.z));
    let d = want - car.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const inp = inputs[me];
    inp.steer = Math.max(-1, Math.min(1, d * 2.5));
    inp.throttle = Math.abs(d) > 0.5 ? 0.5 : 1;
    inp.brake = 0;
    inp.buttons = n % 400 < 20 ? 1 : 0;
    quantizeInput(inp);
    rec.add(inp);
    stepWorld(world, track, inputs, tunings);
  }
  return { rec, best: car.bestLapTicks };
}

describe('verified lap records', () => {
  it('replays a recorded race to the same lap times', () => {
    const s = spec(3, 2);
    const { rec, best } = drive(s, 60 * 150);
    expect(best).toBeGreaterThan(0);
    const out = replayLaps(JSON.parse(JSON.stringify(s)), rec.encode(), DEFAULT_TUNING);
    expect('laps' in out).toBe(true);
    if ('laps' in out) expect(Math.min(...out.laps)).toBe(best);
  });

  it('rejects races that are not stock single-player ones', () => {
    const s = spec(2, 3);
    expect(specProblem(s)).toBeNull();
    s.entrants[0].loadout = { car: 0, engine: 3, tyres: 3, armour: 3, missiles: 0, mines: 0, turbos: 0, damage: 0 } as never;
    expect(specProblem(s)).toBe('stock cars only');
    const two = spec(1, 3);
    two.entrants[0].playerId = 1;
    expect(specProblem(two)).toBe('one player only');
    expect('error' in replayLaps(spec(0, 1), 'not base64!', DEFAULT_TUNING)).toBe(true);
  });

  it('keeps one entry per name, best first', () => {
    const b: { name: string; ticks: number; at: number }[] = [];
    expect(insertRecord(b, { name: 'A', ticks: 3000, at: 0 })).toBe(1);
    expect(insertRecord(b, { name: 'B', ticks: 2900, at: 0 })).toBe(1);
    expect(insertRecord(b, { name: 'A', ticks: 3100, at: 0 })).toBe(0);
    expect(insertRecord(b, { name: 'A', ticks: 2800, at: 0 })).toBe(1);
    expect(b.map((e) => e.name)).toEqual(['A', 'B']);
  });
});
