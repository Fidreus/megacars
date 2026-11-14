// The shop between races: upgrades (engine, tyres, armour), ammo and
// repairs, with the car's stats next to it. Used by offline championships
// and online seasons; where the money lives is up to the context.

import { DEFAULT_TUNING } from '../../../shared/config/tuning.ts';
import {
  AMMO_MAX, CAR_MODELS, defaultLoadout, MAX_LEVEL, priceOf, SPECIAL_KIND, SPECIALS, tuningFor, type Profile, type ShopItem,
} from '../../../shared/game/shop.ts';
import { SPECIAL_NAMES } from '../../../shared/sim/specials.ts';
import { drawText, textWidth } from '../font.ts';
import { Menu, type MenuEvents, type MenuItem } from '../menu.ts';
import type { NavState } from '../../input/nav.ts';

export interface ShopContext {
  /** Heading, e.g. "P1 SHOP" or "RACE 2 OF 3". */
  title(): string;
  /** The profile being spent from (null while waiting for the server). */
  profile(): Profile | null;
  /** Try to buy; returns an error text to show, or null. */
  buy(item: ShopItem): string | null;
  doneLabel(): string;
  done(): void;
  /** Ammo is only on sale when weapons are on. */
  weapons(): boolean;
}

const LABELS: Record<ShopItem, string> = {
  car: 'CAR',
  engine: 'ENGINE', tyres: 'TYRES', armour: 'ARMOUR', missiles: 'MISSILES', mines: 'MINES', turbos: 'TURBO', repair: 'REPAIR',
  homing: 'HOMING MISSILE', oil: 'OIL SLICK', shield: 'SHIELD',
};

export class ShopScreen {
  readonly menu: Menu;
  private readonly ctx: ShopContext;
  private message = '';
  private messageTime = 0;
  private flashMoney = 0;
  /** Which special item the SPECIAL row offers (left/right). */
  private special = 0;

  constructor(ctx: ShopContext, events: MenuEvents & { onBuy?: () => void; onDeny?: () => void }) {
    this.ctx = ctx;
    const item = (it: ShopItem): MenuItem => ({
      label: () => this.label(it),
      disabled: () => !ctx.profile() || (!ctx.weapons() && (it === 'missiles' || it === 'mines' || it === 'turbos')),
      select: () => {
        const err = ctx.buy(it);
        if (err) {
          this.say(err);
          events.onDeny?.();
        } else {
          this.flashMoney = 0.4;
          events.onBuy?.();
        }
      },
    });
    this.menu = new Menu([
      item('car'),
      item('engine'), item('tyres'), item('armour'),
      item('missiles'), item('mines'), item('turbos'),
      {
        // One row for the three special items: left/right picks, select buys into the empty slot.
        label: () => this.specialLabel(),
        change: (d) => (this.special = (this.special + d + SPECIALS.length) % SPECIALS.length),
        disabled: () => !ctx.profile() || !ctx.weapons(),
        select: () => {
          const err = ctx.buy(SPECIALS[this.special]);
          if (err) {
            this.say(err);
            events.onDeny?.();
          } else {
            this.flashMoney = 0.4;
            events.onBuy?.();
          }
        },
      },
      item('repair'),
      { label: () => ctx.doneLabel(), select: () => ctx.done() },
    ], events);
  }

  say(text: string): void {
    this.message = text;
    this.messageTime = 2;
  }

  handle(nav: NavState): void {
    this.menu.handle(nav);
  }

  private specialLabel(): string {
    const p = this.ctx.profile();
    if (p?.special) return `SPECIAL  ${SPECIAL_NAMES[p.special]}  HELD`;
    const it = SPECIALS[this.special];
    const price = p ? priceOf(p, it) : null;
    return `SPECIAL < ${LABELS[it]} >${price === null ? '' : `  $${price}`}`;
  }

  private label(it: ShopItem): string {
    const p = this.ctx.profile();
    if (!p) return LABELS[it];
    const price = priceOf(p, it);
    const cost = price === null ? '' : `  $${price}`;
    if (it === 'car') {
      const now = CAR_MODELS[p.car ?? 0].name;
      const next = CAR_MODELS[(p.car ?? 0) + 1];
      return next ? `CAR ${now} > ${next.name}${cost}` : `CAR ${now}  BEST`;
    }
    if (it === 'engine' || it === 'tyres' || it === 'armour') {
      const pips = '■'.repeat(p[it]) + '□'.repeat(MAX_LEVEL - p[it]);
      return `${LABELS[it]} ${pips}${price === null ? '  MAX' : cost}`;
    }
    if (it === 'repair') return price === null ? 'REPAIR  NO DAMAGE' : `REPAIR ${Math.round(p.damage * 100)}%${cost}`;
    if (it === 'homing' || it === 'oil' || it === 'shield') return `${LABELS[it]}${p.special === SPECIAL_KIND[it] ? '  HELD' : cost}`;
    return `${LABELS[it]} ${p[it]}/${AMMO_MAX[it]}${price === null ? '  FULL' : cost}`;
  }

