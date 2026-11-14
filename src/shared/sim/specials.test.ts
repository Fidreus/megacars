import { describe, expect, it } from 'vitest';
import { makeSurfaceMix, mixSurfaces, Surface, type SurfaceId } from '../config/surfaces.ts';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { encodeInput, decodeInput } from '../net/protocol.ts';
import { applySnapshot, encodeSnapshot } from '../net/snapshot.ts';
import { buy, defaultLoadout, newProfile, priceOf, settle, raceResults } from '../game/shop.ts';
import { createRaceWorld } from '../game/raceSetup.ts';
import { decodeReplay, ReplayRecorder } from '../game/records.ts';
import { getTrack, sampleIndexAt } from '../track/builder.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { aiSpecial, missileComing, slickAvoid } from '../ai/specials.ts';
import { createCar } from './car.ts';
import { CrateItem, rollCrate } from './crates.ts';
import { Ev } from './events.ts';
import { Btn, neutralInput, type CarInput } from './input.ts';
import { lockTarget, SPECIAL, SpecialItem, steerHoming } from './specials.ts';
import { sampleCarSurface, stepWorld } from './step.ts';
import { makeShot, ShotKind, WEAPON } from './weapons.ts';
import { createWorld, type World } from './world.ts';

const track = getTrack(GREEN_VALLEY);
const T = [DEFAULT_TUNING];

/** Two cars on the main straight, car 1 `gap` metres in front of car 0 (and `side` metres to its right). */
function duel(gap: number, side = 0, cars = 2): World {
  const w = createWorld(track, cars, 1, { laps: 3, countdownTicks: 0, weapons: true });
  const [a, b] = w.cars;
  const fx = Math.sin(a.heading);
  const fz = -Math.cos(a.heading);
  b.x = a.x + fx * gap - fz * side;
  b.z = a.z + fz * gap + fx * side;
  b.heading = a.heading;
  for (let i = 2; i < cars; i++) w.cars[i].x += 400;
  // Weapons free (a start tick that also survives a snapshot).
  w.tick = WEAPON.startGrace;
  return w;
}

function run(w: World, ticks: number, inputs: CarInput[], log: { kind: number; car: number; other: number; value: number }[] = []) {
  for (let i = 0; i < ticks; i++) {
    stepWorld(w, track, inputs, T);
    for (let k = 0; k < w.events.count; k++) {
      const e = w.events.list[k];
      log.push({ kind: e.kind, car: e.car, other: e.other, value: e.value });
    }
    for (const inp of inputs) inp.buttons &= ~(Btn.FireFront | Btn.FireRear | Btn.Turbo | Btn.Special);
  }
  return log;
}

const use = (): CarInput => ({ ...neutralInput(), buttons: Btn.Special });

