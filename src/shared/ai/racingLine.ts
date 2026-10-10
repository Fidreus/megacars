// Racing line after Rémi Coulom's K1999 algorithm (TORCS): repeatedly move
// each point sideways so its curvature becomes the distance-weighted average
// of its neighbours' curvature, coarse to fine, while staying inside the road.
// The result has smoothly varying curvature and uses the full width: outside
// on entry, apex on the inside, outside on exit.

import { curvature3 } from '../math/geom.ts';
import type { RacingLine, Track } from '../track/types.ts';

/** Distance kept from the outer road edge (car centre), metres. */
const EXT_MARGIN = 1.5;
/** Distance kept from the inner edge at the apex (wheels may touch the curb). */
const INT_MARGIN = 1.15;
/** Extra margin where the chord between coarse points cuts inside the curve. */
const SECURITY_R = 100;
const ITERATIONS = 60;

export function computeRacingLine(track: Track): RacingLine {
  const { n, px, pz, nx, nz, hw } = track;
  const off = new Float64Array(n);
  const x = new Float64Array(px);
  const z = new Float64Array(pz);

  const setOff = (i: number, o: number) => {
    off[i] = o;
    x[i] = px[i] + nx[i] * o;
    z[i] = pz[i] + nz[i] * o;
  };
  const rInv = (a: number, bx: number, bz: number, c: number) => curvature3(x[a], z[a], bx, bz, x[c], z[c]);

  /** Move point i so the curvature through prev-i-next approaches `target`. */
  const adjust = (prev: number, i: number, next: number, target: number, security: number) => {
    const old = off[i];
    const w = hw[i];
    // Start from the point on the chord prev-next (zero curvature)...
    const dx = x[next] - x[prev];
    const dz = z[next] - z[prev];
    const cr = dx * nz[i] - dz * nx[i];
    let o = old;
    if (Math.abs(cr) > 1e-9) o = -(dx * (pz[i] - z[prev]) - dz * (px[i] - x[prev])) / cr;
    o = Math.max(-1.4 * w, Math.min(1.4 * w, o));
    // ...then one Newton step on the lateral position.
    const dO = 0.001;
    const dR = rInv(prev, px[i] + nx[i] * (o + dO), pz[i] + nz[i] * (o + dO), next);
    if (Math.abs(dR) > 1e-12) o += (dO / dR) * target;
    const ext = Math.min(w, EXT_MARGIN + security);
    const int = Math.min(w, INT_MARGIN + security);
    if (target >= 0) {
      // Right turn: the inside is the +offset side.
      if (o > w - int) o = w - int;
      if (o < -(w - ext)) o = old < -(w - ext) ? Math.max(old, o) : -(w - ext);
    } else {
      if (o < -(w - int)) o = -(w - int);
      if (o > w - ext) o = old > w - ext ? Math.min(old, o) : w - ext;
    }
    setOff(i, o);
  };

  const dist = (a: number, b: number) => Math.hypot(x[a] - x[b], z[a] - z[b]);

  for (let step = 128; step >= 1; step >>= 1) {
    const coarse: number[] = [];
    for (let i = 0; i <= n - Math.max(1, step / 2); i += step) coarse.push(i);
    const m = coarse.length;
    if (m < 5) continue;
    const at = (k: number) => coarse[((k % m) + m) % m];
    const iterations = Math.round(ITERATIONS * Math.sqrt(step));
    for (let it = 0; it < iterations; it++) {
      for (let k = 0; k < m; k++) {
        const pp = at(k - 2), p = at(k - 1), i = at(k), nn = at(k + 1), n2 = at(k + 2);
        const ri0 = rInv(pp, x[p], z[p], i);
        const ri1 = rInv(i, x[nn], z[nn], n2);
        const lPrev = dist(i, p);
        const lNext = dist(i, nn);
        const target = (lNext * ri0 + lPrev * ri1) / (lNext + lPrev);
        const security = (lPrev * lNext) / (8 * SECURITY_R);
        adjust(p, i, nn, target, security);
      }
    }
    if (step > 1) {
      // Place the points between coarse points with linearly blended curvature.
      for (let k = 0; k < m; k++) {
        const a = at(k);
        const b = at(k + 1);
        const span = k + 1 < m ? b - a : n - a;
        const ir0 = rInv(at(k - 1), x[a], z[a], b);
        const ir1 = rInv(a, x[b], z[b], at(k + 2));
        for (let d = 1; d < span; d++) {
          const t = d / span;
          adjust(a, (a + d) % n, b, t * ir1 + (1 - t) * ir0, 0);
        }
      }
    }
  }

  // Curvature over a short baseline, lightly smoothed.
  const raw = new Float64Array(n);
  const K = 3;
  for (let i = 0; i < n; i++) {
    const a = (i - K + n) % n;
    const b = (i + K) % n;
    raw[i] = curvature3(x[a], z[a], x[i], z[i], x[b], z[b]);
  }
  const curv = new Float64Array(n);
  const W = 2;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -W; k <= W; k++) sum += raw[(i + k + n) % n];
    curv[i] = sum / (2 * W + 1);
  }

  const s = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    s[i] = acc;
    const j = (i + 1) % n;
    acc += Math.hypot(x[j] - x[i], z[j] - z[i]);
  }
  return { off, x, z, curv, s, length: acc };
}
