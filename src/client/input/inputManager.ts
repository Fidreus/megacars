// Turns keyboard + gamepad state into a quantised CarInput per local player.

import { Btn, quantizeInput, type CarInput } from '../../shared/sim/input.ts';
import { PAD_DEFAULT, type KeyBinding, type PadBinding } from './bindings.ts';
import { makePadState, readPad } from './gamepad.ts';
import { Keyboard } from './keyboard.ts';
import { TouchControls } from './touch.ts';

export interface LocalPlayerInput {
  keys: KeyBinding | null;
  /** Gamepad index, or -1 for none. */
  pad: number;
  padKeys?: PadBinding;
}

export class InputManager {
  readonly keyboard = new Keyboard(window);
  private readonly pad = makePadState();
  /** Debug/automation override for player 0 (window.__megacars.drive). */
  override: CarInput | null = null;
  overrideTicks = 0;
  /** On-screen touch controls (drive player 1 while they are shown). */
  touch: TouchControls | null = null;
  /** Player 1's car, for the touch traction control and POINT steering. */
  touchCar: (() => { slip: number; sliding: number; surfRear: number; heading: number; angVel: number; vx: number; vz: number } | null) | null = null;
  /** World heading of a direction on the screen (x right, y down) in player 1's view. */
  touchHeading: ((x: number, y: number) => number) | null = null;
  /** Pads that were the most recently used device of their player. */
  private readonly padInUse = new Set<number>();

  sample(player: LocalPlayerInput, out: CarInput, first = true): CarInput {
    if (first && this.override && this.overrideTicks > 0) {
      this.overrideTicks--;
      out.steer = this.override.steer;
      out.throttle = this.override.throttle;
      out.brake = this.override.brake;
      out.buttons = this.override.buttons;
      return quantizeInput(out);
    }
    const kb = this.keyboard;
    const k = player.keys;
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let buttons = 0;
    if (k) {
      if (kb.anyDown(k.left) || kb.anyDown(k.right) || kb.anyDown(k.gas) || kb.anyDown(k.brake)) {
        this.padInUse.delete(player.pad);
      }
      steer = (kb.anyDown(k.right) ? 1 : 0) - (kb.anyDown(k.left) ? 1 : 0);
      throttle = kb.anyDown(k.gas) ? 1 : 0;
      brake = kb.anyDown(k.brake) ? 1 : 0;
      if (kb.anyDown(k.fireFront)) buttons |= Btn.FireFront;
      if (kb.anyDown(k.fireRear)) buttons |= Btn.FireRear;
      if (kb.anyDown(k.turbo)) buttons |= Btn.Turbo;
      if (kb.anyDown(k.special ?? [])) buttons |= Btn.Special;
      if (kb.anyDown(k.reset)) buttons |= Btn.Reset;
      if (kb.anyDown(k.drift)) buttons |= Btn.Drift;
    }
    if (player.pad >= 0) {
      const p = readPad(player.pad, this.pad, player.padKeys ?? PAD_DEFAULT);
      if (p.connected) {
        if (p.active) this.padInUse.add(player.pad);
        if (this.padInUse.has(player.pad)) {
          // Analog steering straight from the stick, including back to centre.
          steer = p.steer;
          buttons |= Btn.Analog;
        }
        throttle = Math.max(throttle, p.throttle);
        brake = Math.max(brake, p.brake);
        if (p.fireFront) buttons |= Btn.FireFront;
        if (p.fireRear) buttons |= Btn.FireRear;
        if (p.turbo) buttons |= Btn.Turbo;
        if (p.special) buttons |= Btn.Special;
        if (p.drift) buttons |= Btn.Drift;
        if (p.reset) buttons |= Btn.Reset;
      }
    }
    const t = this.touch;
    if (first && t?.enabled && t.visible) {
      const me = this.touchCar?.();
      if (t.steerMode === 'point' && t.point && me && this.touchHeading) {
        // Push the thumb where you want to go: the wheel turns the car there.
        const goal = this.touchHeading(t.point.x, t.point.y);
        const forward = me.vx * Math.sin(me.heading) - me.vz * Math.cos(me.heading);
        steer = TouchControls.pointSteer(goal, me.heading, me.angVel, forward);
        buttons |= Btn.Analog;
      } else if (t.steer !== 0 || !(buttons & Btn.Analog)) {
        steer = t.steer;
        // Arrow buttons are digital like keys: the simulation ramps them.
        if (t.analog) buttons |= Btn.Analog;
        else buttons &= ~Btn.Analog;
      }
      buttons |= t.buttons;
      // (No gas at all while the thumb is lifted in 'thumb' mode: t.throttle is 0.)
      const car = t.autoGas && t.brake === 0 && t.throttle > 0 ? this.touchCar?.() : null;
      // AUTO GAS eases off in a slide you didn't ask for (traction control).
      throttle = Math.max(throttle, car ? t.autoGasFor(car, !!(buttons & Btn.Drift)) : t.throttle);
      brake = Math.max(brake, t.brake);
      // Braking (reverse) cancels the automatic gas.
      if (t.brake > 0 && t.autoGas) throttle = 0;
    }
    out.steer = steer;
    out.throttle = throttle;
    out.brake = brake;
    out.buttons = buttons;
    return quantizeInput(out);
  }

  /** Index of the first gamepad with any input this frame, or -1. */
  firstActivePad(): number {
    for (let i = 0; i < 4; i++) if (readPad(i, this.pad).active) return i;
    return -1;
  }
}
