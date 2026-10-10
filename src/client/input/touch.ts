// On-screen touch controls for phones and tablets. The left thumb steers by
// dragging sideways from wherever it lands (analog, like a stick); the right
// thumb has buttons for gas, brake, drift and the weapons. With AUTO GAS on
// (the default) the car accelerates by itself unless braking, which leaves
// the right thumb free for the weapons. Sliding a finger from one button to
// another switches buttons. Drawn on the low-res UI canvas.

import { Surface } from '../../shared/config/surfaces.ts';
import { Btn } from '../../shared/sim/input.ts';
import { drawText } from '../ui/font.ts';

type Role = 'gas' | 'brake' | 'drift' | 'missile' | 'mine' | 'turbo' | 'reset' | 'pause' | 'left' | 'right' | 'hold';

/**
 * 'thumb': gas while the left (steering) thumb is on the screen, lift it to
 * ease off; 'always': gas all the time; 'button': a gas button.
 */
export type GasMode = 'thumb' | 'always' | 'button';

interface Button {
  role: Role;
  x: number;
  y: number;
  r: number;
  label: string;
}

interface Touch {
  /** 'steer' for the steering thumb, else the button it is on (or null). */
  role: Role | 'steer' | null;
  x: number;
  y: number;
  ax: number;
}

export interface TouchAmmo {
  missiles: number;
  mines: number;
  turbos: number;
}

/** Steering thumb travel (UI pixels) for full lock. */
const STEER_RANGE = 46;
/** A lift by the traction control lasts at least this long (> the sim's liftTapTicks). */
const LIFT_HOLD_TICKS = 24;
/** Share of the travel around the middle that counts as straight ahead. */
const DEAD_ZONE = 0.16;

export class TouchControls {
  /** A touch screen has been used: show the controls. */
  enabled = false;
  gasMode: GasMode = 'thumb';
  /** 'slide': drag the left thumb (analog); 'buttons': two arrow buttons (like keys). */
  steerMode: 'slide' | 'buttons' = 'slide';
  /** Controls are drawn and react (racing, not paused or on the results). */
  visible = false;
  steer = 0;
  /** Where the thumb says the steering should be; `steer` follows it smoothly. */
  private target = 0;
  throttle = 0;
  brake = 0;
  buttons = 0;
  /** The pause button was tapped (one-shot, cleared by the reader). */
  pauseTapped = false;
  private readonly touches = new Map<number, Touch>();
  private layout: Button[] = [];
  private W = 1;
  private H = 1;
  private readonly toUi: (cx: number, cy: number) => [number, number];

