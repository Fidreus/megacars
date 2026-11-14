// Item crates on the road (see shared/sim/crates.ts): bright amber boxes that
// bob and turn slowly over a glowing ring, drawn as two instanced meshes. A
// taken crate leaves a faint ring and grows back when it returns. Unlit
// colours, so they read the same in daylight, at sunset and at night.

import * as THREE from 'three';
import { CrateItem } from '../../shared/sim/crates.ts';
import { Ev, type SimEvent } from '../../shared/sim/events.ts';
import type { World } from '../../shared/sim/world.ts';
import type { Track } from '../../shared/track/types.ts';
import type { Particles } from './particles.ts';

const SIZE = 1.5;
/** Seconds a returning crate takes to grow back. */
const GROW = 0.35;

/** A crate face: amber planks with a dark rim and a cross brace, a white corner glint. */
function crateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffb21e';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#ffd860';
  ctx.fillRect(2, 2, 12, 5);
  ctx.fillStyle = '#7a3a06';
  ctx.fillRect(0, 0, 16, 2);
  ctx.fillRect(0, 14, 16, 2);
  ctx.fillRect(0, 0, 2, 16);
  ctx.fillRect(14, 0, 2, 16);
  for (let k = 2; k < 14; k++) {
    ctx.fillRect(k, k, 2, 1);
    ctx.fillRect(15 - k, k, 1, 1);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(2, 2, 2, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft round glow for the ground ring. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CrateView {
  readonly group = new THREE.Group();
  private readonly boxes: THREE.InstancedMesh;
  private readonly glows: THREE.InstancedMesh;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly track: Track;
  /** Time each crate came back (for the grow-in), and whether it was there last frame. */
  private readonly backAt: number[] = [];
  private readonly was: boolean[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(track: Track) {
    this.track = track;
    const n = Math.max(1, track.crates.length);
    // Slightly brighter than white so the crate holds up at night and blooms a touch.
    const boxMat = new THREE.MeshBasicMaterial({ map: crateTexture(), color: new THREE.Color(1.1, 1.02, 0.94) });
    this.boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), boxMat, n);
    this.boxes.castShadow = true;
    this.glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(), color: new THREE.Color(1.9, 1.05, 0.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2), this.glowMat, n);
    this.glows.renderOrder = 2;
    for (const mesh of [this.boxes, this.glows]) {
      mesh.count = track.crates.length;
      // Instances span the whole track: the default bounds are just one crate.
      mesh.frustumCulled = false;
    }
    for (let k = 0; k < track.crates.length; k++) {
      this.backAt.push(-1e9);
      this.was.push(true);
    }
    this.group.name = 'crates';
    this.group.add(this.glows, this.boxes);
  }

  /** `time`: seconds (simulation clock plus interpolation). */
  update(world: World, time: number): void {
    const on = world.race.weapons === 1 && this.track.crates.length > 0;
    this.group.visible = on;
    if (!on) return;
    const spots = this.track.crates;
    const pulse = 0.8 + 0.2 * Math.sin(time * 4);
    this.glowMat.opacity = pulse;
    for (let k = 0; k < spots.length; k++) {
      const sp = spots[k];
      const here = (world.crates[k] ?? 0) === 0;
      if (here && !this.was[k]) this.backAt[k] = time;
      // A new race (or a rewind) can jump time backwards.
      if (this.backAt[k] > time) this.backAt[k] = -1e9;
      this.was[k] = here;
      const grow = here ? Math.min(1, (time - this.backAt[k]) / GROW) : 0;
      // Each crate bobs and turns a little out of step with its neighbours.
      const phase = k * 1.7;
      const size = grow * (2 - grow);
      this.p.set(sp.x, sp.y + 0.95 + Math.sin(time * 2.6 + phase) * 0.18, sp.z);
      this.q.setFromAxisAngle(this.up, time * 1.3 + phase);
      this.s.setScalar(Math.max(1e-3, size));
      this.m.compose(this.p, this.q, this.s);
      this.boxes.setMatrixAt(k, this.m);
      // The ring stays faintly where a taken crate will come back.
      this.p.set(sp.x, sp.y + 0.06, sp.z);
      this.q.identity();
      this.s.setScalar(here ? 0.8 + 0.2 * size : 0.45);
      this.m.compose(this.p, this.q, this.s);
      this.glows.setMatrixAt(k, this.m);
    }
    this.boxes.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
  }
}

/** HDR particle colours per item kind (the burst's accent). */
const ITEM_RGB: Record<number, readonly [number, number, number]> = {
  [CrateItem.Missiles]: [6, 1.2, 0.8],
  [CrateItem.Mines]: [5, 0.6, 0.3],
  [CrateItem.Turbo]: [1.2, 3.2, 6],
  [CrateItem.Repair]: [1.2, 5, 1.4],
};

const R = Math.random;

/** A crate taken: a pop of amber splinters and sparks in the colour of what was inside. A crate back: a little twinkle. */
export function crateFx(p: Particles, e: SimEvent, y: number): void {
  if (e.kind === Ev.CratePickup) {
    const accent = ITEM_RGB[e.other] ?? [5, 4, 1];
    for (let k = 0; k < 22; k++) {
      const a = R() * Math.PI * 2;
      const sp = 3 + R() * 6;
      const hot = k % 2 === 0;
      const c = hot ? accent : ([4.5, 2.6, 0.5] as const);
      p.spawn(
        e.x, y + 1, e.z, Math.cos(a) * sp, 3 + R() * 5, Math.sin(a) * sp,
        0.3 + R() * 0.35, hot ? 2.4 : 1.8, 0.6, c[0], c[1], c[2], -14, 1.5,
      );
    }
    // A bright flash where it stood.
    p.spawn(e.x, y + 1, e.z, 0, 0, 0, 0.16, 7, 2, 6, 5, 3, 0, 0);
  } else if (e.kind === Ev.CrateBack) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      p.spawn(e.x + Math.cos(a) * 1.2, y + 0.4, e.z + Math.sin(a) * 1.2, 0, 2 + R(), 0, 0.4, 1.4, 0.4, 4, 2.8, 0.8, 0, 2);
    }
  }
}
