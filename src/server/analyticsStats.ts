// Reads the usage log (see analytics.ts) and boils it down to a summary.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trackName } from '../shared/track/defs/index.ts';

interface Line {
  ts: number;
  t: string;
  h?: string;
  c?: string;
  [k: string]: unknown;
}

export interface Count {
  key: string;
  n: number;
}

export interface Summary {
  from: string;
  to: string;
  days: number;
  /** Time zone for hours and weekdays. Days are UTC days (that is what the address hashes rotate by). */
  tz: string;
  totals: { visitors: number; opens: number; sessions: number; races: number; onlineRaces: number };
  perDay: { day: string; visitors: number; opens: number; races: number }[];
  /** Page loads and races started, per hour of the day (0-23) and weekday (Monday first). */
  hours: { opens: number[]; races: number[] };
  weekdays: { opens: number[]; races: number[] };
  /** Visitors by what we know of them (only those whose page told us). */
  countries: Count[];
  devices: Count[];
  browsers: Count[];
  systems: Count[];
  screens: Count[];
  languages: Count[];
  referrers: Count[];
  sessions: { count: number; avgSec: number; medianSec: number; p90Sec: number; lengths: Count[]; withRace: number };
  /** Page loads that went on to start a race. */
  funnel: { opened: number; raced: number };
  tracks: { track: string; name: string; starts: number; modes: Record<string, number> }[];
  modes: Count[];
  racesDetail: { avgLaps: number; avgOpponents: number; splitScreen: number };
  online: {
    connections: number;
    avgSec: number;
    medianSec: number;
    races: { track: string; name: string; races: number; humans: number }[];
    publicShare: number;
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const median = (xs: number[]) => (xs.length ? sorted(xs)[Math.floor(xs.length / 2)] : 0);
const percentile = (xs: number[], p: number) => (xs.length ? sorted(xs)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0);
const avg = (xs: number[]) => (xs.length ? Math.round(sum(xs) / xs.length) : 0);
const tally = (keys: Iterable<string | undefined>): Count[] => {
  const m = new Map<string, number>();
  for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
};

const LENGTHS: [string, number][] = [['< 10 s', 10], ['10–30 s', 30], ['30–60 s', 60], ['1–3 min', 180], ['3–10 min', 600], ['10–30 min', 1800], ['30+ min', Infinity]];
export const DEVICE_NAMES: Record<string, string> = { m: 'Mobil', t: 'Surfplatta', d: 'Dator' };
export const SCREEN_NAMES: Record<string, string> = { s: '< 600 px', m: '600–1100 px', l: '1100–1700 px', x: '1700+ px' };
export const MODE_NAMES: Record<string, string> = { quick: 'Snabbt lopp', practice: 'Fri träning', cup: 'Mästerskap', career: 'Karriär', school: 'Körskola' };

/** The log lines of the last `days` days (today included). */
export function readLog(dir: string, days: number, now = Date.now()): Line[] {
  const first = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) >= first).sort();
  } catch {
    // No log yet.
  }
  const lines: Line[] = [];
  for (const f of files) {
    for (const raw of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!raw) continue;
      try {
        lines.push(JSON.parse(raw) as Line);
      } catch {
        // A half-written line.
      }
    }
  }
  return lines;
}

/** A time zone name Intl knows, else the default. */
export function validZone(tz: string | null | undefined): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz ?? undefined });
    return tz || 'Europe/Stockholm';
  } catch {
    return 'Europe/Stockholm';
  }
}

