import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Analytics, networkOf, parseBeacon } from './analytics.ts';
import { readLog, summarize } from './analyticsStats.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'megacars-analytics-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const req = (headers: Record<string, string>, ip = '203.0.113.7', method = 'GET') =>
  ({ headers, method, socket: { remoteAddress: ip } }) as unknown as IncomingMessage;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20, 12);

describe('hashed addresses', () => {
  it('are stable within a day, differ between days and people, and hide the address', () => {
    let now = T0;
    const a = new Analytics(tmp(), { salt: 's', now: () => now });
    const me = a.who(req({}))!;
    expect(a.who(req({}))!.h).toBe(me.h);
    expect(a.who(req({}, '203.0.113.8'))!.h).not.toBe(me.h);
    now += DAY;
    expect(a.who(req({}))!.h).not.toBe(me.h);
    expect(me.h).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(me)).not.toContain('203.0.113');
  });

  it('keeps one hash per IPv6 /64 network', () => {
    expect(networkOf('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(networkOf('2001:db8:1:2::1'));
    expect(networkOf('2001:db8:1:3::1')).not.toBe(networkOf('2001:db8:1:2::1'));
    expect(networkOf('1.2.3.4')).toBe('1.2.3.4');
  });

  it('take the country from the CDN header, else from the address', () => {
    const a = new Analytics(tmp(), { salt: 's' });
    expect(a.who(req({ 'cf-ipcountry': 'se' }))!.c).toBe('SE');
    expect(a.who(req({}, '81.170.128.1'))!.c).toBe('SE');
    expect(a.who(req({}, '10.0.0.1'))!.c).toBe('??');
  });

  it('respect Do Not Track and Global Privacy Control, and switching off', () => {
    const a = new Analytics(tmp(), { salt: 's' });
    expect(a.who(req({ dnt: '1' }))).toBeNull();
    expect(a.who(req({ 'sec-gpc': '1' }))).toBeNull();
    expect(new Analytics(tmp(), { enabled: false }).who(req({}))).toBeNull();
  });

  it('recognise bots and phones', () => {
    const a = new Analytics(tmp(), { salt: 's' });
    expect(a.isBot(req({ 'user-agent': 'Mozilla/5.0 Firefox' }))).toBe(false);
    expect(a.isBot(req({ 'user-agent': 'Googlebot/2.1' }))).toBe(true);
    expect(a.isBot(req({ 'user-agent': 'Mozilla/5.0 HeadlessChrome' }))).toBe(true);
    expect(a.deviceOf(req({ 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile' }))).toBe('m');
    expect(a.deviceOf(req({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' }))).toBe('d');
  });
});

describe('reports from the page', () => {
  it('accept a known track and mode, and nothing else', () => {
    const ok = { t: 'race', sid: 'abcd1234', track: 'cigars', mode: 'practice', laps: 3, opponents: 0, players: 1 };
    expect(parseBeacon(ok)).toEqual(ok);
    expect(parseBeacon({ ...ok, track: 'nonsense' })).toBeNull();
    expect(parseBeacon({ ...ok, mode: '<script>' })).toBeNull();
    expect(parseBeacon({ ...ok, laps: 1e9 })).toBeNull();
    expect(parseBeacon({ ...ok, sid: 'x' })).toBeNull();
    expect(parseBeacon({ ...ok, name: 'extra' })).toEqual(ok);
    expect(parseBeacon({ t: 'session', sid: 'abcd1234', dur: 90, races: 2 })).toEqual({ t: 'session', sid: 'abcd1234', dur: 90, races: 2 });
    expect(parseBeacon({ t: 'session', sid: 'abcd1234', dur: -1, races: 2 })).toBeNull();
    expect(parseBeacon({ t: 'open', sid: 'abcd1234', extra: 1 })).toEqual({ t: 'open', sid: 'abcd1234' });
    expect(parseBeacon('hello')).toBeNull();
    expect(parseBeacon({ t: 'other', sid: 'abcd1234' })).toBeNull();
  });
});

describe('the log', () => {
  it('is written per day, summed up, and old days are deleted', async () => {
    const dir = tmp();
    let now = T0;
    const a = new Analytics(dir, { salt: 's', now: () => now, retentionDays: 30 });
    const se = a.who(req({ 'cf-ipcountry': 'SE' }))!;
    const us = a.who(req({ 'cf-ipcountry': 'US' }, '198.51.100.2'))!;
    a.log(se, { t: 'open', sid: 'aaaaaaaa', d: 'm' });
    a.log(se, { t: 'open', sid: 'bbbbbbbb', d: 'm' });
    a.log(us, { t: 'visit', d: 'd' });
    a.log(se, { t: 'race', sid: 'aaaaaaaa', track: 'cigars', mode: 'quick', laps: 3, opponents: 7, players: 1 });
    a.log(se, { t: 'session', sid: 'aaaaaaaa', dur: 60, races: 1 });
    a.log(se, { t: 'session', sid: 'aaaaaaaa', dur: 400, races: 1 });
    a.log(us, { t: 'ws', dur: 120 });
    a.log(null, { t: 'room_race', track: 'tivoli', laps: 9, humans: 3, ai: 2, public: true });
    await new Promise((r) => setTimeout(r, 100));

    const s = summarize(readLog(join(dir, 'analytics'), 7, now), 7, now);
    expect(s.visits).toBe(3);
    expect(s.visitors).toBe(2);
    expect(s.devices).toEqual({ mobile: 1, desktop: 1 });
    expect(s.countries.map((c) => c.country).sort()).toEqual(['SE', 'US']);
    expect(s.sessions).toMatchObject({ count: 1, medianSec: 400, over5min: 1 });
    expect(s.tracks).toEqual([{ track: 'cigars', starts: 1, modes: { quick: 1 } }]);
    expect(s.online.sessions).toBe(1);
    expect(s.online.races).toEqual([{ track: 'tivoli', races: 1, humans: 3 }]);
    expect(readFileSync(join(dir, 'analytics', '2026-10-20.jsonl'), 'utf8')).not.toContain('203.0.113');

    writeFileSync(join(dir, 'analytics', '2026-01-01.jsonl'), '{}\n');
    expect(await a.prune()).toBe(1);
    expect(readdirSync(join(dir, 'analytics')).sort()).toEqual(['2026-10-20.jsonl']);
    now += 40 * DAY;
    expect(await a.prune()).toBe(1);
  });

  it('counts someone who only raced (a cached page sends no page request) with their country', async () => {
    const dir = tmp();
    const a = new Analytics(dir, { salt: 's', now: () => T0 });
    const se = a.who(req({ 'cf-ipcountry': 'SE' }))!;
    a.log(se, { t: 'race', sid: 'aaaaaaaa', track: 'greenvalley', mode: 'quick', laps: 3, opponents: 7, players: 1 });
    a.log(se, { t: 'session', sid: 'aaaaaaaa', dur: 84, races: 1 });
    await new Promise((r) => setTimeout(r, 100));
    const s = summarize(readLog(join(dir, 'analytics'), 7, T0), 7, T0);
    expect(s.visitors).toBe(1);
    expect(s.countries).toEqual([{ country: 'SE', visitors: 1 }]);
  });

  it('keeps its salt between runs', () => {
    const dir = tmp();
    const h = (a: Analytics) => a.who(req({}))!.h;
    expect(h(new Analytics(dir))).toBe(h(new Analytics(dir)));
  });
});
