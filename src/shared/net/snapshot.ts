// Binary world snapshots. The server sends the complete simulation state; the
// client restores it exactly and re-simulates its own inputs on top. Floats go
// as float64 so a restored world steps bit-for-bit like the server's.

import { createCar, type CarState } from '../sim/car.ts';
import { copyInput, neutralInput, type CarInput } from '../sim/input.ts';
import type { World } from '../sim/world.ts';
import { MsgType } from './protocol.ts';
import { makeShot, ShotKind } from '../sim/weapons.ts';

type CarKey = keyof CarState;

/** Continuous car state. */
const F64: readonly CarKey[] = [
  'x', 'z', 'y', 'vx', 'vz', 'vy', 'heading', 'angVel', 'steer', 'damage', 'aiSkill', 'trackS', 'raceDist',
  'slip', 'latAccel', 'longAccel',
  'driftCharge', 'draft',
];

/** Counters, flags and indices. */
const I32: readonly CarKey[] = [
  'sliding', 'modeTicks', 'spinTicks', 'spinCool', 'airborne', 'prevButtons', 'brakeTicks', 'liftTicks',
  'aiPersona', 'aiFoe', 'aiAware', 'aiReact',
  'driftArm', 'aiDriven', 'aiMode', 'aiReverseTicks', 'human', 'trackIdx', 'lap', 'nextCp', 'lapStartTick',
  'lastLapTicks', 'bestLapTicks', 'wrongWayTicks', 'finished', 'finishTick', 'place', 'stuckTicks', 'ghostTicks',
  'respawns', 'surfFront', 'surfRear', 'missiles', 'mines', 'turbos', 'turboTicks', 'fireCool', 'mineCool',
  'wreckTicks', 'hits', 'kills', 'wrecks', 'pitTicks', 'lastHitBy',
  'driftBoostTicks', 'driftBoostLevel',
  'outOrder', 'outTick', 'outLap',
];

/** Every CarState key except `id` must be listed above (checked by tests). */
export const SNAPSHOT_CAR_KEYS: readonly CarKey[] = [...F64, ...I32];

const HEADER = 1 + 4 + 2 + 4 + 1 + 1 + 1 + 4 + 4 + 4 + 4 + 1 + 1;
const PER_CAR = F64.length * 8 + I32.length * 4 + 4;
/** slot, kind, owner, age, x, z, vx, vz, heading */
const PER_SHOT = 1 + 1 + 1 + 4 + 6 * 8;

export interface SnapshotMeta {
  /** How many ticks early this client's inputs arrive (minimum over the last half second). */
  lead: number;
  /** Last input tick the server has received from this client. */
  lastInputTick: number;
}

/** Crates: a count byte, then each crate's ticks until it is back (uint16). */
export function snapshotSize(cars: number, shots = 0, crates = 0): number {
  return HEADER + cars * (PER_CAR + 1) + 1 + shots * PER_SHOT + 1 + crates * 2;
}

/**
 * Encode `w` (state at the start of tick w.tick) with each car's most recent
 * input, which the client uses to predict cars driven by other people.
 */
export function encodeSnapshot(w: World, lastInputs: readonly CarInput[], meta: SnapshotMeta): Uint8Array {
  const n = w.cars.length;
  let live = 0;
  for (const sh of w.shots) if (sh.kind !== ShotKind.None) live++;
  const buf = new ArrayBuffer(snapshotSize(n, live, w.crates.length));
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, MsgType.Snapshot); o += 1;
  v.setUint32(o, w.tick, true); o += 4;
  v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(meta.lead))), true); o += 2;
  v.setUint32(o, Math.max(0, meta.lastInputTick), true); o += 4;
  v.setUint8(o, n); o += 1;
  v.setUint8(o, w.race.phase); o += 1;
  v.setUint8(o, w.race.laps); o += 1;
  v.setUint32(o, w.race.startTick, true); o += 4;
  v.setUint32(o, w.race.firstFinishTick, true); o += 4;
  v.setUint32(o, w.race.endTick, true); o += 4;
  v.setInt32(o, w.rng, true); o += 4;
  v.setUint8(o, w.race.finishOrder.length); o += 1;
  v.setUint8(o, w.race.weapons); o += 1;
  // finishOrder lives after the cars (fixed-size area of one byte per car).
  for (const car of w.cars) {
    for (const k of F64) { v.setFloat64(o, car[k], true); o += 8; }
    for (const k of I32) { v.setInt32(o, car[k], true); o += 4; }
    const inp = lastInputs[car.id];
    v.setInt8(o, Math.round((inp?.steer ?? 0) * 127)); o += 1;
    v.setUint8(o, Math.round((inp?.throttle ?? 0) * 255)); o += 1;
    v.setUint8(o, Math.round((inp?.brake ?? 0) * 255)); o += 1;
    v.setUint8(o, (inp?.buttons ?? 0) & 0xff); o += 1;
  }
  for (let i = 0; i < n; i++) v.setUint8(o + i, w.race.finishOrder[i] ?? 0xff);
  o += n;
  v.setUint8(o, live); o += 1;
  w.shots.forEach((sh, slot) => {
    if (sh.kind === ShotKind.None) return;
    v.setUint8(o, slot); o += 1;
    v.setUint8(o, sh.kind); o += 1;
    v.setUint8(o, sh.owner); o += 1;
    v.setInt32(o, sh.age, true); o += 4;
    for (const x of [sh.x, sh.z, sh.y, sh.vx, sh.vz, sh.heading]) { v.setFloat64(o, x, true); o += 8; }
  });
  v.setUint8(o, w.crates.length); o += 1;
  for (const c of w.crates) { v.setUint16(o, c, true); o += 2; }
  return new Uint8Array(buf);
}

