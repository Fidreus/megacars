// Ground surfaces and how they modify the car's handling.

export const Surface = {
  Asphalt: 0,
  Curb: 1,
  Wet: 2,
  Gravel: 3,
  Grass: 4,
  Snow: 5,
  Ice: 6,
  Oil: 7,
  ShallowWater: 8,
  DeepWater: 9,
} as const;
export type SurfaceId = (typeof Surface)[keyof typeof Surface];

export interface SurfaceProps {
  name: string;
  grip: number;
  slide: number;
  scrub: number;
  /** Constant deceleration, m/s². */
  drag: number;
  /** Deceleration per m/s of speed. */
  dragLinear: number;
  vTop: number;
  accel: number;
  /** Visual/audio hint: kicks up dust or spray when driven fast. */
  dusty: boolean;
}

const S = (
  name: string, grip: number, slide: number, scrub: number, drag: number, dragLinear: number,
  vTop: number, accel: number, dusty = false,
): SurfaceProps => ({ name, grip, slide, scrub, drag, dragLinear, vTop, accel, dusty });

export const SURFACES: readonly SurfaceProps[] = [
  S('asphalt', 1, 1, 1, 0, 0, 1, 1),
  S('curb', 0.95, 0.95, 1, 0.2, 0, 1, 1),
  S('wet', 0.8, 0.85, 0.9, 0, 0, 1, 0.9),
  S('gravel', 0.6, 0.75, 0.6, 1.5, 0, 0.88, 0.8, true),
  S('grass', 0.5, 0.55, 0.8, 3.5, 0, 0.7, 0.6, true),
  S('snow', 0.45, 0.6, 0.6, 1, 0, 0.85, 0.6, true),
  S('ice', 0.18, 0.3, 0.3, 0, 0, 1, 0.35),
  S('oil', 0.06, 0.12, 0.2, 0, 0, 1, 0.3),
  S('shallow water', 0.7, 0.7, 1, 0, 0.25, 0.6, 0.7, true),
  S('deep water', 0.3, 0.3, 1, 4, 0.5, 0.3, 0.3, true),
];

/** Averaged multipliers for the two contact patches of a car. */
export interface SurfaceMix {
  grip: number;
  slide: number;
  scrub: number;
  drag: number;
  dragLinear: number;
  vTop: number;
  accel: number;
}

export function mixSurfaces(a: SurfaceId, b: SurfaceId, out: SurfaceMix): SurfaceMix {
  const sa = SURFACES[a], sb = SURFACES[b];
  out.grip = (sa.grip + sb.grip) * 0.5;
  out.slide = (sa.slide + sb.slide) * 0.5;
  out.scrub = (sa.scrub + sb.scrub) * 0.5;
  out.drag = (sa.drag + sb.drag) * 0.5;
  out.dragLinear = (sa.dragLinear + sb.dragLinear) * 0.5;
  out.vTop = (sa.vTop + sb.vTop) * 0.5;
  out.accel = (sa.accel + sb.accel) * 0.5;
  return out;
}

export function makeSurfaceMix(): SurfaceMix {
  return { grip: 1, slide: 1, scrub: 1, drag: 0, dragLinear: 0, vTop: 1, accel: 1 };
}
