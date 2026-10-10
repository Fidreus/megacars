// Small 2D geometry helpers on the (x, z) ground plane.

export interface Closest {
  x: number;
  z: number;
  /** Parameter along the segment, 0..1. */
  t: number;
  /** Squared distance from the query point. */
  d2: number;
}

export function closestOnSegment(
  px: number, pz: number,
  ax: number, az: number, bx: number, bz: number,
  out: Closest,
): Closest {
  const ex = bx - ax, ez = bz - az;
  const len2 = ex * ex + ez * ez;
  let t = len2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + ex * t, z = az + ez * t;
  out.x = x;
  out.z = z;
  out.t = t;
  out.d2 = (px - x) * (px - x) + (pz - z) * (pz - z);
  return out;
}

/** Proper intersection test for segments ab and cd (touching endpoints excluded). */
export function segmentsIntersect(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const d1 = cross(cx, cz, dx, dz, ax, az);
  const d2 = cross(cx, cz, dx, dz, bx, bz);
  const d3 = cross(ax, az, bx, bz, cx, cz);
  const d4 = cross(ax, az, bx, bz, dx, dz);
  const eps = 1e-7 * (Math.abs(bx - ax) + Math.abs(bz - az) + Math.abs(dx - cx) + Math.abs(dz - cz)) ** 2;
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

function cross(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  return (bx - ax) * (pz - az) - (bz - az) * (px - ax);
}

/** Signed curvature through three points (positive = turning right / clockwise). */
export function curvature3(
  ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
): number {
  const abx = bx - ax, abz = bz - az;
  const bcx = cx - bx, bcz = cz - bz;
  const acx = cx - ax, acz = cz - az;
  const crossv = abx * bcz - abz * bcx; // > 0 means clockwise on screen (x east, z south)
  const denom = Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(acx, acz);
  return denom > 1e-9 ? (2 * crossv) / denom : 0;
}