describe('homing missile', () => {
  it('locks onto the nearest car ahead inside the cone', () => {
    const w = duel(40, 0, 4);
    const [a, b, c, d] = w.cars;
    const fx = Math.sin(a.heading);
    const fz = -Math.cos(a.heading);
    // c: nearer, but behind; d: nearer, but far off to the side.
    Object.assign(c, { x: a.x - fx * 20, z: a.z - fz * 20 });
    Object.assign(d, { x: a.x + fx * 15 - fz * 20, z: a.z + fz * 15 + fx * 20 });
    expect(lockTarget(a, w.cars, track.pit)).toBe(b.id);
    // Out of range: nothing.
    Object.assign(b, { x: a.x + fx * (SPECIAL.lockRange + 5), z: a.z + fz * (SPECIAL.lockRange + 5) });
    expect(lockTarget(a, w.cars, track.pit)).toBe(-1);
  });

  it('does not lock onto a car on another level of a bridge, and drops the lock when it leaves the level', () => {
    const w = duel(40);
    const [a, b] = w.cars;
    b.y = 5;
    expect(lockTarget(a, w.cars, track.pit)).toBe(-1);
    b.y = 0;
    const s = makeShot();
    Object.assign(s, { kind: ShotKind.Homing, owner: 0, x: a.x, z: a.z, y: 0, heading: a.heading, vx: Math.sin(a.heading) * 50, vz: -Math.cos(a.heading) * 50, target: b.id });
    steerHoming(s, w.cars, 1 / 60);
    expect(s.target).toBe(b.id);
    b.y = SPECIAL.levelGap + 0.5;
    steerHoming(s, w.cars, 1 / 60);
    expect(s.target).toBe(-1);
  });

  it('turns no faster than its turn rate, and is out-turned by a car that gets too far off its nose', () => {
    const w = duel(40, 12);
    const [a, b] = w.cars;
    const s = makeShot();
    Object.assign(s, { kind: ShotKind.Homing, owner: 0, x: a.x, z: a.z, y: 0, heading: a.heading, vx: Math.sin(a.heading) * 50, vz: -Math.cos(a.heading) * 50, target: b.id });
    const h0 = s.heading;
    steerHoming(s, w.cars, 1 / 60);
    expect(Math.abs(s.heading - h0)).toBeCloseTo(SPECIAL.homingTurn / 60, 6);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(50, 6);
    // The target now sits beside the missile: the lock is lost and it flies on straight.
    const fx = Math.sin(a.heading);
    const fz = -Math.cos(a.heading);
    Object.assign(b, { x: s.x - fz * 10, z: s.z + fx * 10 });
    const h1 = s.heading;
    steerHoming(s, w.cars, 1 / 60);
    expect(s.target).toBe(-1);
    steerHoming(s, w.cars, 1 / 60);
    expect(s.heading).toBe(h1);
  });

  it('curves after a car off to the side and hits it, where a straight missile misses', () => {
    const hit = (homing: boolean) => {
      const w = duel(45, 9);
      if (homing) w.cars[0].special = SpecialItem.Homing;
      const log = run(w, 90, [homing ? use() : { ...neutralInput(), buttons: Btn.FireFront }, neutralInput()]);
      return { log, w };
    };
    const straight = hit(false);
    expect(straight.w.cars[1].damage).toBe(0);
    const { log, w } = hit(true);
    expect(w.cars[0].special).toBe(SpecialItem.None);
    const fire = log.find((e) => e.kind === Ev.Fire);
    expect(fire?.other).toBe(ShotKind.Homing);
    expect(fire?.value).toBe(2); // locked onto car 1
    expect(log.some((e) => e.kind === Ev.Explosion && e.value === 4 && e.car === 1)).toBe(true);
    expect(w.cars[1].damage).toBeCloseTo(WEAPON.missileDamage, 5);
  });

  it('with nothing ahead it flies straight and blows up on a wall', () => {
    const w = duel(-20);
    const a = w.cars[0];
    // Point it across the road at the barrier.
    a.heading += Math.PI / 2;
    a.special = SpecialItem.Homing;
    const log = run(w, 120, [use(), neutralInput()]);
    expect(log.find((e) => e.kind === Ev.Fire)?.value).toBe(0);
    expect(log.some((e) => e.kind === Ev.Explosion && e.value === 3 && e.other === 0)).toBe(true);
    expect(w.shots.every((s) => s.kind === ShotKind.None)).toBe(true);
  });

  it('is only fired after the start grace, outside the pit, and only when held', () => {
    const w = duel(40);
    w.tick = 0;
    w.cars[0].special = SpecialItem.Homing;
    run(w, 1, [use(), neutralInput()]);
    expect(w.cars[0].special).toBe(SpecialItem.Homing);
    const v = duel(40);
    const log = run(v, 1, [use(), neutralInput()]);
    expect(log.some((e) => e.kind === Ev.Fire)).toBe(false);
  });
});