  draw(g: CanvasRenderingContext2D, W: number, H: number, dt: number): void {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, W, H);
    const p = this.ctx.profile();
    const big = H >= 330 ? 2 : 1;
    let y = Math.round(H * 0.05);
    drawText(g, this.ctx.title(), W / 2, y, { scale: big * 1.5 >= 3 ? 3 : 2, color: '#ffd84a', align: 'center' });
    y += big === 2 ? 30 : 20;
    if (!p) {
      drawText(g, 'CONNECTING TO THE SHOP...', W / 2, y, { color: '#c8d0dc', align: 'center' });
      return;
    }
    this.flashMoney = Math.max(0, this.flashMoney - dt);
    drawText(g, `$${p.money}`, W / 2, y, { scale: 2, color: this.flashMoney > 0 ? '#ffffff' : '#9cff9c', align: 'center' });
    y += 22;

    // Car stats: the stock car in blue, what model and upgrades add in yellow,
    // scaled so a maxed-out best car fills the bar.
    const t = tuningFor(DEFAULT_TUNING, p);
    const stock = tuningFor(DEFAULT_TUNING, defaultLoadout());
    const best = tuningFor(DEFAULT_TUNING, { ...defaultLoadout(), car: CAR_MODELS.length - 1, engine: MAX_LEVEL, tyres: MAX_LEVEL, armour: MAX_LEVEL });
    const prot = (x: typeof t) => 1.1 - x.armour;
    const stats: [string, number, number, string][] = [
      ['TOP SPEED', t.vTop / best.vTop, stock.vTop / best.vTop, `${Math.round(t.vTop * 3.6)} KM/H`],
      ['ACCEL', t.accel0 / best.accel0, stock.accel0 / best.accel0, ''],
      ['GRIP', t.aGrip / best.aGrip, stock.aGrip / best.aGrip, ''],
      ['ARMOUR', prot(t) / prot(best), prot(stock) / prot(best), ''],
      ['DAMAGE', p.damage, 0, `${Math.round(p.damage * 100)}%`],
    ];
    const sw = Math.min(260, W - 40);
    const sx = Math.round(W / 2 - sw / 2);
    g.fillStyle = 'rgba(8,10,24,0.72)';
    g.fillRect(sx - 6, y - 4, sw + 12, stats.length * 10 + 6);
    for (const [name, v, stock, text] of stats) {
      drawText(g, name, sx, y, { color: '#9aa4b8' });
      const bx = sx + 64;
      const bw = sw - 64 - 58;
      g.fillStyle = '#222';
      g.fillRect(bx, y, bw, 6);
      const damage = name === 'DAMAGE';
      g.fillStyle = damage ? (v < 0.4 ? '#9cff9c' : v < 0.7 ? '#ffd84a' : '#ff6b5e') : '#ffd84a';
      g.fillRect(bx, y, Math.round(bw * Math.min(1, v)), 6);
      if (!damage) {
        g.fillStyle = '#5ac8fa';
        g.fillRect(bx, y, Math.round(bw * Math.min(1, stock)), 6);
      }
      if (text) drawText(g, text, sx + sw, y, { align: 'right' });
      y += 10;
    }
    y += 12;
    const scale = y + this.menu.items.length * 22 < H - 24 ? 2 : 1;
    this.menu.draw(g, W / 2, y, scale, dt);
    if (this.messageTime > 0) {
      this.messageTime -= dt;
      drawText(g, this.message, W / 2, H - 22, { scale: 1, color: '#ff6b5e', align: 'center' });
    } else {
      drawText(g, 'ENTER BUY   ↑↓ CHOOSE   BLUE = STOCK, YELLOW = UPGRADED', W / 2, H - 22, { color: '#8090a8', align: 'center' });
    }
  }
}

