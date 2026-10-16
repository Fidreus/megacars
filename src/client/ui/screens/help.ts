// How to play: the goal, the controls (as currently bound) and the tricks.

import { buttonName, keysLabel, type Controls } from '../../input/bindings.ts';
import { drawText } from '../font.ts';

const ACTION_ROWS: [string, 'gas' | 'brake' | 'drift' | 'fireFront' | 'fireRear' | 'turbo' | 'reset', string][] = [
  ['ACCELERATE', 'gas', ''],
  ['BRAKE / REVERSE', 'brake', ''],
  ['DRIFT', 'drift', 'HOLD WHILE TURNING'],
  ['MISSILE', 'fireFront', 'FIRES FORWARD'],
  ['MINE', 'fireRear', 'DROPS BEHIND YOU'],
  ['TURBO', 'turbo', 'SHORT BOOST'],
  ['RESET CAR', 'reset', 'BACK ON THE TRACK'],
];

const TIPS = [
  'THE HIGHER YOU FINISH, THE MORE PRIZE MONEY AND POINTS.',
  'SPEND IT IN THE SHOP: ENGINE, TYRES, ARMOUR, AMMO AND REPAIRS.',
  'LIFT OFF AND HIT THE GAS AGAIN MID-CORNER TO KICK THE TAIL OUT.',
  'RAMPS LAUNCH YOU - LAND STRAIGHT OR LOSE SPEED.',
  'DAMAGE SLOWS YOUR CAR. A WRECK COSTS TIME AND A TOW FEE - REPAIR IN THE SHOP.',
  'PIT LANE BY THE START: 20% REPAIRED A SECOND, NO WEAPONS. DRIFTING MENDS A LITTLE.',
  'CAREER: A TOP-THREE SEASON MOVES YOU UP A DIVISION. WIN DIVISION 1!',
  'KEY 5 TURNS THE SOUND OFF OR ON - MENUS AND RACES EACH HAVE THEIR OWN.',
];

export function drawHelp(ctx: CanvasRenderingContext2D, W: number, H: number, c: Controls): void {
  ctx.fillStyle = 'rgba(6,8,20,0.82)';
  ctx.fillRect(0, 0, W, H);
  let y = Math.round(H * 0.06);
  drawText(ctx, 'HOW TO PLAY', W / 2, y, { scale: 2, color: '#ffd84a', align: 'center' });
  y += 26;
  drawText(ctx, 'RACE, BLAST THE OTHERS AND UPGRADE YOUR CAR WITH THE WINNINGS', W / 2, y, { color: '#ffffff', align: 'center' });
  y += 18;
  const col = [Math.round(W / 2 - 230), Math.round(W / 2 - 110), Math.round(W / 2 + 10), Math.round(W / 2 + 110)];
  drawText(ctx, 'ACTION', col[0], y, { color: '#8090a8' });
  drawText(ctx, 'KEYS', col[1], y, { color: '#8090a8' });
  drawText(ctx, 'GAMEPAD', col[2], y, { color: '#8090a8' });
  y += 12;
  drawText(ctx, 'STEER', col[0], y, { color: '#c8d0dc' });
  drawText(ctx, `${keysLabel(c.solo, 'left')} ${keysLabel(c.solo, 'right')}`, col[1], y, { color: '#ffffff' });
  drawText(ctx, 'STICK / D-PAD', col[2], y, { color: '#ffffff' });
  y += 11;
  for (const [name, a, note] of ACTION_ROWS) {
    drawText(ctx, name, col[0], y, { color: '#c8d0dc' });
    drawText(ctx, keysLabel(c.solo, a), col[1], y, { color: '#ffffff' });
    drawText(ctx, c.pad[a].map(buttonName).join('/') || '-', col[2], y, { color: '#ffffff' });
    if (note) drawText(ctx, note, col[3], y, { color: '#9fd8ff' });
    y += 11;
  }
  drawText(ctx, 'PAUSE', col[0], y, { color: '#c8d0dc' });
  drawText(ctx, 'ESC / P', col[1], y, { color: '#ffffff' });
  drawText(ctx, 'START', col[2], y, { color: '#ffffff' });
  y += 18;
  // Tighter lines on short (phone) screens; tips that still don't fit are left out.
  const step = Math.max(9, Math.min(11, Math.floor((H - 26 - y) / TIPS.length)));
  for (const t of TIPS) {
    if (y > H - 26) break;
    drawText(ctx, `- ${t}`, W / 2, y, { color: '#c8d0dc', align: 'center' });
    y += step;
  }
  drawText(ctx, 'CHANGE KEYS UNDER OPTIONS > CONTROLS        PRESS ANY KEY TO GO BACK', W / 2, H - 14, { color: '#8090a8', align: 'center' });
}
