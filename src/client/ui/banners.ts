// Small banners (a medal won, an achievement unlocked): a title and a line of
// text sliding in at the top centre, one after the other. They stay between
// the position box (top left) and the minimap (top right) and well clear of
// the middle of the screen, so they never hide the road in a race.

import { drawText, textWidth } from './font.ts';

export interface Banner {
  title: string;
  text: string;
  /** Title colour and accent bar. */
  color: string;
}

const IN = 0.25;
const OUT = 0.3;
const HOLD = 3.4;

export class BannerQueue {
  private readonly queue: Banner[] = [];
  private current: Banner | null = null;
  private age = 0;

  push(b: Banner): void {
    this.queue.push(b);
  }

  /** Nothing showing or waiting. */
  get idle(): boolean {
    return !this.current && this.queue.length === 0;
  }

  clear(): void {
    this.queue.length = 0;
    this.current = null;
  }

  update(dt: number): void {
    if (!this.current) {
      this.current = this.queue.shift() ?? null;
      this.age = 0;
      return;
    }
    this.age += dt;
    // A long queue moves a little faster.
    if (this.age > IN + HOLD + OUT || (this.queue.length > 2 && this.age > IN + 1.4)) this.current = null;
  }

  /** `maxWidth`: the room between the other HUD parts. */
  draw(ctx: CanvasRenderingContext2D, W: number, maxWidth = W - 240): void {
    const b = this.current;
    if (!b) return;
    const w = Math.min(Math.max(80, maxWidth), Math.max(textWidth(b.title), textWidth(b.text)) + 22);
    const h = 25;
    const slide = this.age < IN ? 1 - this.age / IN : this.age > IN + HOLD ? (this.age - IN - HOLD) / OUT : 0;
    const x = Math.round(W / 2 - w / 2);
    const y = Math.round(5 - slide * (h + 8));
    ctx.fillStyle = 'rgba(8,10,24,0.86)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = b.color;
    ctx.fillRect(x, y, 3, h);
    ctx.fillRect(x, y + h - 1, w, 1);
    drawText(ctx, b.title, x + 3 + (w - 3) / 2, y + 4, { color: b.color, align: 'center' });
    drawText(ctx, b.text, x + 3 + (w - 3) / 2, y + 14, { color: '#ffffff', align: 'center' });
  }
}
