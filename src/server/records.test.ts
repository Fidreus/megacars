import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../shared/config/tuning.ts';
import { createRaceWorld } from '../shared/game/raceSetup.ts';
import { ReplayRecorder } from '../shared/game/records.ts';
import { PROTOCOL_VERSION, type RaceSpec } from '../shared/net/protocol.ts';
import { quantizeInput, type CarInput } from '../shared/sim/input.ts';
import { stepWorld } from '../shared/sim/step.ts';
import { RecordStore } from './records.ts';

const spec: RaceSpec = {
  id: 0, track: 'frostring', laps: 0, seed: 99, countdownTicks: 0, weapons: false,
  entrants: [{ name: 'YOU', color: '#f00', playerId: 0, skill: 0.9 }],
};

/** Practice laps with a crude line-following driver. */
function record(ticks: number): { replay: string; best: number } {
  const { track, world, tunings } = createRaceWorld(spec, DEFAULT_TUNING);
  const car = world.cars[0];
  const inputs: CarInput[] = [{ steer: 0, throttle: 0, brake: 0, buttons: 0 }];
  const rec = new ReplayRecorder();
  for (let n = 0; n < ticks; n++) {
    const j = (car.trackIdx + 14) % track.n;
    let d = Math.atan2(track.px[j] - car.x, -(track.pz[j] - car.z)) - car.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    inputs[0].steer = Math.max(-1, Math.min(1, d * 2.5));
    inputs[0].throttle = Math.abs(d) > 0.5 ? 0.5 : 1;
    quantizeInput(inputs[0]);
    rec.add(inputs[0]);
    stepWorld(world, track, inputs, tunings);
  }
  return { replay: rec.encode(), best: car.bestLapTicks };
}

describe('record store', () => {
  it('verifies a submission in a worker and puts it on the board', async () => {
    const store = new RecordStore(mkdtempSync(join(tmpdir(), 'mc-rec-')));
    const { replay, best } = record(60 * 120);
    expect(best).toBeGreaterThan(0);
    const r = await store.submit({ v: PROTOCOL_VERSION, name: 'tester', spec, replay });
    expect(r).toEqual({ ok: true, best, rank: 1 });
    expect(store.boards.frostring[0]).toMatchObject({ name: 'TESTER', ticks: best });
    // A claim the inputs don't back up can't get in: the server measures itself.
    const bad = await store.submit({ v: PROTOCOL_VERSION, name: 'cheat', spec: { ...spec, entrants: [{ ...spec.entrants[0], loadout: {} as never }] }, replay });
    expect(bad.ok).toBe(false);
    expect((await store.submit({ v: 1, name: 'old', spec, replay })).error).toBe('version');
  });
});
