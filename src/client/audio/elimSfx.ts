// Elimination race sounds: a warning beep while a local player is last,
// quicker and higher as the leader nears the line on a lap that ends in an
// elimination, and a knockout sting with the explosion when a car goes out.

import { Ev, type EventBuffer } from '../../shared/sim/events.ts';
import type { World } from '../../shared/sim/world.ts';
import type { AudioSystem } from './audio.ts';
import { playDebris, playExplosion, playTone } from './sfx.ts';
import { elimUrgency, isLastPlace } from '../ui/screens/elimHud.ts';

export class ElimSfx {
  /** Seconds to the next warning beep. */
  private wait = 0;
  private last = -1;

  /** Each frame of an elimination race (offline or online); `now` is the audio clock. */
  update(audio: AudioSystem, world: World, players: readonly number[], racing: boolean, now: number): void {
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, now - this.last));
    this.last = now;
    if (!world.elim || !racing || !players.some((id) => isLastPlace(world, id))) {
      this.wait = 0;
      return;
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    const u = elimUrgency(world);
    // A slow pip on a lap without an elimination; on the lap that has one, up to six a second.
    this.wait = u > 0 ? 0.95 - 0.78 * u : 1.6;
    const f = u > 0 ? 620 + 520 * u : 520;
    playTone(audio, f, 0.09, 'square', u > 0 ? 0.07 + 0.05 * u : 0.05);
    if (u > 0.75) playTone(audio, f * 1.5, 0.06, 'square', 0.05, 0, 0.1);
  }

  /** A car went out: everybody hears it, the explosion louder near the player. */
  events(audio: AudioSystem, ev: EventBuffer, players: readonly number[], me: { x: number; z: number }): void {
    for (let k = 0; k < ev.count; k++) {
      const e = ev.list[k];
      if (e.kind !== Ev.Eliminated) continue;
      const dx = e.x - me.x;
      const near = Math.max(0, 1 - Math.hypot(dx, e.z - me.z) / 120);
      const mine = players.includes(e.car);
      playExplosion(audio, 0.35 + 0.65 * Math.max(near, mine ? 1 : 0), mine ? 0 : dx / 40, 1.8);
      playDebris(audio, 0.3 + 0.6 * near, dx / 40);
      // Knockout: a falling three-note sting (lower and longer for your own car).
      const base = mine ? 330 : 660;
      for (let i = 0; i < 3; i++) playTone(audio, base / (1 + i * 0.26), mine ? 0.32 : 0.16, 'square', 0.09, 0, 0.12 + i * (mine ? 0.3 : 0.14));
    }
  }
}
