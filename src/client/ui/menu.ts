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
  /** Greyed out and inactive (e.g. settings only the host may change). */
  disabled?: () => boolean;
  /** A text field: typing edits the value. */
  text?: { get(): string; set(v: string): void; max: number; allowed: RegExp };
}

/** Step v by d through 0..n-1, wrapping round. */
export function cycle(v: number, n: number, d: number): number {
  return (((v + d) % n) + n) % n;
}

export interface MenuEvents {
  onMove?: () => void;
  onChange?: () => void;
  onSelect?: () => void;
}

export class Menu {
  index = 0;
  items: MenuItem[];
  private rects: { x: number; y: number; w: number; h: number; item: number }[] = [];
  /** First item shown when the list is taller than the screen (scrolled). */
  private first = 0;
  /** Items shown at once when scrolled (0 = all fit). */
  private window = 0;
  private readonly events: MenuEvents;
  private blink = 0;
  /** Row height when last drawn, and swipe distance not yet turned into whole rows. */
  private rowH = 13;
  private swipe = 0;

  constructor(items: MenuItem[], events: MenuEvents = {}) {
    this.items = items;
    this.events = events;
  }

  /** Where each shown row was drawn (UI pixels; item -1/-2 = scroll arrows). */
  get hitRects(): readonly { x: number; y: number; w: number; h: number; item: number }[] {
    return this.rects;
  }

  /** The selected item is a text field (letters should type, not navigate). */
  get typing(): boolean {
    const it = this.items[this.index];
    return !!it?.text && !it.disabled?.();
  }

  handle(nav: NavState): void {
    const n = this.items.length;
    if (this.index >= n) this.index = 0;
    const field = this.typing ? this.items[this.index].text : undefined;
    if (field && (nav.typed || nav.erase)) {
      let v = field.get();
      if (nav.erase) v = v.slice(0, -1);
      for (const ch of nav.typed.toUpperCase()) if (field.allowed.test(ch) && v.length < field.max) v += ch;
      field.set(v);
      this.events.onChange?.();
    }
    if (nav.scrollY && this.window > 0) {
      // Swipe or wheel: move the list under the finger, a row at a time.
      this.swipe += nav.scrollY;
      const rows = Math.trunc(this.swipe / this.rowH);
      if (rows) {
        this.swipe -= rows * this.rowH;
        const shown = this.window;
        this.first = Math.max(0, Math.min(n - shown, this.first - rows));
        this.index = Math.max(this.first, Math.min(this.first + shown - 1, this.index));
      }
    }
    if (nav.up) {
      this.index = (this.index - 1 + n) % n;
      this.events.onMove?.();
    }
    if (nav.down) {
      this.index = (this.index + 1) % n;
      this.events.onMove?.();
    }
    const item = this.items[this.index];
    if ((nav.left || nav.right) && item.change && !item.disabled?.()) {
      item.change(nav.left ? -1 : 1);
      this.events.onChange?.();
    }
    if (nav.confirm) this.activate(item, 1);
    if (nav.pointerMoved || nav.click) {
      const hit = this.rects.findIndex((r) => nav.pointerX >= r.x && nav.pointerX < r.x + r.w && nav.pointerY >= r.y && nav.pointerY < r.y + r.h);
      const item = hit >= 0 ? this.rects[hit].item : -1;
      if (item < 0 && hit >= 0 && nav.click) {
        // A scroll arrow: show the previous/next page (keeping one row of overlap)
        // and keep the selection inside what is shown.
        const rows = Math.max(1, this.window);
        const n = this.items.length;
        this.first = Math.max(0, Math.min(n - rows, this.first + (item === -1 ? -(rows - 1) : rows - 1)));
        this.index = Math.max(this.first, Math.min(this.first + rows - 1, this.index));
        this.events.onMove?.();
        return;
      }
      if (item >= 0 && item !== this.index) {
        this.index = item;
        this.events.onMove?.();
      }
      if (nav.click && hit >= 0) {
        const r = this.rects[hit];
        const it = this.items[r.item];
        // Clicking the left third of a value item steps it down.
        if (r.item >= 0) this.activate(it, it.change && nav.pointerX < r.x + r.w / 3 ? -1 : 1);
      }
    }
  }

