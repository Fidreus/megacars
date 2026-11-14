// How to play: the goal, the controls (as currently bound) and the tricks.

import { buttonName, keysLabel, type Controls } from '../../input/bindings.ts';
import { drawText, textWidth } from '../font.ts';

const ACTION_ROWS: [string, 'gas' | 'brake' | 'drift' | 'fireFront' | 'fireRear' | 'turbo' | 'special' | 'reset', string][] = [
  ['ACCELERATE', 'gas', ''],
  ['BRAKE / REVERSE', 'brake', ''],
  ['DRIFT', 'drift', 'HOLD WHILE TURNING'],
  ['MISSILE', 'fireFront', 'FIRES FORWARD'],
  ['MINE', 'fireRear', 'DROPS BEHIND YOU'],
  ['TURBO', 'turbo', 'SHORT BOOST'],
  ['SPECIAL ITEM', 'special', 'HOMING, OIL OR SHIELD'],
  ['RESET CAR', 'reset', 'BACK ON THE TRACK'],
];

const TIPS = [
  'THE HIGHER YOU FINISH, THE MORE PRIZE MONEY AND POINTS.',
  'SPEND IT IN THE SHOP: ENGINE, TYRES, ARMOUR, AMMO AND REPAIRS.',
  'LIFT OFF AND HIT THE GAS AGAIN MID-CORNER TO KICK THE TAIL OUT.',
  'HOLD A DRIFT TO CHARGE A BOOST (BLUE, ORANGE, PURPLE SPARKS), THEN STRAIGHTEN UP TO FIRE IT.',
  'TUCK IN RIGHT BEHIND A CAR TO RIDE ITS SLIPSTREAM, THEN PULL OUT AND PASS.',
  'RAIN MAKES THE ROAD SLIPPERY - BRAKE EARLIER.',
  'RAMPS LAUNCH YOU - LAND STRAIGHT OR LOSE SPEED.',
  'DAMAGE SLOWS YOUR CAR. A WRECK COSTS TIME AND A TOW FEE - REPAIR IN THE SHOP.',
  'PIT LANE BY THE START: A DRIVE-THROUGH MENDS 45%+, SLOW DOWN FOR MORE. NO WEAPONS.',
  'FAR BEHIND? THE ARROWS ON THE ROAD GLOW AND GIVE YOU A BOOST TO CATCH UP.',
  'WEAPONS ON: DRIVE THROUGH THE GLOWING CRATES FOR MISSILES, MINES, TURBO OR A REPAIR.',
  'SPECIALS: ONE AT A TIME. A CRATE NEVER SWAPS YOURS - USE IT TO GET ANOTHER.',
  'CAREER: A TOP-THREE SEASON MOVES YOU UP A DIVISION. WIN DIVISION 1!',
  'MODE: ELIMINATION - EACH TIME THE LEADER ENDS A LAP, THE LAST CAR IS OUT.',
  'NEW TO DRIFTING? DRIVING SCHOOL IN THE TITLE MENU TEACHES IT IN FIVE SHORT LESSONS.',
  'KEY 5 TURNS THE SOUND OFF OR ON - MENUS AND RACES EACH HAVE THEIR OWN.',
];

/** Draws page `page` of the tips (short screens get more than one); returns the number of pages. */
export function drawHelp(ctx: CanvasRenderingContext2D, W: number, H: number, c: Controls, touch = false, page = 0): number {
  ctx.fillStyle = 'rgba(6,8,20,0.82)';
  ctx.fillRect(0, 0, W, H);
  let y = Math.round(H * 0.06);
  drawText(ctx, 'HOW TO PLAY', W / 2, y, { scale: 2, color: '#ffd84a', align: 'center' });
  y += 26;
  drawText(ctx, 'RACE, BLAST THE OTHERS AND UPGRADE YOUR CAR WITH THE WINNINGS', W / 2, y, { color: '#ffffff', align: 'center' });
  y += 18;
  if (touch) {
    // The buttons carry their own names; the key table would only get in the way.
    for (const line of wrap('LEFT THUMB STEERS. BUTTONS: DRIFT, BRAKE, MISSILE, MINE, TURBO, AN ITEM WHEN YOU HOLD ONE, RESET, AND II TO PAUSE.', W - 16)) {
      drawText(ctx, line, W / 2, y, { color: '#9fd8ff', align: 'center' });
      y += 10;
    }
    y += 6;
  } else {
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
  }
  // Long tips wrap on narrow screens; tighter lines on short ones; what still doesn't fit is left out.
  const tips = TIPS.filter((t) => !touch || !t.startsWith('KEY ')).map((t) => wrap(`- ${t}`, W - 12));
  const count = tips.reduce((n, t) => n + t.length, 0);
  const step = Math.max(9, Math.min(11, Math.floor((H - 26 - y) / count)));
  const per = Math.max(1, Math.floor((H - 26 - y) / step) + 1);
  // Whole tips per page.
  const pageList: string[][] = [[]];
  for (const t of tips) {
    if (pageList[pageList.length - 1].length + t.length > per && pageList[pageList.length - 1].length) pageList.push([]);
    pageList[pageList.length - 1].push(...t);
  }
  const pages = pageList.length;
  const p = Math.min(page, pages - 1);
  for (const t of pageList[p]) {
    drawText(ctx, t, W / 2, y, { color: '#c8d0dc', align: 'center' });
    y += step;
  }
  const more = p + 1 < pages ? `${touch ? 'TAP' : 'ENTER'} FOR MORE (${p + 1}/${pages})` : '';
  drawText(ctx, more || (touch ? 'TAP TO GO BACK' : 'CHANGE KEYS UNDER OPTIONS > CONTROLS        PRESS ANY KEY TO GO BACK'), W / 2, H - 14, { color: more ? '#ffd84a' : '#8090a8', align: 'center' });
  return pages;
}

/** Split a line at spaces into lines no wider than `room`. */
function wrap(text: string, room: number): string[] {
  if (textWidth(text) <= room) return [text];
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next) > room) {
      out.push(line);
      line = `  ${word}`;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}