export interface StandingsRow {
  name: string;
  color: string;
  points: number;
  /** Races won: breaks ties on points, as everywhere in a championship. */
  wins?: number;
  earned: number;
  /** Place in the race just run (0 = not shown). */
  racePlace: number;
  human: boolean;
  /** Computer drivers: how they race, long and short. */
  blurb?: string;
  tag?: string;
  /** The player's career rival. */
  rival?: boolean;
}

/** Room for a description between the names and the RACE column of a 320 px table. */
const NOTE_GAP = 70;

/** The description that fits on a `maxW` wide table: the full line, the short tag, or none. */
function noteFor(rows: StandingsRow[], maxW: number): (r: StandingsRow) => string {
  const fits = (f: (r: StandingsRow) => string | undefined) => {
    const w = Math.max(0, ...rows.map((r) => textWidth(f(r) ?? '')));
    return w > 0 && 320 + Math.max(0, w - NOTE_GAP) <= maxW;
  };
  if (fits((r) => r.blurb)) return (r) => r.blurb ?? '';
  if (fits((r) => r.tag)) return (r) => r.tag ?? '';
  return () => '';
}

/** Championship table: overall points, with this race's place and earnings. */
export function drawStandings(
  g: CanvasRenderingContext2D, W: number, H: number, title: string, subtitle: string, rows: StandingsRow[], time: number, footer: string,
  extra = '',
): void {
  const sorted = [...rows].sort((a, b) => b.points - a.points || (b.wins ?? 0) - (a.wins ?? 0));
  const rowH = 12;
  const note = noteFor(rows, W - 20);
  const noteW = Math.max(0, ...rows.map((r) => textWidth(note(r))));
  const boxW = Math.min(W - 20, 320 + Math.max(0, noteW - NOTE_GAP));
  const boxH = 58 + sorted.length * rowH + 22 + (extra ? 12 : 0);
  const x0 = Math.round(W / 2 - boxW / 2);
  const y0 = Math.round(H / 2 - boxH / 2);
  g.fillStyle = 'rgba(8,10,24,0.88)';
  g.fillRect(x0, y0, boxW, boxH);
  g.fillStyle = '#ffd84a';
  g.fillRect(x0, y0, boxW, 2);
  g.fillRect(x0, y0 + boxH - 2, boxW, 2);
  drawText(g, title, W / 2, y0 + 10, { scale: 2, color: '#ffd84a', align: 'center' });
  drawText(g, subtitle, W / 2, y0 + 28, { color: '#9fd8ff', align: 'center' });
  const hy = y0 + 44;
  drawText(g, 'DRIVER', x0 + 30, hy, { color: '#8090a8' });
  drawText(g, 'RACE', x0 + boxW - 120, hy, { color: '#8090a8', align: 'right' });
  drawText(g, 'EARNED', x0 + boxW - 60, hy, { color: '#8090a8', align: 'right' });
  drawText(g, 'PTS', x0 + boxW - 10, hy, { color: '#8090a8', align: 'right' });
  sorted.forEach((r, i) => {
    const y = hy + 14 + i * rowH;
    if (r.human) {
      g.fillStyle = 'rgba(255,216,74,0.18)';
      g.fillRect(x0 + 4, y - 2, boxW - 8, rowH);
    }
    drawText(g, String(i + 1), x0 + 10, y, { color: i === 0 ? '#ffd84a' : '#ffffff' });
    g.fillStyle = r.color;
    g.fillRect(x0 + 20, y, 6, 7);
    drawText(g, r.name, x0 + 30, y, { color: r.human ? '#ffd84a' : r.rival ? '#ff6b5e' : '#ffffff' });
    if (note(r)) drawText(g, note(r), x0 + 100, y, { color: r.rival ? '#ff9a8a' : '#8a9ab8' });
    drawText(g, r.racePlace ? `${r.racePlace}.` : '-', x0 + boxW - 120, y, { align: 'right' });
    drawText(g, r.human ? (r.earned < 0 ? `-$${-r.earned}` : `$${r.earned}`) : '', x0 + boxW - 60, y, { align: 'right', color: '#9cff9c' });
    drawText(g, String(r.points), x0 + boxW - 10, y, { align: 'right', color: '#ffffff' });
  });
  if (extra) drawText(g, extra, W / 2, y0 + boxH - 26, { color: '#ff9a8a', align: 'center' });
  if (Math.sin(time * 5) > -0.2) drawText(g, footer, W / 2, y0 + boxH - 14, { color: '#c8d0dc', align: 'center' });
}
