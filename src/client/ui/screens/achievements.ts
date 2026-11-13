// The achievements page: every achievement, locked ones dimmed, progress where
// it is a count, a total at the top and the selected one explained below.

import type { NavState } from '../../input/nav.ts';
import type { Achievements } from '../../game/achievements.ts';
import { drawText } from '../font.ts';

export class AchievementsScreen {
  index = 0;
  /** First row shown. */
  private first = 0;
  private rows = 1;
  private rowH = 11;
  private top = 0;
  private left = 0;
  private swipe = 0;
  private readonly onBack: () => void;
  private readonly onMove: () => void;
  private readonly ach: Achievements;

  constructor(ach: Achievements, onBack: () => void, onMove: () => void) {
    this.ach = ach;
    this.onBack = onBack;
    this.onMove = onMove;
  }

  open(): void {
    this.index = 0;
    this.first = 0;
  }

  handle(nav: NavState): void {
    const n = this.ach.rules.length;
    if (nav.back) {
      this.onBack();
      return;
    }
    let d = nav.up ? -1 : nav.down ? 1 : 0;
    if (nav.left) d = -this.rows;
    if (nav.right) d = this.rows;
    if (d) {
      this.index = Math.max(0, Math.min(n - 1, this.index + d));
      this.onMove();
    }
    if (nav.scrollY) {
      this.swipe += nav.scrollY;
      const rows = Math.trunc(this.swipe / this.rowH);
      if (rows) {
        this.swipe -= rows * this.rowH;
        this.first = Math.max(0, Math.min(n - this.rows, this.first - rows));
        this.index = Math.max(this.first, Math.min(this.first + this.rows - 1, this.index));
      }
    }
    if (nav.click && nav.pointerY >= this.top && nav.pointerY < this.top + this.rows * this.rowH) {
      const i = this.first + Math.floor((nav.pointerY - this.top) / this.rowH);
      if (i < n && i !== this.index) {
        this.index = i;
        this.onMove();
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const list = this.ach.rules;
    const n = list.length;
    ctx.fillStyle = 'rgba(6,8,20,0.84)';
    ctx.fillRect(0, 0, W, H);
    const short = H < 320;
    let y = Math.round(H * 0.04);
    const { done, all } = this.ach.total;
    drawText(ctx, 'ACHIEVEMENTS', W / 2, y, { scale: short ? 1 : 2, color: '#ffd84a', align: 'center' });
    y += short ? 12 : 20;
    // A bar for the total.
    const bw = Math.min(220, W - 40);
    const bx = Math.round(W / 2 - bw / 2);
    ctx.fillStyle = '#1a2036';
    ctx.fillRect(bx, y, bw, 7);
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(bx, y, Math.round((bw * done) / all), 7);
    y += 10;
    drawText(ctx, `${done}/${all} UNLOCKED`, W / 2, y, { color: '#ffffff', align: 'center' });
    y += short ? 12 : 15;

    // The detail box at the bottom, the list in between.
    const detailH = 32;
    const bottom = H - 24 - detailH;
    this.rowH = short ? 10 : 12;
    this.top = y;
    this.rows = Math.max(3, Math.min(n, Math.floor((bottom - y) / this.rowH)));
    if (this.index < this.first) this.first = this.index;
    if (this.index >= this.first + this.rows) this.first = this.index - this.rows + 1;
    this.first = Math.max(0, Math.min(n - this.rows, this.first));
    const lw = Math.min(W - 24, 300);
    this.left = Math.round(W / 2 - lw / 2);
    for (let r = 0; r < this.rows; r++) {
      const i = this.first + r;
      const rule = list[i];
      const ry = this.top + r * this.rowH;
      const got = this.ach.isUnlocked(rule.id);
      const sel = i === this.index;
      if (sel) {
        ctx.fillStyle = 'rgba(255,216,74,0.16)';
        ctx.fillRect(this.left - 4, ry - 2, lw + 8, this.rowH);
        ctx.fillStyle = '#ffd84a';
        ctx.fillRect(this.left - 4, ry - 2, 2, this.rowH);
      }
      drawText(ctx, got ? '■' : '□', this.left + 2, ry, { color: got ? '#ffd84a' : '#4a5470' });
      drawText(ctx, rule.name, this.left + 14, ry, { color: got ? '#ffffff' : sel ? '#aab4c8' : '#6a7488' });
      const goal = rule.goal ?? 1;
      if (goal > 1) {
        const text = `${this.ach.progress(rule)}/${goal}`;
        drawText(ctx, text, this.left + lw - 2, ry, { color: got ? '#9cff9c' : '#8090a8', align: 'right' });
      } else if (got) {
        drawText(ctx, 'DONE', this.left + lw - 2, ry, { color: '#9cff9c', align: 'right' });
      }
    }
    // Scroll marks.
    if (this.first > 0) drawText(ctx, '↑', this.left + lw + 8, this.top, { color: '#ffd84a' });
    if (this.first + this.rows < n) drawText(ctx, '↓', this.left + lw + 8, this.top + (this.rows - 1) * this.rowH, { color: '#ffd84a' });

    // What the selected one asks for.
    const rule = list[this.index];
    const got = this.ach.isUnlocked(rule.id);
    const goal = rule.goal ?? 1;
    const dy = H - 24 - detailH + 3;
    ctx.fillStyle = 'rgba(8,10,24,0.8)';
    ctx.fillRect(this.left - 4, dy - 3, lw + 8, detailH);
    drawText(ctx, rule.name, W / 2, dy, { color: got ? '#ffd84a' : '#c8d0dc', align: 'center' });
    drawText(ctx, rule.desc, W / 2, dy + 11, { color: '#ffffff', align: 'center' });
    const note = got ? 'UNLOCKED' : goal > 1 ? `PROGRESS ${this.ach.progress(rule)}/${goal}` : 'LOCKED';
    drawText(ctx, note, W / 2, dy + 21, { color: got ? '#9cff9c' : '#8090a8', align: 'center' });
    drawText(ctx, '↑↓ SELECT   ESC BACK', W / 2, H - 11, { color: '#8090a8', align: 'center' });
  }
}
