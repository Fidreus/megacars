// The special items on the track: homing missiles (orange, with a curving
// trail of sparks), oil slicks (a glossy black puddle with a rainbow sheen
// that fades as it runs out, unlit so it shows at night) and shield bubbles
// round the cars. Follows the simulation's shot slots and car state.

import * as THREE from 'three';
import { DT } from '../../shared/config/constants.ts';
import { Ev } from '../../shared/sim/events.ts';
import { SPECIAL } from '../../shared/sim/specials.ts';
import { ShotKind, type Shot } from '../../shared/sim/weapons.ts';
import type { World } from '../../shared/sim/world.ts';
import { toon } from './materials.ts';
import type { Particles } from './particles.ts';

const R = Math.random;

const bodyGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 6).rotateX(Math.PI / 2);
const noseGeo = new THREE.ConeGeometry(0.15, 0.45, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.82);
const finGeo = new THREE.BoxGeometry(0.6, 0.05, 0.25).translate(0, 0, 0.45);
const flameGeo = new THREE.ConeGeometry(0.18, 0.8, 6).rotateX(Math.PI / 2).translate(0, 0, 0.98);
const bodyMat = toon('#ff8a1f');
const noseMat = toon('#ffe14a');
const finMat = toon('#2a2c30');
const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.2, 0.5) });
/** A blinking seeker light on the nose. */
const seekMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.6, 0.3) });
const seekGeo = new THREE.SphereGeometry(0.12, 6, 4).translate(0, 0.16, -0.5);

const slickGeo = new THREE.CircleGeometry(SPECIAL.oilRadius, 24).rotateX(-Math.PI / 2);
const bubbleGeo = new THREE.SphereGeometry(3, 16, 10).scale(0.85, 0.62, 1.15);