export function summarize(lines: Line[], days: number, now = Date.now(), tzName = 'Europe/Stockholm'): Summary {
  const tz = validZone(tzName);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23', weekday: 'short' });
  const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const local = new Map<number, [number, number]>();
  /** [hour, weekday (Monday = 0)] in the chosen zone, cached per UTC hour. */
  const whenOf = (ts: number): [number, number] => {
    const k = Math.floor(ts / 3_600_000);
    let v = local.get(k);
    if (!v) {
      const parts = fmt.formatToParts(ts);
      v = [Number(parts.find((p) => p.type === 'hour')?.value) % 24, WEEK.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '')];
      local.set(k, v);
    }
    return v;
  };
  const dayOf = (l: Line) => new Date(l.ts).toISOString().slice(0, 10);
  const isOpen = (l: Line) => l.t === 'open' || l.t === 'visit';

  // Anyone who did anything counts once per day, whatever else we saw of them.
  const people = new Map<string, Line>();
  for (const l of lines) {
    if (!l.h) continue;
    const key = `${dayOf(l)}|${l.h}`;
    // The page's own report (it knows the device) is the one to describe them by.
    if (!people.has(key) || (isOpen(l) && !isOpen(people.get(key)!))) people.set(key, l);
  }
  const known = [...people.values()].filter(isOpen);

  const first = new Date(now - (days - 1) * 86_400_000);
  const perDay: Summary['perDay'] = [];
  const dayPeople = new Map<string, Set<string>>();
  for (const l of lines) if (l.h) dayPeople.set(dayOf(l), (dayPeople.get(dayOf(l)) ?? new Set()).add(l.h));
  for (let i = 0; i < days; i++) {
    const day = new Date(first.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const of = lines.filter((l) => dayOf(l) === day);
    perDay.push({ day, visitors: dayPeople.get(day)?.size ?? 0, opens: of.filter(isOpen).length, races: of.filter((l) => l.t === 'race').length });
  }

  const hours = { opens: Array<number>(24).fill(0), races: Array<number>(24).fill(0) };
  const weekdays = { opens: Array<number>(7).fill(0), races: Array<number>(7).fill(0) };
  for (const l of lines) {
    const kind = isOpen(l) ? 'opens' : l.t === 'race' ? 'races' : null;
    if (!kind) continue;
    const [h, w] = whenOf(l.ts);
    hours[kind][h]++;
    if (w >= 0) weekdays[kind][w]++;
  }

  // One report per page load (sid): the longest one wins.
  const longest = new Map<string, number>();
  const racesOf = new Map<string, number>();
  for (const l of lines) {
    if (l.t === 'session' && typeof l.sid === 'string') {
      longest.set(l.sid, Math.max(longest.get(l.sid) ?? 0, Number(l.dur) || 0));
      racesOf.set(l.sid, Math.max(racesOf.get(l.sid) ?? 0, Number(l.races) || 0));
    }
  }
  const secs = [...longest.values()].filter((s) => s > 0);
  const opened = new Set(lines.filter((l) => l.t === 'open' && typeof l.sid === 'string').map((l) => l.sid as string));
  const raced = new Set(lines.filter((l) => l.t === 'race' && typeof l.sid === 'string').map((l) => l.sid as string));
  const races = lines.filter((l) => l.t === 'race');
  const byTrack = new Map<string, Record<string, number>>();
  for (const l of races) {
    const m = byTrack.get(String(l.track)) ?? {};
    m[String(l.mode)] = (m[String(l.mode)] ?? 0) + 1;
    byTrack.set(String(l.track), m);
  }
  const ws = lines.filter((l) => l.t === 'ws').map((l) => Number(l.dur) || 0);
  const roomRaces = lines.filter((l) => l.t === 'room_race');
  const roomTracks = new Map<string, { races: number; humans: number }>();
  for (const l of roomRaces) {
    const r = roomTracks.get(String(l.track)) ?? { races: 0, humans: 0 };
    r.races++;
    r.humans += Number(l.humans) || 0;
    roomTracks.set(String(l.track), r);
  }
  const nameOf = (id: string) => trackName(id);
  let lo = 0;
  const lengths = LENGTHS.map(([key, max]) => {
    const n = secs.filter((s) => s >= lo && s < max).length;
    lo = max;
    return { key, n };
  });

  return {
    from: first.toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
    days,
    tz,
    totals: { visitors: people.size, opens: lines.filter(isOpen).length, sessions: secs.length, races: races.length, onlineRaces: roomRaces.length },
    perDay,
    hours,
    weekdays,
    countries: tally([...people.values()].map((l) => l.c)),
    devices: tally(known.map((l) => (typeof l.d === 'string' ? (DEVICE_NAMES[l.d] ?? l.d) : undefined))),
    browsers: tally(known.map((l) => l.b as string | undefined)),
    systems: tally(known.map((l) => l.os as string | undefined)),
    screens: tally(known.map((l) => (typeof l.sz === 'string' ? (SCREEN_NAMES[l.sz] ?? l.sz) : undefined))),
    languages: tally(known.map((l) => l.lang as string | undefined)),
    referrers: tally(known.map((l) => (typeof l.ref === 'string' ? l.ref : undefined))),
    sessions: {
      count: secs.length,
      avgSec: avg(secs),
      medianSec: median(secs),
      p90Sec: percentile(secs, 0.9),
      lengths,
      withRace: secs.length ? Math.round((100 * [...longest.keys()].filter((k) => (racesOf.get(k) ?? 0) > 0 && (longest.get(k) ?? 0) > 0).length) / secs.length) : 0,
    },
    funnel: { opened: opened.size, raced: [...raced].filter((s) => opened.has(s)).length },
    tracks: [...byTrack]
      .map(([track, modes]) => ({ track, name: nameOf(track), starts: sum(Object.values(modes)), modes }))
      .sort((a, b) => b.starts - a.starts),
    modes: tally(races.map((l) => String(l.mode))).map((c) => ({ key: MODE_NAMES[c.key] ?? c.key, n: c.n })),
    racesDetail: {
      avgLaps: races.length ? Math.round((sum(races.map((l) => Number(l.laps) || 0)) / races.length) * 10) / 10 : 0,
      avgOpponents: races.length ? Math.round((sum(races.map((l) => Number(l.opponents) || 0)) / races.length) * 10) / 10 : 0,
      splitScreen: races.length ? Math.round((100 * races.filter((l) => Number(l.players) > 1).length) / races.length) : 0,
    },
    online: {
      connections: ws.length,
      avgSec: avg(ws),
      medianSec: median(ws),
      races: [...roomTracks]
        .map(([track, r]) => ({ track, name: nameOf(track), races: r.races, humans: Math.round((r.humans / r.races) * 10) / 10 }))
        .sort((a, b) => b.races - a.races),
      publicShare: roomRaces.length ? Math.round((100 * roomRaces.filter((l) => l.public === true).length) / roomRaces.length) : 0,
    },
  };
}