  constructor(canvas: HTMLCanvasElement, toUi: (cx: number, cy: number) => [number, number]) {
    this.toUi = toUi;
    this.enabled = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      this.enabled = true;
      if (!this.visible) return;
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      const [x, y] = this.toUi(e.clientX, e.clientY);
      const hit = this.hit(x, y);
      if (hit === 'pause') {
        this.pauseTapped = true;
        return;
      }
      // Anything on the left side that isn't a button is the steering thumb
      // (with arrow buttons: a thumb resting between them, which still gasses).
      const role = hit ?? this.leftThumb(x);
      this.touches.set(e.pointerId, { role, x, y, ax: x });
      this.update();
    };
    const move = (e: PointerEvent) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      e.preventDefault();
      [t.x, t.y] = this.toUi(e.clientX, e.clientY);
      if (t.role === 'steer') {
        // The anchor follows a thumb that overshoots, so reversing is quick.
        if (t.x - t.ax > STEER_RANGE) t.ax = t.x - STEER_RANGE;
        if (t.ax - t.x > STEER_RANGE) t.ax = t.x + STEER_RANGE;
      } else {
        const hit = this.hit(t.x, t.y);
        t.role = hit === 'pause' ? null : (hit ?? (t.role === 'left' || t.role === 'right' || t.role === 'hold' ? this.leftThumb(t.x) : null));
      }
      this.update();
    };
    const up = (e: PointerEvent) => {
      if (this.touches.delete(e.pointerId)) this.update();
    };
    canvas.addEventListener('pointerdown', down, { passive: false });
    canvas.addEventListener('pointermove', move, { passive: false });
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    // No long-press menus or selection on the game.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Accelerates by itself (no gas button). */
  get autoGas(): boolean {
    return this.gasMode !== 'button';
  }

  /** What a touch on the left side that misses the buttons is. */
  private leftThumb(x: number): Role | 'steer' | null {
    if (x >= this.W * 0.45) return null;
    return this.steerMode === 'slide' ? 'steer' : 'hold';
  }

  /** Hide or show (and drop held touches when hidden). */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    if (!on) {
      this.touches.clear();
      this.update();
    }
  }

  private hit(x: number, y: number): Role | null {
    let best: Role | null = null;
    let bestD = Infinity;
    for (const b of this.layout) {
      const d = Math.hypot(x - b.x, y - b.y);
      // A little slack around each button: thumbs are big.
      if (d < b.r + 8 && d < bestD) {
        best = b.role;
        bestD = d;
      }
    }
    return best;
  }

  private update(): void {
    let steer = 0;
    let digital = 0;
    let gas = false;
    let thumb = false;
    let brake = false;
    let buttons = 0;
    for (const t of this.touches.values()) {
      if (t.role === 'steer' || t.role === 'left' || t.role === 'right' || t.role === 'hold') thumb = true;
      if (t.role === 'steer') steer = Math.max(-1, Math.min(1, (t.x - t.ax) / STEER_RANGE));
      else if (t.role === 'gas') gas = true;
      else if (t.role === 'brake') brake = true;
      else if (t.role === 'drift') buttons |= Btn.Drift;
      else if (t.role === 'missile') buttons |= Btn.FireFront;
      else if (t.role === 'mine') buttons |= Btn.FireRear;
      else if (t.role === 'turbo') buttons |= Btn.Turbo;
      else if (t.role === 'reset') buttons |= Btn.Reset;
      else if (t.role === 'left') digital -= 1;
      else if (t.role === 'right') digital += 1;
    }
    if (this.steerMode === 'buttons') {
      this.target = Math.max(-1, Math.min(1, digital));
    } else {
      // A wide middle that is straight ahead (thumbs wobble), then a soft
      // curve: small movements make small corrections, full lock at the end.
      const a = Math.max(0, Math.abs(steer) - DEAD_ZONE) / (1 - DEAD_ZONE);
      this.target = Math.sign(steer) * Math.pow(a, 1.7);
    }
    this.brake = brake ? 1 : 0;
    const auto = this.gasMode === 'always' || (this.gasMode === 'thumb' && thumb);
    this.throttle = gas || (auto && !brake) ? 1 : 0;
    this.buttons = buttons;
  }

  /** Ticks the traction control has kept the gas low (see autoGasFor). */
  private lowTicks = 0;

  /**
   * AUTO GAS with traction control: full gas, eased off while the car slides
   * without the drift button held, so a slide you didn't want dies out
   * sooner and you hit fewer walls. Once it dips to a lift (<= 0.5) it stays
   * there for a little while: a short lift and back on the gas would
   * otherwise kick off the lift-off drift. Not on snow and ice, where
   * lifting makes it worse (tested on all tracks). Call once per tick.
   */
  autoGasFor(car: { slip: number; sliding: number; surfRear: number }, driftHeld: boolean): number {
    if (car.surfRear === Surface.Snow || car.surfRear === Surface.Ice) {
      this.lowTicks = 0;
      return 1;
    }
    const slipDeg = Math.abs(car.slip) * (180 / Math.PI);
    const t = Math.min(1, Math.max(0, (slipDeg - 6) / 19));
    let gas = car.sliding && !driftHeld ? 1 - 0.7 * t * t * (3 - 2 * t) : 1;
    if (gas <= 0.5) {
      this.lowTicks++;
    } else if (this.lowTicks > 0 && this.lowTicks <= LIFT_HOLD_TICKS) {
      this.lowTicks++;
      gas = 0.45;
    } else {
      this.lowTicks = 0;
    }
    return gas;
  }

  /** Steering follows the thumb smoothly (call once per frame). */
  tick(dt: number): void {
    if (this.steerMode === 'buttons') {
      // Digital, like keys: the simulation ramps it.
      this.steer = this.target;
      return;
    }
    // Faster back to the middle than away from it: letting go straightens up.
    const back = Math.abs(this.target) < Math.abs(this.steer);
    const k = 1 - Math.exp(-dt * (back ? 22 : 12));
    this.steer += (this.target - this.steer) * k;
    if (Math.abs(this.steer) < 0.01 && this.target === 0) this.steer = 0;
  }

  /** The steering is analog (slide) rather than left/right keys. */
  get analog(): boolean {
    return this.steerMode === 'slide';
  }

  /** Lay the buttons out for a W x H UI (call every frame; cheap). */
  arrange(W: number, H: number): void {
    if (W === this.W && H === this.H && this.layout.length) return;
    this.W = W;
    this.H = H;
    const u = Math.max(0.75, Math.min(1.4, H / 360));
    const R = (v: number) => Math.round(v * u);
    const right = W - R(16);
    const bottom = H - R(14);
    const b: Button[] = [];
    // Main button under the thumb: drift (auto gas; braking is rare) or gas.
    if (this.autoGas) {
      b.push({ role: 'drift', x: right - R(38), y: bottom - R(38), r: R(34), label: 'DRIFT' });
      b.push({ role: 'brake', x: right - R(112), y: bottom - R(26), r: R(26), label: 'BRAKE' });
    } else {
      b.push({ role: 'gas', x: right - R(38), y: bottom - R(38), r: R(34), label: 'GAS' });
      b.push({ role: 'brake', x: right - R(118), y: bottom - R(22), r: R(24), label: 'BRAKE' });
      b.push({ role: 'drift', x: right - R(104), y: bottom - R(92), r: R(26), label: 'DRIFT' });
    }
    if (this.steerMode === 'buttons') {
      const left = R(16);
      b.push({ role: 'left', x: left + R(36), y: bottom - R(40), r: R(36), label: '←' });
      b.push({ role: 'right', x: left + R(124), y: bottom - R(40), r: R(36), label: '→' });
    }
    b.push({ role: 'missile', x: right - R(36), y: bottom - R(118), r: R(24), label: 'MISSILE' });
    b.push({ role: 'mine', x: right - R(98), y: bottom - R(this.autoGas ? 96 : 150), r: R(21), label: 'MINE' });
    b.push({ role: 'turbo', x: right - R(this.autoGas ? 156 : 160), y: bottom - R(this.autoGas ? 70 : 96), r: R(20), label: 'TURBO' });
    b.push({ role: 'reset', x: right - R(18), y: R(118), r: R(14), label: 'RESET' });
    b.push({ role: 'pause', x: right - R(10), y: R(16), r: R(13), label: 'II' });
    this.layout = b;
  }

  /** Re-lay out (after AUTO GAS changes). */
  relayout(): void {
    this.layout = [];
    this.arrange(this.W, this.H);
  }

  draw(ctx: CanvasRenderingContext2D, ammo: TouchAmmo | null, weapons: boolean): void {
    if (!this.visible) return;
    const held = new Set<Role | 'steer' | null>([...this.touches.values()].map((t) => t.role));
    for (const b of this.layout) {
      if (!weapons && (b.role === 'missile' || b.role === 'mine' || b.role === 'turbo')) continue;
      const on = held.has(b.role);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = on ? 'rgba(255,216,74,0.45)' : 'rgba(10,12,26,0.35)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = on ? 'rgba(255,216,74,0.95)' : 'rgba(255,255,255,0.45)';
      ctx.stroke();
      const count = !ammo ? null : b.role === 'missile' ? ammo.missiles : b.role === 'mine' ? ammo.mines : b.role === 'turbo' ? ammo.turbos : null;
      const color = count === 0 ? 'rgba(160,170,190,0.6)' : '#ffffff';
      const arrow = b.role === 'left' || b.role === 'right';
      drawText(ctx, b.label, b.x, b.y - (arrow ? 10 : count === null ? 3 : 8), { color, align: 'center', shadow: '#000', scale: arrow ? 3 : 1 });
      if (count !== null) drawText(ctx, String(count), b.x, b.y + 2, { scale: 2, color, align: 'center' });
    }
    if (this.steerMode === 'buttons') return;
    // Steering: a base and a knob where the thumb is, or a hint where it goes.
    const steer = [...this.touches.values()].find((t) => t.role === 'steer');
    const cy = steer ? steer.y : this.H - Math.round(this.H * 0.2);
    const cx = steer ? steer.ax : Math.round(this.W * 0.16);
    ctx.fillStyle = 'rgba(10,12,26,0.3)';
    ctx.fillRect(cx - STEER_RANGE - 10, cy - 12, (STEER_RANGE + 10) * 2, 24);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - STEER_RANGE - 10 + 0.5, cy - 12 + 0.5, (STEER_RANGE + 10) * 2 - 1, 23);
    const kx = cx + this.steer * STEER_RANGE;
    ctx.beginPath();
    ctx.arc(kx, cy, 15, 0, Math.PI * 2);
    ctx.fillStyle = steer ? 'rgba(255,216,74,0.6)' : 'rgba(255,255,255,0.25)';
    ctx.fill();
    if (!steer) drawText(ctx, this.gasMode === 'thumb' ? '←  STEER + GAS  →' : '←  STEER  →', cx, cy - 26, { color: 'rgba(255,255,255,0.7)', align: 'center' });
  }
}
