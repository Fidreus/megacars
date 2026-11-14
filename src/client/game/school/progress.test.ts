import { describe, expect, it } from 'vitest';
import { allDone, emptySave, loadSchool, nextLesson, nothingSaved, saveSchool } from './progress.ts';

function fakeStore(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
  };
}

const ids = ['a', 'b', 'c'];

describe('school progress', () => {
  it('is saved and read back', () => {
    const st = fakeStore();
    const s = emptySave();
    s.done.a = 5;
    s.asked = true;
    saveSchool(s, st);
    expect(loadSchool(st)).toEqual({ done: { a: 5 }, skipped: {}, asked: true });
  });

  it('survives a broken or missing save', () => {
    expect(loadSchool(fakeStore({ 'megacars.school.v1': '{nope' }))).toEqual(emptySave());
    expect(loadSchool(null)).toEqual(emptySave());
    expect(() => saveSchool(emptySave(), null)).not.toThrow();
  });

  it('counts the school as finished only when every lesson was passed, not skipped', () => {
    const s = emptySave();
    s.done = { a: 1, b: 1 };
    s.skipped = { c: 1 };
    expect(allDone(s, ids)).toBe(false);
    s.done.c = 2;
    expect(allDone(s, ids)).toBe(true);
  });

  it('offers the first lesson not yet passed or skipped', () => {
    const s = emptySave();
    expect(nextLesson(s, ids)).toBe(0);
    s.done.a = 1;
    s.skipped.b = 1;
    expect(nextLesson(s, ids)).toBe(2);
    s.done.c = 1;
    expect(nextLesson(s, ids)).toBe(0);
  });

  it('knows a browser where nothing of the game is saved yet', () => {
    expect(nothingSaved(fakeStore())).toBe(true);
    expect(nothingSaved(fakeStore({ other: '1' }))).toBe(true);
    expect(nothingSaved(fakeStore({ 'megacars.settings.v1': '{}' }))).toBe(false);
    expect(nothingSaved(null)).toBe(false);
  });
});