describe('oil slick', () => {
  it('is dropped behind and turns the road under any car to oil, the owner after a grace', () => {
    const w = duel(-30);
    const [a, b] = w.cars;
    a.special = SpecialItem.Oil;
    const log = run(w, 1, [use(), neutralInput()]);
    const slick = w.shots.find((s) => s.kind === ShotKind.Oil)!;
    expect(slick).toBeDefined();
    const fx = Math.sin(a.heading);
    const fz = -Math.cos(a.heading);
    expect((slick.x - a.x) * fx + (slick.z - a.z) * fz).toBeLessThan(-3);
    expect(log.some((e) => e.kind === Ev.Fire && e.other === ShotKind.Oil)).toBe(true);
    // Car 1 drives onto it.
    Object.assign(b, { x: slick.x, z: slick.z, vx: 0, vz: 0 });
    const log2 = run(w, 1, [neutralInput(), neutralInput()]);
    expect(b.surfFront).toBe(Surface.Oil);
    expect(b.surfRear).toBe(Surface.Oil);
    expect(log2.some((e) => e.kind === Ev.OilSlip && e.car === 1 && e.other === 0)).toBe(true);
    // The owner, parked on it at once, slides only after the grace.
    Object.assign(b, { x: b.x + 300 });
    const v = duel(-30);
    v.cars[0].special = SpecialItem.Oil;
    run(v, 1, [use(), neutralInput()]);
    const own = v.shots.find((s) => s.kind === ShotKind.Oil)!;
    Object.assign(v.cars[0], { x: own.x, z: own.z, vx: 0, vz: 0 });
    run(v, 1, [neutralInput(), neutralInput()]);
    expect(v.cars[0].surfRear).not.toBe(Surface.Oil);
    run(v, SPECIAL.oilGrace, [neutralInput(), neutralInput()]);
    expect(v.cars[0].surfRear).toBe(Surface.Oil);
  });

  it('grips like painted oil: slippery, little grip, no drift charge', () => {
    const mix = mixSurfaces(Surface.Oil as SurfaceId, Surface.Oil as SurfaceId, makeSurfaceMix());
    expect(mix.slippery).toBe(1);
    expect(mix.grip).toBeLessThan(0.1);
    const w = duel(-8);
    w.cars[0].special = SpecialItem.Oil;
    run(w, 1, [use(), neutralInput()]);
    const slick = w.shots.find((s) => s.kind === ShotKind.Oil)!;
    const b = w.cars[1];
    // A car sliding across it charges no drift boost.
    Object.assign(b, { x: slick.x, z: slick.z, sliding: 1, driftCharge: 0 });
    const speed = 30;
    b.vx = Math.sin(b.heading + 0.4) * speed;
    b.vz = -Math.cos(b.heading + 0.4) * speed;
    run(w, 1, [neutralInput(), { ...neutralInput(), steer: 1, throttle: 1 }]);
    expect(b.driftCharge).toBe(0);
  });

  it('lies on the road for its life, then goes', () => {
    const w = duel(-30);
    w.cars[0].special = SpecialItem.Oil;
    run(w, 1, [use(), neutralInput()]);
    run(w, SPECIAL.oilLife - 1, [neutralInput(), neutralInput()]);
    expect(w.shots.some((s) => s.kind === ShotKind.Oil)).toBe(true);
    run(w, 2, [neutralInput(), neutralInput()]);
    expect(w.shots.some((s) => s.kind === ShotKind.Oil)).toBe(false);
  });

  it('computer drivers steer round a slick on their line when there is room', () => {
    const w = duel(30);
    const a = w.cars[0];
    const s = makeShot();
    Object.assign(s, { kind: ShotKind.Oil, owner: 1, y: 0, age: 200 });
    // Put it on the racing line ahead of car 0.
    const i = sampleIndexAt(track, a.trackS + 30);
    s.x = track.line.x[i];
    s.z = track.line.z[i];
    const shift = slickAvoid(a, track, [s]);
    expect(Math.abs(shift)).toBeGreaterThan(SPECIAL.oilRadius);
    expect(Math.abs(shift)).toBeLessThanOrEqual(6);
    // Far off the line: nothing to do.
    s.x += track.nx[i] * 12;
    s.z += track.nz[i] * 12;
    expect(slickAvoid(a, track, [s])).toBe(0);
  });
});

