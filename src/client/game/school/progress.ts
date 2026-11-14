// What the player has done in the driving school, kept in the browser, and
// whether a first-time visitor has been asked about it yet.

const KEY = 'megacars.school.v1';

export interface SchoolSave {
  /** Lesson id -> when it was passed (ms since 1970). */
  done: Record<string, number>;
  /** Lessons that were skipped without passing. */
  skipped: Record<string, number>;
  /** The first-visit question has been shown (never ask again). */
  asked: boolean;
}

export function emptySave(): SchoolSave {
  return { done: {}, skipped: {}, asked: false };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function loadSchool(store: Store | null = defaultStore()): SchoolSave {
  try {
    const raw = store?.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<SchoolSave>) : {};
    return { done: { ...v.done }, skipped: { ...v.skipped }, asked: !!v.asked };
  } catch {
    return emptySave();
  }
}

export function saveSchool(s: SchoolSave, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not remembered.
  }
}

/** Every lesson passed (skipping does not count). */
export function allDone(s: SchoolSave, ids: readonly string[]): boolean {
  return ids.every((id) => id in s.done);
}

/** The first lesson not yet passed or skipped (or the first one when all are). */
export function nextLesson(s: SchoolSave, ids: readonly string[]): number {
  const i = ids.findIndex((id) => !(id in s.done) && !(id in s.skipped));
  return i < 0 ? 0 : i;
}

/**
 * True when nothing of the game is saved in this browser yet: nobody has
 * played here. Decided once, when the page loads, before the game writes anything.
 */
export function nothingSaved(store: { length: number; key(i: number): string | null } | null = safeStorage()): boolean {
  try {
    if (!store) return false;
    for (let i = 0; i < store.length; i++) {
      if (store.key(i)?.startsWith('megacars.')) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Evaluated when the game loads. */
export const FIRST_VISIT = nothingSaved();
