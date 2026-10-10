// Car handling parameters. Units: metres, seconds, radians unless the name
// says otherwise. These are starting values meant to be tuned live (lil-gui).

export interface CarTuning {
  // Engine and brakes
  accel0: number; // m/s² at standstill
  vTop: number; // m/s
  brakeDecel: number;
  reverseAccel: number;
  reverseMax: number;
  coastBase: number; // m/s² rolling resistance when off throttle
  coastLinear: number; // extra per m/s
  // Steering
  rMin: number; // minimum turning radius at low speed
  omegaPeak: number; // max yaw rate rad/s
  steerLo: number; // fraction of grip used by full lock at medium speed
  steerHi: number; // fraction of grip demanded by full lock at high speed (>1 breaks traction)
  steerV0: number;
  steerV1: number;
  steerRateIn: number; // keyboard ramp, 1/s
  steerRateOut: number;
  steerRateFlip: number;
  // Grip
  aGrip: number; // lateral budget while gripping, m/s²
  frictionCircle: number; // share of grip lost at full longitudinal use
  overloadRatio: number; // yaw demand / grip budget that counts as overload
  slideEnterTicks: number; // overloaded ticks before the car breaks loose
  slipEnterDeg: number;
  slipExitDeg: number;
  slipExitTicks: number;
  // Sliding
  aSlide: number; // lateral budget while sliding, m/s²
  kAlign: number; // 1/s, how fast velocity swings toward the nose per radian of slip
  cScrub: number; // 1/s, speed loss factor × |sin β|
  aSteerSlide: number;
  kPow: number; // throttle-induced extra yaw in a slide, rad/s
  assistKb: number;
  assistPad: number;
  kYawGrip: number;
  kYawSlide: number;
  // Spins
  spinDeg: number;
  spinMinSpeed: number;
  spinTicks: number;
  spinCooldownTicks: number;
  spinDecel: number;
  spinYawKick: number;
  // Air
  gravity: number;
  // Body and collisions
  mass: number;
  inertia: number;
  circleR: number;
  circleOffset: number;
  wallRestitution: number;
  wallFriction: number;
  carRestitution: number;
  carFriction: number;
  wallDamageSpeed: number;
  carDamageSpeed: number;
}

export const DEFAULT_TUNING: CarTuning = {
  accel0: 13,
  vTop: 46,
  brakeDecel: 18,
  reverseAccel: 6,
  reverseMax: 9,
  coastBase: 1.5,
  coastLinear: 0.03,

  rMin: 5.5,
  omegaPeak: 3.0,
  steerLo: 0.9,
  steerHi: 1.3,
  steerV0: 18,
  steerV1: 38,
  steerRateIn: 5,
  steerRateOut: 9,
  steerRateFlip: 14,

  aGrip: 14,
  frictionCircle: 0.65,
  overloadRatio: 1.0,
  slideEnterTicks: 4,
  slipEnterDeg: 7,
  slipExitDeg: 3,
  slipExitTicks: 6,

  aSlide: 26,
  kAlign: 3.5,
  cScrub: 0.55,
  aSteerSlide: 45,
  kPow: 0.6,
  assistKb: 0.5,
  assistPad: 0.25,
  kYawGrip: 12,
  kYawSlide: 6,

  spinDeg: 80,
  spinMinSpeed: 8,
  spinTicks: 36,
  spinCooldownTicks: 60,
  spinDecel: 12,
  spinYawKick: 5,

  gravity: 22,

  mass: 1000,
  inertia: 1700,
  circleR: 1.05,
  circleOffset: 1.2,
  wallRestitution: 0.2,
  wallFriction: 0.35,
  carRestitution: 0.4,
  carFriction: 0.25,
  wallDamageSpeed: 6,
  carDamageSpeed: 4,
};

export function cloneTuning(t: CarTuning): CarTuning {
  return { ...t };
}

/** Stable hash of all tuning values; clients and server must agree on it. */
export function tuningHash(t: CarTuning): number {
  let h = 0x811c9dc5;
  for (const key of Object.keys(t).sort()) {
    const v = Math.round((t as unknown as Record<string, number>)[key] * 1e6);
    h = Math.imul(h ^ (v & 0xffff), 0x01000193);
    h = Math.imul(h ^ (v >>> 16), 0x01000193);
  }
  return h >>> 0;
}