describe('shield', () => {
  it('stops a missile and its damage, and bounces it off', () => {
    const w = duel(25);
    w.cars[1].special = SpecialItem.Shield;
    const log = run(w, 1, [neutralInput(), use()]);
    expect(log.some((e) => e.kind === Ev.ShieldUp && e.car === 1)).toBe(true);
    expect(w.cars[1].shieldTicks).toBe(SPECIAL.shieldTicks);
    run(w, 40, [{ ...neutralInput(), buttons: Btn.FireFront }, neutralInput()], log);
    expect(w.cars[1].damage).toBe(0);
    expect(w.cars[1].spinTicks).toBe(0);
    expect(log.some((e) => e.kind === Ev.ShieldBlock && e.car === 1 && e.value === 1)).toBe(true);
    expect(log.some((e) => e.kind === Ev.Explosion && e.car === 1)).toBe(false);
    expect(w.cars[0].hits).toBe(0);
  });

  it('stops a mine: no damage, no flight', () => {
    const w = duel(-12);
    w.cars[1].special = SpecialItem.Shield;
    run(w, 1, [{ ...neutralInput(), buttons: Btn.FireRear }, use()]);
    w.cars[0].x += 300;
    const gas = { ...neutralInput(), throttle: 1 };
    const log = run(w, 100, [neutralInput(), gas]);
    expect(log.some((e) => e.kind === Ev.ShieldBlock && e.value === 2)).toBe(true);
    expect(w.cars[1].damage).toBe(0);
    expect(w.shots.some((s) => s.kind === ShotKind.Mine)).toBe(false);
  });

  it('runs out after its time', () => {
    const w = duel(80);
    w.cars[0].special = SpecialItem.Shield;
    run(w, 1, [use(), neutralInput()]);
    run(w, SPECIAL.shieldTicks - 1, [neutralInput(), neutralInput()]);
    expect(w.cars[0].shieldTicks).toBe(1);
    run(w, 1, [neutralInput(), neutralInput()]);
    expect(w.cars[0].shieldTicks).toBe(0);
    // Unshielded again: a missile hurts.
    const v = duel(25);
    Object.assign(v.cars[1], { shieldTicks: 0 });
    run(v, 40, [{ ...neutralInput(), buttons: Btn.FireFront }, neutralInput()]);
    expect(v.cars[1].damage).toBeGreaterThan(0);
  });

  it('takes the edge off knocks', () => {
    const crash = (shield: boolean) => {
      const w = duel(80);
      const a = w.cars[0];
      a.shieldTicks = shield ? 200 : 0;
      a.heading += Math.PI / 2;
      a.vx = Math.sin(a.heading) * 45;
      a.vz = -Math.cos(a.heading) * 45;
      run(w, 60, [{ ...neutralInput(), throttle: 1 }, neutralInput()]);
      return a.damage;
    };
    const bare = crash(false);
    expect(bare).toBeGreaterThan(0.02);
    expect(crash(true)).toBeCloseTo(bare * SPECIAL.shieldKnock, 2);
  });
});

