// A vertical list menu: up/down selects, left/right changes values, confirm
// activates. Mouse hover selects and clicks activate (or step values when
// clicking the arrows).

import type { NavState } from '../input/nav.ts';
import { drawText, LINE_H, textWidth } from './font.ts';

export interface MenuItem {
  label: () => string;
  /** Called with -1 / +1 for left / right. Items without it are buttons. */
  change?: (dir: number) => void;
  select?: () => void;
}

export interface MenuEvents {
  onMove?: () => void;
  onChange?: () => void;
  onSelect?: () => void;
}

export class Menu {
  index = 0;
  items: MenuItem[];
  private rects: { x: number; y: number; w: number; h: number }[] = [];
  private readonly events: MenuEvents;
  private blink = 0;

  constructor(items: MenuItem[], events: MenuEvents = {}) {
    this.items = items;
    this.events = events;
  }

  handle(nav: NavState): void {
    const n = this.items.length;
    if (nav.up) {
      this.index = (this.index - 1 + n) % n;
      this.events.onMove?.();
    }
    if (nav.down) {
      this.index = (this.index + 1) % n;
      this.events.onMove?.();
    }
    const item = this.items[this.index];
    if ((nav.left || nav.right) && item.change) {
      item.change(nav.left ? -1 : 1);
      this.events.onChange?.();
    }
    if (nav.confirm) this.activate(item, 1);
    if (nav.pointerMoved || nav.click) {
      const hit = this.rects.findIndex((r) => nav.pointerX >= r.x && nav.pointerX < r.x + r.w && nav.pointerY >= r.y && nav.pointerY < r.y + r.h);
      if (hit >= 0 && hit !== this.index) {
        this.index = hit;
        this.events.onMove?.();
      }
      if (nav.click && hit >= 0) {
        const r = this.rects[hit];
        const it = this.items[hit];
        // Clicking the left third of a value item steps it down.
        this.activate(it, it.change && nav.pointerX < r.x + r.w / 3 ? -1 : 1);
      }
    }
  }

  private activate(item: MenuItem, dir: number): void {
    if (item.select) {
      item.select();
      this.events.onSelect?.();
    } else if (item.change) {
      item.change(dir);
      this.events.onChange?.();
    }
  }

  /** Draw centred at (cx, top) with the given text scale. */
  draw(ctx: CanvasRenderingContext2D, cx: number, top: number, scale = 1, dt = 0, panel = true): void {
    this.blink += dt;
    this.rects = [];
    const rowH = LINE_H * scale + 4;
    const widest = Math.max(...this.items.map((it) => textWidth(it.label(), scale))) + 28 * scale;
    if (panel) {
      const pw = widest + 24;
      const ph = this.items.length * rowH + 12;
      ctx.fillStyle = 'rgba(8,10,24,0.72)';
      ctx.fillRect(Math.round(cx - pw / 2), top - 9, Math.round(pw), ph);
      ctx.fillStyle = '#ffd84a';
      ctx.fillRect(Math.round(cx - pw / 2), top - 9, Math.round(pw), 1);
      ctx.fillRect(Math.round(cx - pw / 2), top - 9 + ph - 1, Math.round(pw), 1);
    }
    this.items.forEach((it, i) => {
      const y = top + i * rowH;
      const label = it.label();
      const selected = i === this.index;
      if (selected) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(Math.round(cx - widest / 2), y - 3, Math.round(widest), rowH - 1);
        const pulse = Math.sin(this.blink * 8) > -0.3;
        const color = pulse ? '#ffd84a' : '#ffb000';
        if (it.change) {
          drawText(ctx, '←', cx - widest / 2 + 4, y, { scale, color });
          drawText(ctx, '→', cx + widest / 2 - 4 - 5 * scale, y, { scale, color });
        } else {
          drawText(ctx, '>', cx - widest / 2 + 4, y, { scale, color });
        }
      }
      drawText(ctx, label, cx, y, { scale, color: selected ? '#ffffff' : '#c8d0dc', align: 'center' });
      this.rects.push({ x: cx - widest / 2, y: y - 3, w: widest, h: rowH });
    });
  }
}