  private activate(item: MenuItem, dir: number): void {
    if (item.disabled?.()) return;
    if (item.select) {
      item.select();
      this.events.onSelect?.();
    } else if (item.change) {
      item.change(dir);
      this.events.onChange?.();
    }
  }

  /** Draw centred at (cx, top) with the given text scale. */
  /** Draw centred at (cx, top); a list taller than `bottom` scrolls with the selection. */
  draw(ctx: CanvasRenderingContext2D, cx: number, top: number, scale = 1, dt = 0, panel = true, bottom = Infinity): void {
    this.blink += dt;
    this.rects = [];
    const rowH = LINE_H * scale + 4;
    this.rowH = rowH;
    const widest = Math.max(...this.items.map((it) => textWidth(it.label(), scale))) + 28 * scale;
    const n = this.items.length;
    let rows = Math.max(3, Math.floor((bottom - top) / rowH));
    const scroll = rows < n;
    if (scroll) {
      rows -= 2; // the ↑ and ↓ rows
      if (this.index < this.first) this.first = this.index;
      if (this.index >= this.first + rows) this.first = this.index - rows + 1;
      this.first = Math.max(0, Math.min(n - rows, this.first));
    } else {
      this.first = 0;
      rows = n;
    }
    this.window = scroll ? rows : 0;
    const shown = scroll ? rows + 2 : n;
    if (panel) {
      const pw = widest + 24;
      const ph = shown * rowH + 12;
      ctx.fillStyle = 'rgba(8,10,24,0.72)';
      ctx.fillRect(Math.round(cx - pw / 2), top - 9, Math.round(pw), ph);
      ctx.fillStyle = '#ffd84a';
      ctx.fillRect(Math.round(cx - pw / 2), top - 9, Math.round(pw), 1);
      ctx.fillRect(Math.round(cx - pw / 2), top - 9 + ph - 1, Math.round(pw), 1);
    }
    let y0 = top;
    const arrow = (label: string, item: number, on: boolean) => {
      drawText(ctx, label, cx, y0, { scale, color: on ? '#ffd84a' : '#3a4256', align: 'center' });
      this.rects.push({ x: cx - widest / 2, y: y0 - 3, w: widest, h: rowH, item });
      y0 += rowH;
    };
    if (scroll) arrow('↑', -1, this.first > 0);
    this.items.forEach((it, i) => {
      if (i < this.first || i >= this.first + rows) return;
      const y = y0;
      y0 += rowH;
      const off = it.disabled?.() ?? false;
      let label = it.label();
      const selected = i === this.index;
      if (it.text && selected && !off && Math.sin(this.blink * 8) > 0) label += '_';
      else if (it.text) label += ' ';
      if (selected) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(Math.round(cx - widest / 2), y - 3, Math.round(widest), rowH - 1);
        const pulse = Math.sin(this.blink * 8) > -0.3;
        const color = pulse ? '#ffd84a' : '#ffb000';
        if (off) {
          // No arrows on inactive items.
        } else if (it.change) {
          drawText(ctx, '←', cx - widest / 2 + 4, y, { scale, color });
          drawText(ctx, '→', cx + widest / 2 - 4 - 5 * scale, y, { scale, color });
        } else {
          drawText(ctx, '>', cx - widest / 2 + 4, y, { scale, color });
        }
      }
      drawText(ctx, label, cx, y, { scale, color: off ? '#6a7488' : selected ? '#ffffff' : '#c8d0dc', align: 'center' });
      this.rects.push({ x: cx - widest / 2, y: y - 3, w: widest, h: rowH, item: i });
    });
    if (scroll) arrow('↓', -2, this.first + rows < n);
  }
}