describe('the special slot', () => {
  it('holds one item; crates fill it only when empty, the shop sells one into an empty slot', () => {
    const c = Object.assign(createCar(0, 0, 0, 0), { place: 8, special: SpecialItem.Oil as number });
    for (let tick = 0; tick < 2000; tick++) {
      const it = rollCrate(3, 1, tick, c, 8)!.item;
      expect(it === CrateItem.Homing || it === CrateItem.Oil || it === CrateItem.Shield).toBe(false);
    }
    c.special = SpecialItem.None;
    const got = new Set<number>();
    for (let tick = 0; tick < 2000; tick++) got.add(rollCrate(3, 1, tick, c, 8)!.item);
    expect(got.has(CrateItem.Homing) && got.has(CrateItem.Oil) && got.has(CrateItem.Shield)).toBe(true);
    const p = newProfile();
    expect(priceOf(p, 'shield')).toBeGreaterThan(100);
    expect(buy(p, 'shield')).toBeNull();
    expect(p.special).toBe(SpecialItem.Shield);
    expect(priceOf(p, 'homing')).toBeNull();
    expect(buy(p, 'homing')).toBe('SLOT FULL');
    expect(p.special).toBe(SpecialItem.Shield);
  });

  it('crates give homing missiles further back, oil and shields further forward', () => {
    const count = (place: number) => {
      const n: Record<number, number> = {};
      for (let tick = 0; tick < 6000; tick++) {
        const it = rollCrate(5, 2, tick, Object.assign(createCar(0, 0, 0, 0), { place, damage: 0.5 }), 8)!.item;
        n[it] = (n[it] ?? 0) + 1;
      }
      return n;
    };
    const lead = count(1);
    const last = count(8);
    expect(last[CrateItem.Homing]).toBeGreaterThan(lead[CrateItem.Homing] * 2);
    expect(lead[CrateItem.Oil]).toBeGreaterThan(last[CrateItem.Oil] * 2);
    expect(lead[CrateItem.Shield]).toBeGreaterThan(last[CrateItem.Shield] * 1.2);
    // Rarer than the ordinary ammunition.
    for (const k of [CrateItem.Homing, CrateItem.Oil, CrateItem.Shield]) {
      expect(lead[k] + last[k]).toBeLessThan(lead[CrateItem.Missiles] + last[CrateItem.Missiles]);
    }
  });

  it('a bought item starts the race in the slot and what is left carries over', () => {
    const p = newProfile();
    buy(p, 'oil');
    const spec = {
      id: 1, track: 'greenvalley', laps: 1, seed: 1, countdownTicks: 0, weapons: true,
      entrants: [{ name: 'A', color: '#fff', playerId: 0, skill: 1, loadout: { ...defaultLoadout(), special: p.special } }],
    };
    const { world } = createRaceWorld(spec);
    expect(world.cars[0].special).toBe(SpecialItem.Oil);
    world.cars[0].special = SpecialItem.Homing;
    settle(p, world, raceResults(world)[0]);
    expect(p.special).toBe(SpecialItem.Homing);
  });

  it('the button travels on the wire and in lap replays', () => {
    const i = { ...neutralInput(), buttons: Btn.Special | Btn.FireFront };
    const o = neutralInput();
    decodeInput(encodeInput(7, i), o);
    expect(o.buttons).toBe(Btn.Special | Btn.FireFront);
    const rec = new ReplayRecorder();
    rec.add(neutralInput());
    rec.add(i);
    const r = decodeReplay(rec.encode())!;
    r.at(1, o);
    expect(o.buttons & Btn.Special).toBe(Btn.Special);
  });

  it('all three survive a snapshot round trip and the worlds step on alike', () => {
    const w = duel(50, 3, 4);
    const [a, b, c] = w.cars;
    a.special = SpecialItem.Homing;
    b.special = SpecialItem.Shield;
    c.special = SpecialItem.Oil;
    Object.assign(c, { x: a.x, z: a.z });
    const fx = Math.sin(a.heading);
    const fz = -Math.cos(a.heading);
    c.x -= fx * 15;
    c.z -= fz * 15;
    const inputs = [use(), use(), use(), neutralInput()];
    run(w, 1, inputs);
    run(w, 5, inputs);
    expect(w.shots.some((s) => s.kind === ShotKind.Homing && s.target === b.id)).toBe(true);
    expect(w.shots.some((s) => s.kind === ShotKind.Oil)).toBe(true);
    expect(b.shieldTicks).toBeGreaterThan(0);
    w.cars[3].special = SpecialItem.Shield;
    const last = w.cars.map(() => neutralInput());
    const data = encodeSnapshot(w, last, { lead: 0, lastInputTick: 0 });
    const v = createWorld(track, 4, 9, { laps: 3, countdownTicks: 0, weapons: true });
    expect(applySnapshot(data, v, [])).toBe(w.tick);
    for (let i = 0; i < 4; i++) {
      expect(v.cars[i].special).toBe(w.cars[i].special);
      expect(v.cars[i].shieldTicks).toBe(w.cars[i].shieldTicks);
    }
    w.shots.forEach((s, k) => {
      if (s.kind !== ShotKind.None) expect([v.shots[k].kind, v.shots[k].target, v.shots[k].x]).toEqual([s.kind, s.target, s.x]);
    });
    for (let t = 0; t < 120; t++) {
      stepWorld(w, track, last, T);
      stepWorld(v, track, last, T);
    }
    expect(v.cars.map((c) => [c.x, c.z, c.damage, c.shieldTicks])).toEqual(w.cars.map((c) => [c.x, c.z, c.damage, c.shieldTicks]));
  });
});

describe('computer drivers and specials', () => {
  it('raise the shield for a missile coming at them, after their reaction time', () => {
    const w = duel(30);
    const [a, b] = w.cars;
    b.aiDriven = 1;
    b.special = SpecialItem.Shield;
    const s = makeShot();
    const fx = Math.sin(a.heading);
    const fz = -Math.cos(a.heading);
    Object.assign(s, { kind: ShotKind.Missile, owner: 0, x: a.x + fx * 3, z: a.z + fz * 3, y: 0, vx: fx * 60, vz: fz * 60, heading: a.heading });
    w.shots.push(s);
    expect(missileComing(b, w.shots)).toBe(true);
    let first = -1;
    const out = neutralInput();
    for (let t = 0; t < 40 && first < 0; t++) {
      out.buttons = 0;
      aiSpecial(b, w.cars, w.shots, track, 1000 + t, out);
      if (out.buttons & Btn.Special) first = t;
    }
    expect(first).toBeGreaterThan(2);
  });
});
