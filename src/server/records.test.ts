import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../shared/config/tuning.ts';
import { createRaceWorld } from '../shared/game/raceSetup.ts';
import { SIM_VERSION } from '../shared/config/constants.ts';
import { ReplayRecorder, type Boards } from '../shared/game/records.ts';
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

describe('record boards per simulation version', () => {
  const old = { frostring: [{ name: 'OLDTIMER', ticks: 1234, at: 1 }], 'gonetrack@super': [{ name: 'X', ticks: 999, at: 2 }] };

  it('starts empty next to an old records.json and never touches it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-rec-'));
    const oldText = JSON.stringify(old);
    writeFileSync(join(dir, 'records.json'), oldText);
    const store = new RecordStore(dir);
    expect(store.served()).toEqual({});
    const { replay, best } = record(60 * 120);
    const r = await store.submit({ v: PROTOCOL_VERSION, name: 'new', spec, replay });
    expect(r).toEqual({ ok: true, best, rank: 1 });
    store.flush();
    expect(readFileSync(join(dir, 'records.json'), 'utf8')).toBe(oldText);
    const saved = JSON.parse(readFileSync(join(dir, 'records', `v${SIM_VERSION}`, 'records.json'), 'utf8')) as Boards;
    expect(saved.frostring.map((e) => e.name)).toEqual(['NEW']);
    // A server restart reads the same board; the next version starts over and leaves this one be.
    expect(new RecordStore(dir).served().frostring[0].ticks).toBe(best);
    const next = new RecordStore(dir, SIM_VERSION + 1);
    expect(next.served()).toEqual({});
    expect(new RecordStore(dir).served().frostring[0].name).toBe('NEW');
    expect(readFileSync(join(dir, 'records.json'), 'utf8')).toBe(oldText);
  });

  it('moves an unreadable board aside instead of overwriting it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-rec-'));
    const vdir = join(dir, 'records', `v${SIM_VERSION}`);
    mkdirSync(vdir, { recursive: true });
    writeFileSync(join(vdir, 'records.json'), '{"frostring": [trunc');
    const store = new RecordStore(dir);
    expect(store.served()).toEqual({});
    expect(readdirSync(vdir).some((f) => f.startsWith('records.json.bad-'))).toBe(true);
  });
});
