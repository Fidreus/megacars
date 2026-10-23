// Reads the usage log (see analytics.ts) and boils it down to a summary.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Line {
  ts: number;
  t: string;
  h?: string;
  c?: string;
  [k: string]: unknown;
}

export interface Summary {
  from: string;
  to: string;
  days: number;
  /** Page loads. */
  visits: number;
  /** Different people per day, added up over the days (an address can't be followed across days). */
  visitors: number;
  perDay: { day: string; visits: number; visitors: number }[];
  countries: { country: string; visitors: number }[];
  devices: { mobile: number; desktop: number };
  /** Page sessions reported by the browsers. */
  sessions: { count: number; avgSec: number; medianSec: number; over5min: number };
  /** Races started on the device (practice, quick race, championship, career). */
  tracks: { track: string; starts: number; modes: Record<string, number> }[];
  online: {
    sessions: number;
    avgSec: number;
    medianSec: number;
    races: { track: string; races: number; humans: number }[];
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const avg = (xs: number[]) => (xs.length ? Math.round(sum(xs) / xs.length) : 0);
const count = <T>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
};

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

export function summarize(lines: Line[], days: number, now = Date.now()): Summary {
  const dayOf = (l: Line) => new Date(l.ts).toISOString().slice(0, 10);
  const visits = lines.filter((l) => l.t === 'visit');
  const people = new Map<string, Line>();
  for (const l of visits) if (l.h) people.set(`${dayOf(l)}|${l.h}`, l);
  const perDay = new Map<string, { visits: number; people: Set<string> }>();
  for (const l of visits) {
    const d = perDay.get(dayOf(l)) ?? { visits: 0, people: new Set() };
    d.visits++;
    if (l.h) d.people.add(l.h);
    perDay.set(dayOf(l), d);
  }
  const countries = count([...people.values()], (l) => l.c ?? '??');
  // One report per page load (sid): the longest one wins.
  const longest = new Map<string, number>();
  for (const l of lines) if (l.t === 'session' && typeof l.sid === 'string') longest.set(l.sid, Math.max(longest.get(l.sid) ?? 0, Number(l.dur) || 0));
  const secs = [...longest.values()].filter((s) => s > 0);
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
  const mobile = [...people.values()].filter((l) => l.d === 'm').length;
  return {
    from: new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
    days,
    visits: visits.length,
    visitors: people.size,
    perDay: [...perDay].sort().map(([day, d]) => ({ day, visits: d.visits, visitors: d.people.size })),
    countries: [...countries].map(([country, visitors]) => ({ country, visitors })).sort((a, b) => b.visitors - a.visitors),
    devices: { mobile, desktop: people.size - mobile },
    sessions: { count: secs.length, avgSec: avg(secs), medianSec: median(secs), over5min: secs.filter((s) => s >= 300).length },
    tracks: [...byTrack]
      .map(([track, modes]) => ({ track, starts: sum(Object.values(modes)), modes }))
      .sort((a, b) => b.starts - a.starts),
    online: {
      sessions: ws.length,
      avgSec: avg(ws),
      medianSec: median(ws),
      races: [...roomTracks]
        .map(([track, r]) => ({ track, races: r.races, humans: Math.round((r.humans / r.races) * 10) / 10 }))
        .sort((a, b) => b.races - a.races),
    },
  };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function formatSummary(s: Summary): string {
  const out: string[] = [];
  out.push(`Megacars usage ${s.from} .. ${s.to} (${s.days} days)`, '');
  out.push(`Page loads ${s.visits}, visitors ${s.visitors} (people counted once per day; mobile ${s.devices.mobile}, desktop ${s.devices.desktop})`);
  for (const d of s.perDay) out.push(`  ${d.day}  ${String(d.visitors).padStart(5)} visitors  ${String(d.visits).padStart(5)} loads`);
  out.push('', 'Countries:');
  for (const c of s.countries.slice(0, 15)) out.push(`  ${c.country}  ${c.visitors}`);
  out.push('', `Time on the page (${s.sessions.count} sessions): median ${mmss(s.sessions.medianSec)}, average ${mmss(s.sessions.avgSec)}, ${s.sessions.over5min} stayed 5 min or more`);
  out.push('', 'Races started on the device:');
  for (const t of s.tracks) out.push(`  ${t.track.padEnd(12)} ${String(t.starts).padStart(5)}  ${Object.entries(t.modes).map(([m, n]) => `${m} ${n}`).join(', ')}`);
  out.push('', `Online: ${s.online.sessions} connections, median ${mmss(s.online.medianSec)}, average ${mmss(s.online.avgSec)}`);
  for (const t of s.online.races) out.push(`  ${t.track.padEnd(12)} ${String(t.races).padStart(5)} races, ${t.humans} people on average`);
  return `${out.join('\n')}\n`;
}
