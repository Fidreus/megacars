// Outline of a round surface patch: an irregular blob (a stretched circle with
// a few lobes), so oil looks spilled and snow drifted instead of drawn with a
// compass. The physics grid and the road shader use the same numbers.

import { Surface } from '../config/surfaces.ts';
import { hash3 } from '../math/rng.ts';
import type { SurfacePatch } from './types.ts';
import { DMath } from '../math/dmath.ts';

export interface PatchShape {
  /** Direction of the long axis (radians). */
  angle: number;
  /** Long axis / short axis; the area stays that of the circle. */
  aspect: number;
  /** Lobes: amplitude and phase of the 2nd, 3rd and 5th harmonic of the radius. */
  a2: number;
  p2: number;
  a3: number;
  p3: number;
  a5: number;
  p5: number;
}

/** How stretched and how lobed each surface gets. */
function style(surface: number): { stretch: number; lobes: number; splat: number } {
  switch (surface) {
    case Surface.Oil: return { stretch: 0.25, lobes: 1, splat: 1.6 };
    case Surface.Snow: return { stretch: 0.8, lobes: 1, splat: 0.8 };
    case Surface.Ice: return { stretch: 0.5, lobes: 0.9, splat: 0.6 };
    case Surface.Gravel: return { stretch: 0.45, lobes: 0.8, splat: 1 };
    default: return { stretch: 0.35, lobes: 0.8, splat: 0.8 };
  }
}

export function patchShape(p: SurfacePatch, index: number, seed: number): PatchShape {
  const h = (salt: number) => hash3(seed + 101, index, salt);
  const st = style(p.surface);
  const TAU = Math.PI * 2;
  return {
    angle: h(1) * Math.PI,
    aspect: 1 + st.stretch * (0.5 + 0.5 * h(2)),
    a2: st.lobes * (0.06 + 0.08 * h(3)),
    p2: h(4) * TAU,
    a3: st.lobes * (0.05 + 0.07 * h(5)),
    p3: h(6) * TAU,
    a5: st.splat * (0.02 + 0.04 * h(7)),
    p5: h(8) * TAU,
  };
}

/** Farthest the outline reaches from the centre (for bounding boxes). */
export function patchReach(p: SurfacePatch, s: PatchShape): number {
  return p.r * Math.sqrt(s.aspect) * (1 + s.a2 + s.a3 + s.a5);
}

/** Is (x, z) inside the patch outline? Mirrored in the road shader (trackMesh.ts). */
export function inPatchShape(p: SurfacePatch, s: PatchShape, x: number, z: number): boolean {
  const dx = x - p.x;
  const dz = z - p.z;
  const c = DMath.cos(s.angle);
  const sn = DMath.sin(s.angle);
  const k = Math.sqrt(s.aspect);
  const u = (dx * c + dz * sn) / k;
  const v = (-dx * sn + dz * c) * k;
  const th = DMath.atan2(v, u);
  const lim = p.r * (1 + s.a2 * DMath.cos(2 * th + s.p2) + s.a3 * DMath.cos(3 * th + s.p3) + s.a5 * DMath.cos(5 * th + s.p5));
  return u * u + v * v < lim * lim;
}
