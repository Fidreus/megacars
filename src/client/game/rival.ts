// Computer drivers' characters on the championship screens.

import { personaIndex, personaOf } from '../../shared/ai/persona.ts';
import type { CupDriver } from './championship.ts';

/** The one-line description and short tag of a computer driver (nothing for people). */
export function driverNotes(d: CupDriver): { blurb?: string; tag?: string } {
  if (d.player >= 0) return {};
  const i = personaIndex(d.name);
  if (i < 0) return {};
  const p = personaOf(i);
  return { blurb: p.blurb, tag: p.tag };
}
