// Collisions: each car is two circles (front and rear). Walls are one-sided
// line segments whose normal points toward the road. Impulses are applied at
// the contact point, so glancing blows also make the car rotate.

import { closestOnSegment, type Closest } from '../math/geom.ts';
import type { CarTuning } from '../config/tuning.ts';
import type { Walls } from '../track/types.ts';
import { type CarState, updateSlideAfterImpact } from './car.ts';
import { Ev, pushEvent, type EventBuffer } from './events.ts';

const queryBuf = new Int32Array(128);
const closest: Closest = { x: 0, z: 0, t: 0, d2: 0 };

/** Speed cap that guarantees no tunnelling: < circle radius per tick. */
export const MAX_SPEED = 58;

/** Minimum normal impact speed (m/s) that produces a WallHit/CarHit event. */
const EVENT_IMPACT = 1.5;

export function collideCarWithWalls(car: CarState, t: CarTuning, walls: Walls, ev: EventBuffer): void {
  if (walls.count === 0) return;
  const r = t.circleR;
  let maxImpact = 0;
  let hitX = 0;
  let hitZ = 0;
  for (let k = 0; k < 2; k++) {
    const off = k === 0 ? t.circleOffset : -t.circleOffset;
    // Two passes so a corner pinch between two walls resolves cleanly.
    for (let pass = 0; pass < 2; pass++) {
      const fx = Math.sin(car.heading);
      const fz = -Math.cos(car.heading);
      const cx = car.x + fx * off;
      const cz = car.z + fz * off;
      const n = walls.grid.query(cx, cz, r + 0.25, queryBuf);
      let bestPen = 0;
      let bnx = 0;
      let bnz = 0;
      for (let q = 0; q < n; q++) {
        const i = queryBuf[q];
        closestOnSegment(cx, cz, walls.ax[i], walls.az[i], walls.bx[i], walls.bz[i], closest);
        const dx = cx - closest.x;
        const dz = cz - closest.z;
        const d = Math.sqrt(closest.d2);
        if (d >= r) continue;
        const side = dx * walls.nx[i] + dz * walls.nz[i];
        let pen: number;
        let nx: number;
        let nz: number;
        if (side >= 0 && d > 1e-6) {
          pen = r - d;
          nx = dx / d;
          nz = dz / d;
        } else {
          // Centre is on (or behind) the wall line: push straight back out.
          pen = r + d;
          nx = walls.nx[i];
          nz = walls.nz[i];
        }
        if (pen > bestPen) {
          bestPen = pen;
          bnx = nx;
          bnz = nz;
        }
      }
      if (bestPen <= 0) break;
      car.x += bnx * bestPen;
      car.z += bnz * bestPen;
      const rx = fx * off - bnx * r;
      const rz = fz * off - bnz * r;
      const impact = applyImpulse(car, rx, rz, bnx, bnz, t.wallRestitution, t.wallFriction, t.mass, t.inertia);
      if (impact > maxImpact) {
        maxImpact = impact;
        hitX = car.x + rx;
        hitZ = car.z + rz;
      }
    }
  }
  if (maxImpact > 0) {
    updateSlideAfterImpact(car, t);
    if (maxImpact > EVENT_IMPACT) pushEvent(ev, Ev.WallHit, car.id, -1, maxImpact, hitX, hitZ);
  }
}

/** Impulse against an immovable surface. Returns the normal approach speed. */
function applyImpulse(
  car: CarState, rx: number, rz: number, nx: number, nz: number,
  e: number, mu: number, m: number, inertia: number,
): number {
  const vcx = car.vx - car.angVel * rz;
  const vcz = car.vz + car.angVel * rx;
  const vn = vcx * nx + vcz * nz;
  if (vn >= 0) return 0;
  const rn = rx * nz - rz * nx;
  const jn = (-(1 + e) * vn) / (1 / m + (rn * rn) / inertia);
  car.vx += (nx * jn) / m;
  car.vz += (nz * jn) / m;
  car.angVel += (rn * jn) / inertia;
  // Coulomb friction along the surface.
  const tx = -nz;
  const tz = nx;
  const vcx2 = car.vx - car.angVel * rz;
  const vcz2 = car.vz + car.angVel * rx;
  const vt = vcx2 * tx + vcz2 * tz;
  const rt = rx * tz - rz * tx;
  let jt = -vt / (1 / m + (rt * rt) / inertia);
  const maxF = mu * jn;
  jt = jt < -maxF ? -maxF : jt > maxF ? maxF : jt;
  car.vx += (tx * jt) / m;
  car.vz += (tz * jt) / m;
  car.angVel += (rt * jt) / inertia;
  return -vn;
}

