// Your own records (saved in the browser) and the verified world boards on
// the server.

import { SIM_VERSION } from '../../shared/config/constants.ts';
import type { Boards, RecordSubmission } from '../../shared/game/records.ts';

/**
 * Per simulation version: new rules start an empty list. Older lists stay in
 * storage (megacars.records.v1 holds the ones from before version 25) but
 * are not shown.
 */
const KEY = `megacars.records.v1.sim${SIM_VERSION}`;

export interface TrackRecords {
  /** Best lap (ticks), 0 = none yet. */
  lap: number;
  /** Best full race time (ticks) by number of laps. */
  race: Record<string, number>;
}

export type LocalRecords = Record<string, TrackRecords>;

export function loadLocalRecords(): LocalRecords {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LocalRecords) : {};
  } catch {
    return {};
  }
}

function save(r: LocalRecords): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Not remembered.
  }
}

export function trackRecords(r: LocalRecords, track: string): TrackRecords {
  return (r[track] ??= { lap: 0, race: {} });
}

/** A lap: true if it beat the saved best (and was saved). */
export function noteLap(r: LocalRecords, track: string, ticks: number): boolean {
  const t = trackRecords(r, track);
  if (t.lap && t.lap <= ticks) return false;
  t.lap = ticks;
  save(r);
  return true;
}

/** A finished race: true if it beat the saved best for that many laps. */
export function noteRace(r: LocalRecords, track: string, laps: number, ticks: number): boolean {
  const t = trackRecords(r, track);
  const old = t.race[laps];
  if (old && old <= ticks) return false;
  t.race[laps] = ticks;
  save(r);
  return true;
}

export async function fetchBoards(): Promise<Boards | null> {
  try {
    const res = await fetch('/api/records', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as Boards) : null;
  } catch {
    return null;
  }
}

export async function submitRecord(sub: RecordSubmission): Promise<{ ok: boolean; error?: string; best?: number; rank?: number }> {
  try {
    const res = await fetch('/api/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
    return (await res.json()) as { ok: boolean; error?: string; best?: number; rank?: number };
  } catch {
    return { ok: false, error: 'offline' };
  }
}
