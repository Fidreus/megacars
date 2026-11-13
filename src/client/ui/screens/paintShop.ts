// The paint shop: the three cars (drawn by the Showroom behind this) in the
// paint under the cursor. Left/right looks through the paints, ENTER picks
// one that is unlocked; locked ones say what unlocks them.

import type { NavState } from '../../input/nav.ts';
import { PAINTS, isUnlocked, unlockText, type PaintJob, type UnlockState } from '../../game/paints.ts';
import { drawText } from '../font.ts';

export interface PaintShopHooks {
  unlockState(): UnlockState;
  /** What an achievement asks for, e.g. "WIN A RACE". */
  achievementText(id: string): string;
  chosen(): string;
  choose(id: string): void;
  /** The paint under the cursor changed (the stage shows it). */
  look(paint: PaintJob): void;
  onBack(): void;
  sound(kind: 'move' | 'select' | 'deny'): void;
}

const CHIP = 14;
const GAP = 4;

export class PaintShopScreen {
  index = 0;
  private chips: { x: number; y: number; w: number; h: number }[] = [];
  private readonly hooks: PaintShopHooks;
  private W = 1;

  constructor(hooks: PaintShopHooks) {
    this.hooks = hooks;
  }

  open(): void {
    this.index = Math.max(0, PAINTS.findIndex((p) => p.id === this.hooks.chosen()));
    this.hooks.look(PAINTS[this.index]);
  }

  private move(to: number): void {
    this.index = ((to % PAINTS.length) + PAINTS.length) % PAINTS.length;
    this.hooks.look(PAINTS[this.index]);
    this.hooks.sound('move');
  }

  private pick(): void {
    const p = PAINTS[this.index];
    if (isUnlocked(p, this.hooks.unlockState())) {
      this.hooks.choose(p.id);
      this.hooks.sound('select');
    } else this.hooks.sound('deny');
  }

  handle(nav: NavState): void {
    if (nav.back) {
      this.hooks.onBack();
      return;
    }
    if (nav.left) this.move(this.index - 1);
    else if (nav.right) this.move(this.index + 1);
    else if (nav.up) this.move(this.index - 1);
    else if (nav.down) this.move(this.index + 1);
    if (nav.confirm) this.pick();
    if (nav.click) {
      const hit = this.chips.findIndex((c) => nav.pointerX >= c.x && nav.pointerX < c.x + c.w && nav.pointerY >= c.y - 2 && nav.pointerY < c.y + c.h + 2);
      if (hit >= 0) {
        if (hit === this.index) this.pick();
        else this.move(hit);
      } else if (nav.pointerY < this.chips[0]?.y) {
        // Tap the stage: the left half goes back, the right half on; the middle picks.
        if (nav.pointerX < this.W * 0.3) this.move(this.index - 1);
        else if (nav.pointerX > this.W * 0.7) this.move(this.index + 1);
        else this.pick();
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    this.W = W;
    const state = this.hooks.unlockState();
    const p = PAINTS[this.index];
    const open = isUnlocked(p, state);
    const short = H < 320;
    const k = short ? 1 : 2;
    // Bands for the text, the stage shows between them.
    ctx.fillStyle = 'rgba(6,8,20,0.7)';
    ctx.fillRect(0, 0, W, short ? 34 : 56);
    drawText(ctx, 'PAINT SHOP', W / 2, 5, { scale: short ? 1 : 2, color: '#ffd84a', align: 'center' });
    const nameY = short ? 16 : 26;
    drawText(ctx, p.name, W / 2, nameY, { scale: k, color: open ? '#ffffff' : '#8090a8', align: 'center' });
    const status = open ? (this.hooks.chosen() === p.id ? 'IN USE' : 'UNLOCKED - ENTER TO USE IT') : `LOCKED - ${unlockText(p, this.hooks.achievementText)}`;
    drawText(ctx, status, W / 2, nameY + (short ? 11 : 20), { color: open ? '#9cff9c' : '#ff9a5e', align: 'center' });

    // The chips: one per paint, the chosen one ringed, locked ones dimmed.
    const total = PAINTS.length * (CHIP + GAP) - GAP;
    const x0 = Math.round(W / 2 - total / 2);
    const y = H - (short ? 46 : 52);
    ctx.fillStyle = 'rgba(6,8,20,0.7)';
    ctx.fillRect(0, y - 8, W, H - y + 8);
    this.chips = [];
    PAINTS.forEach((paint, i) => {
      const x = x0 + i * (CHIP + GAP);
      const on = isUnlocked(paint, state);
      this.chips.push({ x, y, w: CHIP, h: CHIP });
      ctx.fillStyle = paint.body ?? '#e8322a';
      ctx.fillRect(x, y, CHIP, CHIP);
      ctx.fillStyle = paint.accent;
      if (paint.pattern === 'halves') ctx.fillRect(x, y, CHIP / 2, CHIP);
      else if (paint.pattern === 'twotone') ctx.fillRect(x, y, CHIP, CHIP / 2);
      else if (paint.pattern === 'bands') {
        ctx.fillRect(x, y + 2, CHIP, 3);
        ctx.fillRect(x, y + 8, CHIP, 3);
      } else if (paint.pattern === 'chequer') {
        for (const [cx, cy] of [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]]) ctx.fillRect(x + 2 + cx * 4, y + 2 + cy * 4, 4, 4);
      } else if (paint.pattern === 'dual') {
        ctx.fillRect(x + 3, y, 3, CHIP);
        ctx.fillRect(x + 8, y, 3, CHIP);
      } else if (paint.pattern === 'stripe') ctx.fillRect(x + 5, y, 4, CHIP);
      if (!on) {
        ctx.fillStyle = 'rgba(6,8,20,0.7)';
        ctx.fillRect(x, y, CHIP, CHIP);
        drawText(ctx, '?', x + 4, y + 4, { color: '#8090a8', shadow: null });
      }
      if (i === this.index) {
        ctx.strokeStyle = '#ffd84a';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 2, y - 2, CHIP + 4, CHIP + 4);
      } else if (paint.id === this.hooks.chosen()) {
        ctx.fillStyle = '#9cff9c';
        ctx.fillRect(x, y + CHIP + 2, CHIP, 2);
      }
    });
    const have = PAINTS.filter((q) => isUnlocked(q, state)).length;
    drawText(ctx, `${have}/${PAINTS.length} PAINTS UNLOCKED`, W / 2, y + CHIP + 6, { color: '#c8d0dc', align: 'center' });
    drawText(ctx, '←→ LOOK   ENTER USE   ESC BACK', W / 2, H - 11, { color: '#8090a8', align: 'center' });
  }
}