export const mmss = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

export function formatSummary(s: Summary): string {
  const out: string[] = [];
  const list = (title: string, cs: Count[], max = 10) => {
    if (!cs.length) return;
    out.push('', `${title}:`);
    for (const c of cs.slice(0, max)) out.push(`  ${c.key.padEnd(24)} ${c.n}`);
  };
  const t = s.totals;
  out.push(`Megacars usage ${s.from} .. ${s.to} (${s.days} days, hours in ${s.tz})`, '');
  out.push(`Visitors ${t.visitors} (counted once per day), page loads ${t.opens}, races started ${t.races}, online races ${t.onlineRaces}`);
  out.push(`${s.funnel.opened ? Math.round((100 * s.funnel.raced) / s.funnel.opened) : 0}% of page loads started a race (${s.funnel.raced} of ${s.funnel.opened})`);
  for (const d of s.perDay) out.push(`  ${d.day}  ${String(d.visitors).padStart(5)} visitors  ${String(d.opens).padStart(5)} loads  ${String(d.races).padStart(5)} races`);
  out.push('', `Time on the page (${s.sessions.count} sessions): median ${mmss(s.sessions.medianSec)}, average ${mmss(s.sessions.avgSec)}, 90% under ${mmss(s.sessions.p90Sec)}; ${s.sessions.withRace}% raced`);
  out.push('', `Page loads by hour: ${s.hours.opens.map((n, h) => `${h}:${n}`).join(' ')}`);
  list('Countries', s.countries, 15);
  list('Devices', s.devices);
  list('Browsers', s.browsers);
  list('Systems', s.systems);
  list('Screens', s.screens);
  list('Languages', s.languages);
  list('Came from', s.referrers);
  out.push('', 'Races started on the device:');
  for (const r of s.tracks) out.push(`  ${r.name.padEnd(18)} ${String(r.starts).padStart(5)}  ${Object.entries(r.modes).map(([m, n]) => `${m} ${n}`).join(', ')}`);
  out.push('', `Online: ${s.online.connections} connections, median ${mmss(s.online.medianSec)}, average ${mmss(s.online.avgSec)}`);
  for (const r of s.online.races) out.push(`  ${r.name.padEnd(18)} ${String(r.races).padStart(5)} races, ${r.humans} people on average`);
  return `${out.join('\n')}\n`;
}
