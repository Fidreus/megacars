// Turns keyboard + gamepad state into a quantised CarInput per local player.

import { Btn, quantizeInput, type CarInput } from '../../shared/sim/input.ts';
import type { KeyBinding } from './bindings.ts';
import { makePadState, readPad } from './gamepad.ts';
import { Keyboard } from './keyboard.ts';

export interface LocalPlayerInput {
  keys: KeyBinding | null;
  /** Gamepad index, or -1 for none. */
  pad: number;
}

export class InputManager {
  readonly keyboard = new Keyboard(window);
  private readonly pad = makePadState();
  /** Debug/automation override for player 0 (window.__megacars.drive). */
  override: CarInput | null = null;
  overrideTicks = 0;
  /** Pads that were the most recently used device of their player. */
  private readonly padInUse = new Set<number>();

  sample(player: LocalPlayerInput, out: CarInput): CarInput {
    if (this.override && this.overrideTicks > 0) {
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
    }
    if (player.pad >= 0) {
      const p = readPad(player.pad, this.pad);
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
      }
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
