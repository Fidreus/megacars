// What the race view, HUD and app need from a race, offline or online.

import type { PaintLook } from './paints.ts';
import type { League } from '../../shared/game/leagues.ts';
import type { CarInput } from '../../shared/sim/input.ts';
import type { World } from '../../shared/sim/world.ts';
import type { Track } from '../../shared/track/types.ts';

export interface GameSession {
  readonly track: Track;
  readonly world: World;
  /** Input each car used on the latest tick. */
  readonly inputs: readonly CarInput[];
  /** Car id of each local player. */
  readonly playerCars: readonly number[];
  readonly names: readonly string[];
  readonly colors: readonly string[];
  /** A paint job's pattern per car (undefined: the plain slot colour with a stripe). */
  readonly looks?: readonly (PaintLook | undefined)[];
  /** Car model per car (index into CAR_MODELS), or -1 for "any look". */
  readonly models: readonly number[];
  /** Car class: Supercars and Megacars get their own looks. */
  readonly league?: League;
}
