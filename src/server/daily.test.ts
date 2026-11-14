import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIM_VERSION } from '../shared/config/constants.ts';
import { DEFAULT_TUNING } from '../shared/config/tuning.ts';
import { DAILY_GRACE_MS, dailyChallenge, DAY_MS, type DailySubmission } from '../shared/game/daily.ts';
import { createRaceWorld } from '../shared/game/raceSetup.ts';
import { ReplayRecorder, type StoredReplay } from '../shared/game/records.ts';
import { PROTOCOL_VERSION, type RaceSpec } from '../shared/net/protocol.ts';
import { quantizeInput, type CarInput } from '../shared/sim/input.ts';
import { stepWorld } from '../shared/sim/step.ts';
import { DailyStore, type Verify } from './daily.ts';
import { RecordStore } from './records.ts';

// 2026-11-20 is Frost Ring, standard league (a track the crude driver below gets round).
const DAY = '2026-11-20';
const NOON = Date.parse(`${DAY}T12:00:00Z`);
const CH = dailyChallenge(DAY);

function specFor(day: string): RaceSpec {
  const ch = dailyChallenge(day);
  return {
    id: 0, track: ch.track, laps: 0, seed: 99, countdownTicks: 0, weapons: false, league: ch.league,
    entrants: [{ name: 'YOU', color: '#f00', playerId: 0, skill: 0.9 }],
  };
}