export function collideCars(a: CarState, b: CarState, ta: CarTuning, tb: CarTuning, ev: EventBuffer): void {
  const reach = ta.circleOffset + tb.circleOffset + ta.circleR + tb.circleR;
  const dx0 = a.x - b.x;
  const dz0 = a.z - b.z;
  if (dx0 * dx0 + dz0 * dz0 > reach * reach) return;
  if (Math.abs(a.y - b.y) > 1) return;
  const rSum = ta.circleR + tb.circleR;
  const ima = 1 / ta.mass;
  const imb = 1 / tb.mass;
  let maxImpact = 0;
  let hx = 0;
  let hz = 0;
  for (let ka = 0; ka < 2; ka++) {
    for (let kb = 0; kb < 2; kb++) {
      const fax = Math.sin(a.heading), faz = -Math.cos(a.heading);
      const fbx = Math.sin(b.heading), fbz = -Math.cos(b.heading);
      const oa = ka === 0 ? ta.circleOffset : -ta.circleOffset;
      const ob = kb === 0 ? tb.circleOffset : -tb.circleOffset;
      const cax = a.x + fax * oa, caz = a.z + faz * oa;
      const cbx = b.x + fbx * ob, cbz = b.z + fbz * ob;
      let nx = cax - cbx;
      let nz = caz - cbz;
      const d = Math.hypot(nx, nz);
      if (d >= rSum) continue;
      if (d > 1e-6) {
        nx /= d;
        nz /= d;
      } else {
        nx = 1;
        nz = 0;
      }
      const pen = rSum - d;
      const wa = ima / (ima + imb);
      a.x += nx * pen * wa;
      a.z += nz * pen * wa;
      b.x -= nx * pen * (1 - wa);
      b.z -= nz * pen * (1 - wa);
      // Contact point between the two circle surfaces.
      const px = cbx + nx * tb.circleR;
      const pz = cbz + nz * tb.circleR;
      const rax = px - a.x, raz = pz - a.z;
      const rbx = px - b.x, rbz = pz - b.z;
      const vax = a.vx - a.angVel * raz, vaz = a.vz + a.angVel * rax;
      const vbx = b.vx - b.angVel * rbz, vbz = b.vz + b.angVel * rbx;
      const rvx = vax - vbx, rvz = vaz - vbz;
      const vn = rvx * nx + rvz * nz;
      if (vn >= 0) continue;
      const e = (ta.carRestitution + tb.carRestitution) * 0.5;
      const mu = (ta.carFriction + tb.carFriction) * 0.5;
      const rna = rax * nz - raz * nx;
      const rnb = rbx * nz - rbz * nx;
      const jn = (-(1 + e) * vn) / (ima + imb + (rna * rna) / ta.inertia + (rnb * rnb) / tb.inertia);
      a.vx += nx * jn * ima;
      a.vz += nz * jn * ima;
      a.angVel += (rna * jn) / ta.inertia;
      b.vx -= nx * jn * imb;
      b.vz -= nz * jn * imb;
      b.angVel -= (rnb * jn) / tb.inertia;
      // Friction.
      const tx = -nz, tz = nx;
      const vax2 = a.vx - a.angVel * raz, vaz2 = a.vz + a.angVel * rax;
      const vbx2 = b.vx - b.angVel * rbz, vbz2 = b.vz + b.angVel * rbx;
      const vt = (vax2 - vbx2) * tx + (vaz2 - vbz2) * tz;
      const rta = rax * tz - raz * tx;
      const rtb = rbx * tz - rbz * tx;
      let jt = -vt / (ima + imb + (rta * rta) / ta.inertia + (rtb * rtb) / tb.inertia);
      const maxF = mu * jn;
      jt = jt < -maxF ? -maxF : jt > maxF ? maxF : jt;
      a.vx += tx * jt * ima;
      a.vz += tz * jt * ima;
      a.angVel += (rta * jt) / ta.inertia;
      b.vx -= tx * jt * imb;
      b.vz -= tz * jt * imb;
      b.angVel -= (rtb * jt) / tb.inertia;
      if (-vn > maxImpact) {
        maxImpact = -vn;
        hx = px;
        hz = pz;
      }
    }
  }
  if (maxImpact > 0) {
    updateSlideAfterImpact(a, ta);
    updateSlideAfterImpact(b, tb);
    if (maxImpact > EVENT_IMPACT) pushEvent(ev, Ev.CarHit, a.id, b.id, maxImpact, hx, hz);
  }
}

export function clampSpeed(car: CarState): void {
  const s = Math.hypot(car.vx, car.vz);
  if (s > MAX_SPEED) {
    const k = MAX_SPEED / s;
    car.vx *= k;
    car.vz *= k;
  }
}