/** Puddle texture: black gloss, a rainbow ring and a soft ragged edge. */
function slickTexture(): THREE.CanvasTexture {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n * 2 - 1;
      const dy = (y + 0.5) / n * 2 - 1;
      const a = Math.atan2(dy, dx);
      const r = Math.hypot(dx, dy) / (0.86 + 0.1 * Math.sin(a * 5) + 0.04 * Math.sin(a * 11));
      const k = (y * n + x) * 4;
      if (r > 1) continue;
      // Rainbow sheen in bands, strongest near the rim.
      const band = Math.sin(r * 14 + a * 2);
      const sheen = Math.max(0, band) * (0.25 + 0.75 * r * r);
      const hue = (r * 2.2 + a / (Math.PI * 2)) % 1;
      const col = new THREE.Color().setHSL(hue, 0.9, 0.55);
      img.data[k] = 14 + col.r * 255 * sheen * 0.8;
      img.data[k + 1] = 12 + col.g * 255 * sheen * 0.8;
      img.data[k + 2] = 20 + col.b * 255 * sheen * 0.8;
      img.data[k + 3] = r > 0.93 ? 150 : 235;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class HomingMesh {
  readonly group = new THREE.Group();
  constructor(parent: THREE.Group) {
    for (const [g, m] of [[bodyGeo, bodyMat], [noseGeo, noseMat], [finGeo, finMat], [flameGeo, flameMat], [seekGeo, seekMat]] as const) {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = m !== flameMat && m !== seekMat;
      this.group.add(mesh);
    }
    this.group.visible = false;
    parent.add(this.group);
  }
}

export class SpecialView {
  readonly group = new THREE.Group();
  private readonly homing: HomingMesh[] = [];
  private readonly slicks: THREE.Mesh[] = [];
  private readonly bubbles: THREE.Mesh[] = [];
  /** Per car: time (s) of the last blocked hit, for a flash. */
  private readonly flash: number[] = [];
  private slickTex: THREE.CanvasTexture | null = null;

  /** After a simulation step: trails behind homing missiles, flashes on blocked hits. */
  tick(world: World, p: Particles): void {
    for (const sh of world.shots) {
      if (sh.kind !== ShotKind.Homing) continue;
      const sp = Math.hypot(sh.vx, sh.vz) || 1;
      const bx = sh.x - (sh.vx / sp) * 1;
      const bz = sh.z - (sh.vz / sp) * 1;
      // Orange sparks and grey smoke that stay where they were left: the trail shows the curve.
      for (let k = 0; k < 3; k++) {
        const t = R();
        const g = 0.75 + R() * 0.15;
        p.spawn(bx - sh.vx * DT * t, sh.y + 0.75, bz - sh.vz * DT * t, (R() - 0.5) * 0.6, 0.2 + R() * 0.4, (R() - 0.5) * 0.6, 0.8 + R() * 0.5, 1.4, 5, g, g * 0.9, g * 0.85, 0, 1.5);
      }
      p.spawn(bx, sh.y + 0.75, bz, -sh.vx * 0.04, 0, -sh.vz * 0.04, 0.25, 2.2, 1, 6, 2.2, 0.3, 0, 0);
      if (sh.target >= 0) p.spawn(bx, sh.y + 0.75, bz, 0, 0.3, 0, 0.5, 1, 0.5, 6, 3.5, 0.6, 0, 0);
    }
    const ev = world.events;
    for (let k = 0; k < ev.count; k++) {
      const e = ev.list[k];
      if (e.kind === Ev.ShieldBlock) {
        this.flash[e.car] = world.tick * DT;
        // Sparks bouncing off the bubble.
        const car = world.cars[e.car];
        for (let i = 0; i < 22; i++) {
          const a = R() * Math.PI * 2;
          const s = 6 + R() * 8;
          p.spawn(car.x + Math.cos(a) * 2.6, car.y + 1, car.z + Math.sin(a) * 2.6, Math.cos(a) * s, 2 + R() * 4, Math.sin(a) * s, 0.35 + R() * 0.3, 1.6, 0.6, 1.5, 5, 6, -10, 1);
        }
      } else if (e.kind === Ev.ShieldUp) {
        const car = world.cars[e.car];
        for (let i = 0; i < 16; i++) {
          const a = R() * Math.PI * 2;
          p.spawn(car.x + Math.cos(a) * 3, car.y + 0.5 + R() * 2, car.z + Math.sin(a) * 3, -Math.cos(a) * 3, 1, -Math.sin(a) * 3, 0.5, 1.4, 0.4, 1.4, 4.5, 6, 0, 1);
        }
      } else if (e.kind === Ev.OilSlip) {
        const car = world.cars[e.car];
        for (let i = 0; i < 8; i++) {
          p.spawn(car.x + (R() - 0.5) * 2, car.y + 0.2, car.z + (R() - 0.5) * 2, car.vx * 0.2 + (R() - 0.5) * 3, 1.5 + R() * 2, car.vz * 0.2 + (R() - 0.5) * 3, 0.5, 0.8, 0.5, 0.05, 0.05, 0.08, -14, 0.5);
        }
      }
    }
  }

  /**
   * Draw the frame. `carPos(i)` is car i's drawn (interpolated) position;
   * `visible(i)` whether its model is shown.
   */
  update(world: World, alpha: number, carPos: (i: number) => THREE.Vector3, visible: (i: number) => boolean): void {
    const shots = world.shots;
    const time = (world.tick + alpha) * DT;
    while (this.homing.length < shots.length) this.homing.push(new HomingMesh(this.group));
    while (this.slicks.length < shots.length) {
      this.slickTex ??= slickTexture();
      const m = new THREE.Mesh(slickGeo, new THREE.MeshBasicMaterial({
        map: this.slickTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      m.renderOrder = 2;
      m.receiveShadow = false;
      m.visible = false;
      this.slicks.push(m);
      this.group.add(m);
    }
    for (let i = 0; i < this.homing.length; i++) {
      const s: Shot | undefined = shots[i];
      const kind = s?.kind ?? ShotKind.None;
      const h = this.homing[i].group;
      h.visible = kind === ShotKind.Homing;
      const m = this.slicks[i];
      m.visible = kind === ShotKind.Oil;
      if (kind === ShotKind.Homing) {
        const back = (1 - alpha) * DT;
        h.position.set(s.x - s.vx * back, s.y + 0.75, s.z - s.vz * back);
        h.rotation.y = -s.heading;
      } else if (kind === ShotKind.Oil) {
        m.position.set(s.x, s.y + 0.05, s.z);
        m.rotation.y = (i * 1.7) % (Math.PI * 2);
        // Spreads out over the first moment, fades over the last three seconds.
        const grow = Math.min(1, 0.35 + s.age / 20);
        m.scale.setScalar(grow);
        (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.min(1, (SPECIAL.oilLife - s.age) / 180));
      }
    }
    seekMat.color.setRGB(Math.floor(time * 8) % 2 ? 6 : 1, 0.5, 0.3);
    while (this.bubbles.length < world.cars.length) {
      const m = new THREE.Mesh(bubbleGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.35, 1.3, 1.8), transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.renderOrder = 4;
      m.visible = false;
      this.bubbles.push(m);
      this.group.add(m);
    }
    for (let i = 0; i < world.cars.length; i++) {
      const car = world.cars[i];
      const b = this.bubbles[i];
      const left = car.shieldTicks;
      // Blinks in its last second.
      b.visible = left > 0 && visible(i) && (left > 60 || Math.floor(time * 10) % 2 === 0);
      if (!b.visible) continue;
      const pos = carPos(i);
      b.position.set(pos.x, pos.y + 0.7, pos.z);
      b.rotation.y = -car.heading;
      const hit = time - (this.flash[i] ?? -10);
      const pulse = 0.5 + 0.5 * Math.sin(time * 9);
      const mat = b.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.09 + 0.05 * pulse + (hit < 0.3 ? 0.5 * (1 - hit / 0.3) : 0);
      b.scale.setScalar(1 + 0.03 * pulse + (hit < 0.3 ? 0.12 * (1 - hit / 0.3) : 0));
    }
  }
}