/** Practice laps with a crude line-following driver. */
function record(spec: RaceSpec, ticks: number): { replay: string; best: number } {
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

/** A clock the test moves. */
function clock(start: number) {
  const c = { t: start, now: () => c.t };
  return c;
}

/** Takes the lap time from the name ("A:3000") instead of replaying: board rules only. */
const fakeVerify: Verify = (sub) => Promise.resolve({ ok: true, best: Number(sub.replay), rank: 0 });

function sub(name: string, ticks: number, day = DAY): DailySubmission {
  return { v: PROTOCOL_VERSION, name, day, spec: specFor(day), replay: String(ticks) };
}

describe('daily store', () => {
  it('checks a lap, puts it on the day board and the world board, and serves its race', async () => {
    expect(CH).toMatchObject({ track: 'frostring', league: 'standard' });
    const dir = mkdtempSync(join(tmpdir(), 'mc-daily-'));
    const records = new RecordStore(dir);
    const c = clock(NOON);
    const daily = new DailyStore(dir, (s) => records.submit(s), { now: c.now });
    expect(daily.view()).toMatchObject({ ok: true, now: NOON, endsAt: Date.parse('2026-11-21T00:00:00Z'), challenge: CH, board: [], yesterday: null });
    const spec = specFor(DAY);
    const { replay, best } = record(spec, 60 * 120);
    expect(best).toBeGreaterThan(0);
    const r = await daily.submit({ v: PROTOCOL_VERSION, name: 'tester', day: DAY, spec, replay });
    expect(r).toEqual({ ok: true, best, rank: 1, place: 1, worldRank: 1 });
    // The world board got it from the same check.
    expect(records.served().frostring[0]).toMatchObject({ name: 'TESTER', ticks: best });
    const v = daily.view();
    expect(v.board).toHaveLength(1);
    expect(v.board[0]).toMatchObject({ name: 'TESTER', ticks: best, at: NOON });
    const kept = JSON.parse(daily.replayText(v.board[0].id!)!) as StoredReplay;
    expect(kept).toMatchObject({ v: SIM_VERSION, name: 'TESTER', ticks: best, replay });
    // Saved, and read back after a restart.
    daily.flush();
    const again = new DailyStore(dir, fakeVerify, { now: c.now });
    expect(again.view().board[0].id).toBe(v.board[0].id);
    // The next day it is yesterday's top three.
    c.t += DAY_MS;
    expect(again.view()).toMatchObject({ board: [], yesterday: { challenge: CH, top: [{ name: 'TESTER', ticks: best }] } });
    expect(again.view().challenge.day).toBe('2026-11-21');
  });

  it('refuses laps for another day, track or league', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-daily-'));
    const c = clock(NOON);
    const daily = new DailyStore(dir, fakeVerify, { now: c.now });
    expect((await daily.submit(sub('A', 3000, '2026-11-19'))).error).toBe('not today');
    expect((await daily.submit(sub('A', 3000, '2026-11-21'))).error).toBe('not today');
    expect((await daily.submit({ ...sub('A', 3000), day: 'today' })).error).toBe('bad day');
    expect((await daily.submit({ ...sub('A', 3000), v: 1 })).error).toBe('version');
    const s = sub('A', 3000);
    expect((await daily.submit({ ...s, spec: { ...s.spec, track: 'greenvalley' } })).error).toBe('wrong track');
    expect((await daily.submit({ ...s, spec: { ...s.spec, league: 'mega' } })).error).toBe('wrong league');
    expect((await daily.submit({ ...s, spec: { ...s.spec, weapons: true } })).error).toBe('no weapons');
    expect(daily.view().board).toEqual([]);
    // A lap that was running at midnight still counts for its day, a few minutes on.
    c.t = Date.parse('2026-11-21T00:00:00Z') + DAILY_GRACE_MS / 2;
    expect((await daily.submit(sub('LATE', 3000))).ok).toBe(true);
    c.t += DAILY_GRACE_MS;
    expect((await daily.submit(sub('LATER', 2000))).error).toBe('not today');
  });

  it('keeps the best lap per name in the top 50, with races for the top 10 only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-daily-'));
    const replays = join(dir, 'daily', `v${SIM_VERSION}`, 'replays');
    const c = clock(NOON);
    const daily = new DailyStore(dir, fakeVerify, { now: c.now });
    for (let k = 0; k < 60; k++) await daily.submit(sub(`P${k}`, 4000 - k * 10));
    expect((await daily.submit(sub('P59', 3500))).rank).toBe(0);
    const better = await daily.submit(sub('P0', 3000));
    expect(better).toMatchObject({ ok: true, rank: 1, place: 1 });
    const b = daily.view().board;
    expect(b).toHaveLength(50);
    expect(b[0].name).toBe('P0');
    expect(new Set(b.map((e) => e.name)).size).toBe(50);
    expect(b.filter((e) => e.id).length).toBe(10);
    expect(b.slice(0, 10).every((e) => e.id)).toBe(true);
    daily.flush();
    expect(readdirSync(replays).length).toBe(10);
    // A slow lap from someone not on the board: checked, but not placed.
    expect(await daily.submit(sub('SLOW', 9999))).toMatchObject({ ok: true, rank: 0, place: 0 });
  });

  it('keeps only the winner once the day is over, and 30 days of boards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-daily-'));
    const vdir = join(dir, 'daily', `v${SIM_VERSION}`);
    const c = clock(NOON);
    const daily = new DailyStore(dir, fakeVerify, { now: c.now });
    for (let k = 0; k < 5; k++) await daily.submit(sub(`P${k}`, 3000 + k));
    daily.flush();
    expect(readdirSync(join(vdir, 'replays')).length).toBe(5);
    const winner = daily.view().board[0].id!;
    // Just after midnight the day still takes late laps and keeps its races.
    c.t = Date.parse('2026-11-21T00:01:00Z');
    daily.sweep();
    daily.flush();
    expect(readdirSync(join(vdir, 'replays')).length).toBe(5);
    c.t = Date.parse('2026-11-21T01:00:00Z');
    daily.sweep();
    daily.flush();
    expect(readdirSync(join(vdir, 'replays'))).toEqual([`${winner}.json`]);
    expect(daily.pastDay(DAY)).toMatchObject({ over: true });
    expect(daily.pastDay(DAY)!.board[0]).toMatchObject({ name: 'P0', id: winner });
    expect(daily.pastDay(DAY)!.board).toHaveLength(5);
    expect(daily.pastDay(DAY)!.board[1].id).toBeUndefined();
    // Day 29 after it is still kept; on day 30 it goes, winner's race and all.
    c.t = NOON + 29 * DAY_MS;
    daily.sweep();
    daily.flush();
    expect(existsSync(join(vdir, `${DAY}.json`))).toBe(true);
    c.t = NOON + 30 * DAY_MS;
    daily.sweep();
    daily.flush();
    expect(existsSync(join(vdir, `${DAY}.json`))).toBe(false);
    expect(readdirSync(join(vdir, 'replays'))).toEqual([]);
    expect(daily.pastDay(DAY)).toBeNull();
  });

  it('moves an unreadable day aside instead of overwriting it, and keeps its races', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-daily-'));
    const vdir = join(dir, 'daily', `v${SIM_VERSION}`);
    mkdirSync(join(vdir, 'replays'), { recursive: true });
    writeFileSync(join(vdir, `${DAY}.json`), '{"day": "2026-11-20", "entr');
    writeFileSync(join(vdir, 'replays', 'abcdef123.json'), '{}');
    const daily = new DailyStore(dir, fakeVerify, { now: () => NOON });
    expect(daily.view().board).toEqual([]);
    expect(readdirSync(vdir).some((f) => f.startsWith(`${DAY}.json.bad-`))).toBe(true);
    expect(existsSync(join(vdir, 'replays', 'abcdef123.json'))).toBe(true);
    expect(readFileSync(join(vdir, readdirSync(vdir).find((f) => f.includes('.bad-'))!), 'utf8')).toContain('entr');
  });

  it('keeps a running day on the track it started with', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-daily-'));
    const vdir = join(dir, 'daily', `v${SIM_VERSION}`);
    mkdirSync(vdir, { recursive: true });
    // As if made before a track was added that would now reshuffle the day.
    const stored = { ...CH, track: 'greenvalley', league: 'super' };
    writeFileSync(join(vdir, `${DAY}.json`), JSON.stringify({ day: DAY, challenge: stored, entries: [{ name: 'A', ticks: 3000, at: 1 }] }));
    const daily = new DailyStore(dir, fakeVerify, { now: () => NOON });
    expect(daily.view().challenge).toMatchObject({ track: 'greenvalley', league: 'super' });
    expect((await daily.submit(sub('B', 2000))).error).toBe('wrong track');
  });
});
