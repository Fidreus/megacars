// Music credits: every bundled song with its composer and licence, and the
// player libraries.

import { SONGS } from '../../audio/music.ts';
import { drawText } from '../font.ts';

export function drawCredits(g: CanvasRenderingContext2D, W: number, H: number, time: number): void {
  g.fillStyle = 'rgba(8,10,24,0.88)';
  g.fillRect(0, 0, W, H);
  let y = Math.round(H * 0.06);
  drawText(g, 'MUSIC CREDITS', W / 2, y, { scale: 2, color: '#ffd84a', align: 'center' });
  y += 24;
  drawText(g, 'MODULES FROM THE MOD ARCHIVE (MODARCHIVE.ORG), C64 SID TRACKS FROM OPENGAMEART.ORG', W / 2, y, { color: '#9fd8ff', align: 'center' });
  y += 16;
  const x0 = Math.round(W / 2 - 190);
  for (const s of Object.values(SONGS)) {
    drawText(g, s.title, x0, y, { color: '#ffffff' });
    drawText(g, s.artist, x0 + 150, y, { color: '#ffd84a' });
    drawText(g, s.licence, x0 + 380, y, { color: s.licence.startsWith('CC') ? '#9cff9c' : '#8090a8', align: 'right' });
    y += 10;
  }
  y += 8;
  drawText(g, 'IMAGINE BY ANDREAS VIKLUND (TSEC) - CREATIVE COMMONS ATTRIBUTION 4.0', W / 2, y, { color: '#9cff9c', align: 'center' });
  y += 14;
  drawText(g, 'PLAYER: CHIPTUNE3 (MIT) WITH LIBOPENMPT (BSD) - OPENMPT PROJECT', W / 2, y, { color: '#8090a8', align: 'center' });
  if (Math.sin(time * 5) > -0.2) drawText(g, 'PRESS ENTER', W / 2, H - 20, { color: '#c8d0dc', align: 'center' });
}
