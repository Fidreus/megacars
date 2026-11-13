// Ghost laps kept in the browser (IndexedDB: a ghost is ~70 kB a minute,
// too big for localStorage), per simulation version like the records. Your
// own best lap per track and league, and the last world board ghost worked
// out per track and league (with its entry id, whose race never changes).
// Without IndexedDB they last until the page is closed.

import { SIM_VERSION } from '../../shared/config/constants.ts';
import { DEFAULT_TUNING } from '../../shared/config/tuning.ts';
import { checkGhost, extractBestLap, type GhostLap } from '../../shared/game/ghost.ts';
import { REPLAY_ID, type RecordEntry, type StoredReplay } from '../../shared/game/records.ts';

const DB = 'megacars-ghosts';
const STORE = 'laps';
const memory = new Map<string, GhostLap & { id?: string }>();
let db: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

function idbKey(kind: 'mine' | 'wr', key: string): string {
  return `sim${SIM_VERSION}/${kind}/${key}`;
}

async function load(key: string, id?: string): Promise<GhostLap | null> {
  const hit = memory.get(key);
  if (hit && hit.id === id) return hit;
  const d = await open();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const g = checkGhost(req.result) as (GhostLap & { id?: string }) | null;
        if (g && g.id === id) {
          memory.set(key, g);
          resolve(g);
        } else resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function save(key: string, g: GhostLap, id?: string): Promise<void> {
  memory.set(key, { ...g, id });
  const d = await open();
  if (!d) return;
  try {
    d.transaction(STORE, 'readwrite').objectStore(STORE).put({ ticks: g.ticks, data: g.data, id }, key);
  } catch {
    // Kept for this visit only.
  }
}

/** Your best lap's ghost on a board key ("greenvalley@super"). */
export function loadMyGhost(boardKey: string): Promise<GhostLap | null> {
  return load(idbKey('mine', boardKey));
}

export function saveMyGhost(boardKey: string, g: GhostLap): void {
  void save(idbKey('mine', boardKey), g);
}

let worker: Worker | null = null;
let jobs = 0;

/** Re-run a race off the main thread and tape its best lap. */
function extractInWorker(rep: StoredReplay): Promise<GhostLap | string> {
  if (typeof Worker === 'undefined') {
    const out = extractBestLap(rep.spec, rep.replay, DEFAULT_TUNING);
    return Promise.resolve('error' in out ? out.error : out.lap);
  }
  worker ??= new Worker(new URL('./ghostWorker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const id = ++jobs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      w.terminate();
      if (worker === w) worker = null;
      resolve('timeout');
    }, 60_000);
    const onMessage = (e: MessageEvent<{ id: number; ticks?: number; data?: Float32Array; error?: string }>) => {
      if (e.data.id !== id) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      const g = checkGhost(e.data);
      resolve(g ?? e.data.error ?? 'bad ghost');
    };
    w.addEventListener('message', onMessage);
    w.onerror = () => {
      clearTimeout(timer);
      if (worker === w) worker = null;
      resolve('worker failed');
    };
    w.postMessage({ id, spec: rep.spec, replay: rep.replay });
  });
}

/**
 * A world board entry's ghost: from the cache, or its race fetched from the
 * server and re-run here. A string says why there is none.
 */
export async function loadWorldGhost(e: RecordEntry, boardKey: string): Promise<GhostLap | string> {
  if (!e.id || !REPLAY_ID.test(e.id)) return 'no replay';
  // One per track and league: a newer record replaces the one kept.
  const key = idbKey('wr', boardKey);
  const hit = await load(key, e.id);
  if (hit) return hit;
  let rep: StoredReplay;
  try {
    const res = await fetch(`/api/records/replay/${e.id}`);
    if (!res.ok) return res.status === 404 ? 'no replay' : 'offline';
    rep = (await res.json()) as StoredReplay;
  } catch {
    return 'offline';
  }
  if (rep.v !== SIM_VERSION) return 'other version';
  const g = await extractInWorker(rep);
  if (typeof g === 'string') return g;
  // The same lap the server measured, or the rules here differ.
  if (g.ticks !== e.ticks) return 'does not match';
  void save(key, g, e.id);
  return g;
}
