import { describe, expect, it } from 'vitest';
import { Ev, type SimEvent } from '../../shared/sim/events.ts';
import { Haptics, PULSE, type HapticsIo, type Rumble } from './haptics.ts';

function setup(players: number[], phone = false) {
  const pads: { index: number; r: Rumble }[] = [];
  const buzz: (number | number[])[] = [];
  const io: HapticsIo = {
    pad: (index, r) => (pads.push({ index, r }), true),
    vibrate: (p) => buzz.push(p),
    stop: () => {},
  };
  const h = new Haptics({ players: () => players, pad: (p) => p, phone: () => phone }, io);
  return { h, pads, buzz };
}

const ev = (kind: number, car: number, other = -1, value = 10): SimEvent => ({ kind, car, other, value, x: 0, z: 0 });

describe('haptics', () => {
  it('rumbles only the pad of the car that was hit', () => {
    const { h, pads } = setup([3, 5]);
    h.event(ev(Ev.WallHit, 5, -1, 15));
    expect(pads.map((p) => p.index)).toEqual([1]);
  });

  it('a car-to-car hit is felt by both local players', () => {
    const { h, pads } = setup([3, 5]);
    h.event(ev(Ev.CarHit, 3, 5, 12));
    expect(pads.map((p) => p.index).sort()).toEqual([0, 1]);
  });

  it('ignores other cars and small scrapes', () => {
    const { h, pads } = setup([3]);
    h.event(ev(Ev.WallHit, 4, -1, 20));
    h.event(ev(Ev.WallHit, 3, -1, 1.8));
    expect(pads).toHaveLength(0);
  });

  it('harder hits are stronger and longer', () => {
    const a = setup([0]);
    a.h.event(ev(Ev.WallHit, 0, -1, 5));
    const b = setup([0]);
    b.h.event(ev(Ev.WallHit, 0, -1, 20));
    expect(b.pads[0].r.strong).toBeGreaterThan(a.pads[0].r.strong);
    expect(b.pads[0].r.ms).toBeGreaterThan(a.pads[0].r.ms);
  });

  it('does nothing when switched off', () => {
    const { h, pads, buzz } = setup([0], true);
    h.enabled = false;
    h.event(ev(Ev.Wreck, 0));
    h.all(PULSE.go);
    expect(pads).toHaveLength(0);
    expect(buzz).toHaveLength(0);
  });

  it('a pulse still running is only cut off by a stronger one', () => {
    const { h, pads } = setup([0]);
    h.play(0, { strong: 0.8, weak: 0, ms: 200 }, 1000);
    h.play(0, { strong: 0.5, weak: 0, ms: 100 }, 1050);
    h.play(0, { strong: 1, weak: 0, ms: 100 }, 1060);
    h.play(0, { strong: 0.5, weak: 0, ms: 100 }, 1400);
    expect(pads.map((p) => p.r.strong)).toEqual([0.8, 1, 0.5]);
  });

  it('the phone buzzes for player 1 only, and only when it is a phone', () => {
    const phone = setup([0, 1], true);
    phone.h.event(ev(Ev.Wreck, 1));
    expect(phone.buzz).toHaveLength(0);
    phone.h.event(ev(Ev.Wreck, 0));
    expect(phone.buzz).toHaveLength(1);
    const desktop = setup([0], false);
    desktop.h.event(ev(Ev.Wreck, 0));
    expect(desktop.buzz).toHaveLength(0);
  });

  it('the start is felt by everybody', () => {
    const { h, pads } = setup([2, 3]);
    h.event(ev(Ev.RaceStart, -1));
    expect(pads).toHaveLength(2);
  });

  it('a missile that hits a wall (no car) is silent', () => {
    const { h, pads } = setup([0]);
    h.event(ev(Ev.Explosion, -1, 0, 3));
    expect(pads).toHaveLength(0);
  });
});
