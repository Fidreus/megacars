// Weather: how wet the road is at any tick, and what that does to the tyres.
// A race's weather is fixed by its spec, so the plan is built once from the
// spec and the wetness is a pure function of the tick: the server, every
// predicting client and the record checker get the same value without
// sending anything, and a rewind can't get it wrong.

import { Surface, SURFACES, type SurfaceId, type SurfaceMix } from '../config/surfaces.ts';
import { hash3 } from '../math/rng.ts';

export type Weather = 'dry' | 'rain' | 'changing';

/** When it rains (ticks of the world clock) and how quickly the road soaks and dries. */
export interface WeatherPlan {
  readonly kind: Weather;
  /** Rain starts falling (far in the past for a wet race). */
  readonly rainOn: number;
  /** Rain stops (far in the future when it keeps raining). */
  readonly rainOff: number;
  /** Ticks from the first drops to a soaked road. */
  readonly soak: number;
  /** Ticks from the last drops to a dry road. */
  readonly dry: number;
}

const NEVER = 1e9;

export const WEATHER_TUNING = {
  /** Soaking takes this share of the race, within these limits (s). */
  soakShare: 0.12,
  soakMin: 14,
  soakMax: 30,
  /** Drying is slower. */
  dryShare: 0.22,
  dryMin: 24,
  dryMax: 55,
  /** Rain on screen fades in and out over this long (s); the road follows behind. */
  fade: 4,
  /** Computer drivers plan for the road this far ahead (s), so a shower doesn't catch them out. */
  ahead: 3,
};

/** Ticks per second (DT is 1/60). */
const HZ = 60;

/** Grip and braking a surface ends up with on a soaked road (index = SurfaceId). */
interface WetTarget {
  grip: number;
  slide: number;
  scrub: number;
  accel: number;
  /** Share of full braking. */
  brake: number;
  /** Grip full lock asks for over what there is (see SurfaceMix.steerAsk). */
  steerAsk: number;
}

const keep = (id: SurfaceId): WetTarget => {
  const s = SURFACES[id];
  return { grip: s.grip, slide: s.slide, scrub: s.scrub, accel: s.accel, brake: 1, steerAsk: 1 };
};
const wetSurf = SURFACES[Surface.Wet];

/**
 * Sealed road gets the grip of the wet surface (Manhattan's soaked patches),
 * painted curbs a little worse, standing water worse again. Pulling away
 * stays as in the dry (a car put back before a broken bridge must still make
 * the jump). Loose ground hardly changes; snow, ice, oil and water not at all.
 */
export const WET_TARGETS: readonly WetTarget[] = [
  { grip: wetSurf.grip, slide: wetSurf.slide, scrub: wetSurf.scrub, accel: 1, brake: 0.78, steerAsk: 1.2 },
  { grip: 0.74, slide: 0.78, scrub: 0.88, accel: 1, brake: 0.76, steerAsk: 1.2 },
  { grip: 0.74, slide: 0.8, scrub: 0.88, accel: 0.88, brake: 0.76, steerAsk: 1.2 },
  { ...keep(Surface.Gravel), grip: 0.57, brake: 0.95 },
  { ...keep(Surface.Grass), grip: 0.46, slide: 0.52, brake: 0.95 },
  keep(Surface.Snow),
  keep(Surface.Ice),
  keep(Surface.Oil),
  keep(Surface.ShallowWater),
  keep(Surface.DeepWater),
];

function smooth01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/**
 * The plan for a race. `startTick` is when the lights go out; `raceTicks`
 * how long the race is expected to take (rain in a changing race arrives
 * somewhere in it, whatever the track and number of laps).
 */
