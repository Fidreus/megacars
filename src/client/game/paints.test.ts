import { describe, expect, it } from 'vitest';
import { CAR_COLORS } from '../../shared/game/roster.ts';
import { ACHIEVEMENT_IDS } from './achievementRules.ts';
import { PAINTS, TOO_ALIKE, colorDistance, isUnlocked, paintById, paintGrid, unlockText, type UnlockState } from './paints.ts';

const none: UnlockState = { achieved: () => false, medals: [0, 0, 0, 0] };

describe('paint catalogue', () => {
  it('has about a dozen unique paints, a few free, and the stock one first', () => {
    expect(PAINTS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PAINTS.map((p) => p.id)).size).toBe(PAINTS.length);
    expect(PAINTS[0].body).toBeNull();
    const free = PAINTS.filter((p) => p.unlock.kind === 'free');
    expect(free.length).toBeGreaterThanOrEqual(3);
    expect(free.length).toBeLessThan(PAINTS.length / 2);
  });

  it('only asks for achievements that exist', () => {
    for (const p of PAINTS) if (p.unlock.kind === 'achievement') expect(ACHIEVEMENT_IDS.has(p.unlock.id), p.id).toBe(true);
  });

  it('uses valid colours', () => {
    for (const p of PAINTS) {
      if (p.body) expect(p.body).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('unlocking', () => {
  it('free ones are open, others need their achievement or medals', () => {
    const open = PAINTS.filter((p) => isUnlocked(p, none)).map((p) => p.id);
    expect(open).toEqual(PAINTS.filter((p) => p.unlock.kind === 'free').map((p) => p.id));
    const win: UnlockState = { achieved: (id) => id === 'win', medals: [0, 0, 0, 0] };
    expect(isUnlocked(paintById('bubblegum'), win)).toBe(true);
    expect(isUnlocked(paintById('tangerine'), win)).toBe(false);
    const medals: UnlockState = { achieved: () => false, medals: [0, 3, 1, 0] };
    expect(isUnlocked(paintById('bronze'), medals)).toBe(true);
    expect(isUnlocked(paintById('silver'), medals)).toBe(false);
    expect(isUnlocked(paintById('gold'), medals)).toBe(false);
  });

  it('everything is open with everything done', () => {
    const all: UnlockState = { achieved: () => true, medals: [0, 27, 27, 27] };
    expect(PAINTS.every((p) => isUnlocked(p, all))).toBe(true);
  });

  it('says what it takes', () => {
    expect(unlockText(paintById('ice'), () => '')).toBe('FREE');
    expect(unlockText(paintById('bubblegum'), (id) => `DO ${id}`)).toBe('DO win');
    expect(unlockText(paintById('gold'), () => '')).toBe('EARN 3 GOLD MEDALS');
  });

  it('unknown ids fall back to stock', () => {
    expect(paintById('nonsense').id).toBe('stock');
  });
});

describe('painting the grid', () => {
  const grid = CAR_COLORS.slice(0, 6);

  it('leaves the grid alone for the stock paint', () => {
    const g = paintGrid(grid, 5, PAINTS[0]);
    expect(g.colors).toEqual(grid);
    expect(g.looks.every((l) => l === undefined)).toBe(true);
  });

  it('paints the player and nobody else', () => {
    const p = paintById('bubblegum');
    const g = paintGrid(grid, 5, p);
    expect(g.colors[5]).toBe(p.body);
    expect(g.looks[5]).toEqual({ accent: p.accent, pattern: p.pattern });
    expect(g.looks.filter(Boolean).length).toBe(1);
  });

  it('recolours a computer car that looks like the player', () => {
    // Sunshine yellow against the yellow slot car.
    const yellow = CAR_COLORS.indexOf('#f2c230');
    expect(yellow).toBeGreaterThanOrEqual(0);
    const p = paintById('sunshine');
    expect(colorDistance(CAR_COLORS[yellow], p.body!)).toBeLessThan(TOO_ALIKE);
    const g = paintGrid(CAR_COLORS, 0, p);
    expect(g.colors[yellow]).not.toBe(CAR_COLORS[yellow]);
    for (let i = 1; i < g.colors.length; i++) expect(colorDistance(g.colors[i], p.body!)).toBeGreaterThanOrEqual(TOO_ALIKE);
  });
});
