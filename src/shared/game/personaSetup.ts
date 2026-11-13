// Gives each computer car of a race its driver's personality and, in a
// career, its rival target. Everything comes from the race spec.

import { personaIndex, personaOf } from '../ai/persona.ts';
import type { Entrant } from '../net/protocol.ts';
import type { CarState } from '../sim/car.ts';

/** Hand a car personality `index` (call after its ammo is set). */
export function setPersona(car: CarState, index: number): void {
  car.aiPersona = index;
  // Turbo lovers carry one more (only when the race hands out ammo at all).
  if (car.turbos > 0) car.turbos += personaOf(index).extraTurbos;
}

export function applyPersona(car: CarState, e: Entrant, entrants: readonly Entrant[]): void {
  if (e.playerId >= 0) return;
  setPersona(car, personaIndex(e.name));
  car.aiFoe = e.rival === undefined ? -1 : entrants.findIndex((x) => x.playerId === e.rival);
}