export function makeWeatherPlan(kind: Weather, seed: number, startTick: number, raceTicks: number): WeatherPlan | undefined {
  const T = WEATHER_TUNING;
  if (kind === 'dry') return undefined;
  const E = Math.max(HZ * 30, raceTicks);
  const soak = Math.round(Math.min(T.soakMax * HZ, Math.max(T.soakMin * HZ, E * T.soakShare)));
  const dry = Math.round(Math.min(T.dryMax * HZ, Math.max(T.dryMin * HZ, E * T.dryShare)));
  if (kind === 'rain') return { kind, rainOn: -NEVER, rainOff: NEVER, soak, dry };
  const at = (share: number) => startTick + Math.round(E * share);
  const r = hash3(seed, 31, 9001);
  const a = hash3(seed, 32, 9001);
  const b = hash3(seed, 33, 9001);
  if (r < 0.55) {
    // Dry start, the rain comes and stays.
    return { kind, rainOn: at(0.15 + a * 0.3), rainOff: NEVER, soak, dry };
  }
  if (r < 0.85) {
    // A shower: comes, soaks the road, passes; the road dries again.
    const on = at(0.12 + a * 0.2);
    return { kind, rainOn: on, rainOff: Math.max(on + soak + 10 * HZ, at(0.45 + b * 0.15)), soak, dry };
  }
  // Wet start, clearing up: the road dries during the race.
  return { kind, rainOn: -NEVER, rainOff: at(0.12 + a * 0.25), soak, dry };
}

/** How wet the road is at a tick, 0 (dry) to 1 (soaked). */
export function wetnessAt(plan: WeatherPlan | undefined, tick: number): number {
  if (!plan) return 0;
  const up = smooth01((tick - plan.rainOn) / plan.soak);
  if (tick <= plan.rainOff) return up;
  // Drying starts from however wet it got.
  const at = smooth01((plan.rainOff - plan.rainOn) / plan.soak);
  return at * (1 - smooth01((tick - plan.rainOff) / plan.dry));
}

/** How hard it is raining at a tick, 0..1 (for the look and sound; leads the road). */
export function rainAt(plan: WeatherPlan | undefined, tick: number): number {
  if (!plan) return 0;
  const f = WEATHER_TUNING.fade * HZ;
  return smooth01((tick - plan.rainOn) / f) * (1 - smooth01((tick - plan.rainOff) / f));
}

/** Wetness the computer drivers plan for: now, or a few seconds ahead if wetter. */
export function plannedWetness(plan: WeatherPlan | undefined, tick: number): number {
  if (!plan) return 0;
  return Math.max(wetnessAt(plan, tick), wetnessAt(plan, tick + WEATHER_TUNING.ahead * HZ));
}

function blend(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/**
 * Redo a surface mix (from mixSurfaces) for a road this wet; `plan` is the
 * wetness the computer drivers go by. Call before applyDamage.
 */
export function wetSurfaces(a: SurfaceId, b: SurfaceId, wet: number, plan: number, out: SurfaceMix): void {
  out.wet = plan;
  if (wet <= 0) return;
  const sa = SURFACES[a], sb = SURFACES[b];
  const ta = WET_TARGETS[a], tb = WET_TARGETS[b];
  out.grip = (blend(sa.grip, ta.grip, wet) + blend(sb.grip, tb.grip, wet)) * 0.5;
  out.slide = (blend(sa.slide, ta.slide, wet) + blend(sb.slide, tb.slide, wet)) * 0.5;
  out.scrub = (blend(sa.scrub, ta.scrub, wet) + blend(sb.scrub, tb.scrub, wet)) * 0.5;
  out.accel = (blend(sa.accel, ta.accel, wet) + blend(sb.accel, tb.accel, wet)) * 0.5;
  out.brake = (blend(1, ta.brake, wet) + blend(1, tb.brake, wet)) * 0.5;
  out.steerAsk = (blend(1, ta.steerAsk, wet) + blend(1, tb.steerAsk, wet)) * 0.5;
}

/** Share of dry-road grip, slide grip and braking left on asphalt this wet (the AI's speed planner). */
export function roadGripScale(wet: number): number {
  return blend(1, WET_TARGETS[Surface.Asphalt].grip / SURFACES[Surface.Asphalt].grip, wet);
}

/** Slides carry speed further on a wet road (less scrub): plan them with a margin. */
export function roadSlideScale(wet: number): number {
  return blend(1, (WET_TARGETS[Surface.Asphalt].slide / SURFACES[Surface.Asphalt].slide) * WET_SLIDE_MARGIN, wet);
}

const WET_SLIDE_MARGIN = 0.92;

export function roadBrakeScale(wet: number): number {
  return blend(1, WET_TARGETS[Surface.Asphalt].brake, wet);
}
