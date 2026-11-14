// Title screen: a chunky chrome-style logo over the attract-mode race.

import { drawText, textWidth } from '../font.ts';

/** Where drawLogo(…, top, maxWidth, …) ends (the y it returns), without drawing. */
export function logoBottom(top: number, maxWidth: number): number {
  const scale = Math.max(3, Math.min(9, Math.floor(maxWidth / textWidth('MEGACARS', 1))));
  return top + 7 * scale + 8 + (scale >= 6 ? 18 : 10);
}

export function drawLogo(ctx: CanvasRenderingContext2D, cx: number, top: number, maxWidth: number, time: number): number {
  const text = 'MEGACARS';
  const scale = Math.max(3, Math.min(9, Math.floor(maxWidth / textWidth(text, 1))));
  const w = textWidth(text, scale);
  const h = 7 * scale;
  const x = Math.round(cx - w / 2);
  // Outline.
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2], [-2, 2], [2, -2], [3, 3], [4, 4]]) {
    drawText(ctx, text, x + dx, top + dy, { scale, color: '#120a1e', shadow: null });
  }
  // Gradient bands: yellow top, orange middle, red bottom, white glint.
  const bands: [string, number, number][] = [
    ['#fff3a0', 0, 0.22],
    ['#ffd84a', 0.22, 0.5],
    ['#ff9a1f', 0.5, 0.72],
    ['#e8322a', 0.72, 1.01],
  ];
  for (const [color, a, b] of bands) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 4, top + Math.round(h * a), w + 8, Math.ceil(h * (b - a)));
    ctx.clip();
    drawText(ctx, text, x, top, { scale, color, shadow: null });
    ctx.restore();
  }
  // A glint sweeping across.
  const gx = ((time * 0.6) % 1.6) * (w + 60) - 30;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + gx, top, Math.max(2, scale), h);
  ctx.clip();
  drawText(ctx, text, x, top, { scale, color: '#ffffff', shadow: null });
  ctx.restore();
  drawText(ctx, 'RETRO COMBAT RACING', cx, top + h + 8, { color: '#9fd8ff', align: 'center', scale: scale >= 6 ? 2 : 1 });
  return top + h + 8 + (scale >= 6 ? 18 : 10);
}