export interface DecodedSnapshot {
  tick: number;
  meta: SnapshotMeta;
  carCount: number;
}

/** Read the header without touching a world. Returns null for malformed data. */
export function peekSnapshot(data: Uint8Array): DecodedSnapshot | null {
  if (data.byteLength < HEADER || data[0] !== MsgType.Snapshot) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const carCount = v.getUint8(11);
  const shotsAt = snapshotSize(carCount) - 2;
  if (data.byteLength <= shotsAt) return null;
  const live = v.getUint8(shotsAt);
  const cratesAt = snapshotSize(carCount, live) - 1;
  if (data.byteLength <= cratesAt) return null;
  if (data.byteLength !== snapshotSize(carCount, live, v.getUint8(cratesAt))) return null;
  return { tick: v.getUint32(1, true), meta: { lead: v.getInt16(5, true), lastInputTick: v.getUint32(7, true) }, carCount };
}

/**
 * Overwrite `w` with the snapshot (car objects are reused) and fill
 * `lastInputs[i]` with car i's latest input. The world must have the same
 * number of cars. Returns the snapshot tick, or -1 if it does not fit.
 */
export function applySnapshot(data: Uint8Array, w: World, lastInputs: CarInput[]): number {
  const head = peekSnapshot(data);
  if (!head || head.carCount !== w.cars.length) return -1;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 12;
  w.tick = head.tick;
  w.race.phase = v.getUint8(o); o += 1;
  w.race.laps = v.getUint8(o); o += 1;
  w.race.startTick = v.getUint32(o, true); o += 4;
  w.race.firstFinishTick = v.getUint32(o, true); o += 4;
  w.race.endTick = v.getUint32(o, true); o += 4;
  w.rng = v.getInt32(o, true); o += 4;
  const finished = v.getUint8(o); o += 1;
  w.race.weapons = v.getUint8(o); o += 1;
  for (const car of w.cars) {
    const c = car as unknown as Record<CarKey, number>;
    for (const k of F64) { c[k] = v.getFloat64(o, true); o += 8; }
    for (const k of I32) { c[k] = v.getInt32(o, true); o += 4; }
    const inp = (lastInputs[car.id] ??= neutralInput());
    inp.steer = v.getInt8(o) / 127; o += 1;
    inp.throttle = v.getUint8(o) / 255; o += 1;
    inp.brake = v.getUint8(o) / 255; o += 1;
    inp.buttons = v.getUint8(o); o += 1;
  }
  w.race.finishOrder.length = 0;
  for (let i = 0; i < finished; i++) w.race.finishOrder.push(v.getUint8(o + i));
  o += w.cars.length;
  // Shots go back into the same slots: their order decides who a mine hits first.
  for (const sh of w.shots) sh.kind = ShotKind.None;
  const live = v.getUint8(o); o += 1;
  for (let k = 0; k < live; k++) {
    const slot = v.getUint8(o); o += 1;
    while (w.shots.length <= slot) w.shots.push(makeShot());
    const sh = w.shots[slot];
    sh.kind = v.getUint8(o); o += 1;
    sh.owner = v.getUint8(o); o += 1;
    sh.age = v.getInt32(o, true); o += 4;
    sh.x = v.getFloat64(o, true); o += 8;
    sh.z = v.getFloat64(o, true); o += 8;
    sh.y = v.getFloat64(o, true); o += 8;
    sh.vx = v.getFloat64(o, true); o += 8;
    sh.vz = v.getFloat64(o, true); o += 8;
    sh.heading = v.getFloat64(o, true); o += 8;
  }
  const crates = v.getUint8(o); o += 1;
  w.crates.length = crates;
  for (let k = 0; k < crates; k++) { w.crates[k] = v.getUint16(o, true); o += 2; }
  w.events.count = 0;
  return head.tick;
}

/** Deep copy of the simulation state of `src` into `dst` (same car count). */
export function copyWorld(dst: World, src: World): void {
  dst.tick = src.tick;
  dst.rng = src.rng;
  dst.weather = src.weather;
  dst.elim = src.elim;
  Object.assign(dst.race, src.race, { finishOrder: [...src.race.finishOrder] });
  for (let i = 0; i < src.cars.length; i++) {
    if (!dst.cars[i]) dst.cars[i] = createCar(i, 0, 0, 0);
    Object.assign(dst.cars[i], src.cars[i]);
  }
  dst.cars.length = src.cars.length;
  for (let i = 0; i < src.shots.length; i++) {
    if (!dst.shots[i]) dst.shots[i] = makeShot();
    Object.assign(dst.shots[i], src.shots[i]);
  }
  dst.shots.length = src.shots.length;
  dst.crates.length = src.crates.length;
  for (let i = 0; i < src.crates.length; i++) dst.crates[i] = src.crates[i];
}

export function cloneInputs(src: readonly CarInput[]): CarInput[] {
  return src.map((i) => copyInput(neutralInput(), i));
}
