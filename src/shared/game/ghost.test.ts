import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import type { RaceSpec } from '../net/protocol.ts';
import { quantizeInput, type CarInput } from '../sim/input.ts';
import { stepWorld } from '../sim/step.ts';
import { checkGhost, extractBestLap, ghostPose, ghostReach, ghostTicksAt, GHOST_STRIDE, LapTape, type GhostLap } from './ghost.ts';
import type { League } from './leagues.ts';
import { createRaceWorld } from './raceSetup.ts';
import { replayLaps, ReplayRecorder } from './records.ts';

function spec(track: string, league: League): RaceSpec {
  return { id: 0, track, laps: 0, seed: 77, countdownTicks: 0, weapons: false, league, entrants: [{ name: 'YOU', color: '#f00', playerId: 0, skill: 0.9 }] };
}

/** Practice laps with a crude line follower, taped as the game tapes them. */
function drive(s: RaceSpec, ticks: number): { replay: string; laps: GhostLap[]; best: number } {
  const { track, world, tunings } = createRaceWorld(s, DEFAULT_TUNING);
  const car = world.cars[0];
  const inputs: CarInput[] = [{ steer: 0, throttle: 0, brake: 0, buttons: 0 }];
  const rec = new ReplayRecorder();
  const tape = new LapTape();
  const laps: GhostLap[] = [];
  for (let n = 0; n < ticks; n++) {
    const j = (car.trackIdx + 14) % track.n;
    let d = Math.atan2(track.px[j] - car.x, -(track.pz[j] - car.z)) - car.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    inputs[0].steer = Math.max(-1, Math.min(1, d * 2.5));
    inputs[0].throttle = Math.abs(d) > 0.5 ? 0.5 : 1;
    quantizeInput(inputs[0]);
    rec.add(inputs[0]);
    const lap = car.lap;
    stepWorld(world, track, inputs, tunings);
    tape.sample(car, world.tick);
    if (car.lap > lap && lap > 0) {
      expect(tape.last!.ticks).toBe(car.lastLapTicks);
      laps.push(tape.last!);
    }
  }
  return { replay: rec.encode(), laps, best: car.bestLapTicks };
}

describe('ghost laps', () => {
  it('re-running a verified race gives the fastest lap, pose for pose', () => {
    for (const league of ['standard', 'super'] as League[]) {
      const s = spec('frostring', league);
      const { replay, laps, best } = drive(s, 60 * 150);
      expect(laps.length).toBeGreaterThan(1);
      const out = extractBestLap(JSON.parse(JSON.stringify(s)) as RaceSpec, replay, DEFAULT_TUNING);
      if ('error' in out) throw new Error(out.error);
      expect(out.lap.ticks).toBe(best);
      const checked = replayLaps(s, replay, DEFAULT_TUNING);
      expect('laps' in checked && Math.min(...checked.laps)).toBe(best);
      const live = laps.find((l) => l.ticks === best)!;
      expect(Array.from(out.lap.data)).toEqual(Array.from(live.data));
      expect(checkGhost(out.lap)).toBe(out.lap);
      // About 20 bytes a tick.
      expect(out.lap.data.byteLength).toBe((best + 1) * GHOST_STRIDE * 4);
    }
  });

  it('starts on the line and measures time by distance driven', () => {
    const { laps } = drive(spec('greenvalley', 'standard'), 60 * 100);
    const g = laps[0];
    expect(g.data[4]).toBe(0);
    const reach = ghostReach(g);
    const L = reach[reach.length - 1];
    expect(L).toBeGreaterThan(100);
    // Halfway along, the ghost's own time comes back.
    const i = Math.floor(g.ticks / 2);
    expect(Math.abs(ghostTicksAt(reach, g.data[i * GHOST_STRIDE + 4]) - i)).toBeLessThan(1.5);
    expect(ghostTicksAt(reach, L + 50)).toBe(-1);
    const p = { x: 0, y: 0, z: 0, heading: 0 };
    expect(ghostPose(g, i + 0.5, p)).toBe(true);
    expect(p.x).toBeCloseTo((g.data[i * GHOST_STRIDE] + g.data[(i + 1) * GHOST_STRIDE]) / 2, 4);
    expect(ghostPose(g, g.ticks + 1, p)).toBe(false);
  });

  it('turns away broken ghosts and races', () => {
    expect(checkGhost({ ticks: 3, data: new Float32Array(7) })).toBeNull();
    expect(checkGhost(null)).toBeNull();
    expect(extractBestLap(spec('frostring', 'standard'), 'not base64!', DEFAULT_TUNING)).toEqual({ error: 'bad replay' });
  });
});
