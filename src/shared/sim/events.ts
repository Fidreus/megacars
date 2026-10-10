// Things that happened during a tick, for sound, particles and UI. Pooled so
// the simulation never allocates while running.

export const Ev = {
  WallHit: 1,
  CarHit: 2,
  Lap: 3,
  Spin: 4,
  Respawn: 5,
} as const;

export interface SimEvent {
  kind: number;
  car: number;
  other: number;
  value: number;
  x: number;
  z: number;
}

export interface EventBuffer {
  list: SimEvent[];
  count: number;
}

export function makeEventBuffer(): EventBuffer {
  return { list: [], count: 0 };
}

export function pushEvent(
  buf: EventBuffer, kind: number, car: number, other: number, value: number, x: number, z: number,
): void {
  if (buf.count >= buf.list.length) buf.list.push({ kind: 0, car: 0, other: 0, value: 0, x: 0, z: 0 });
  const e = buf.list[buf.count++];
  e.kind = kind;
  e.car = car;
  e.other = other;
  e.value = value;
  e.x = x;
  e.z = z;
}
