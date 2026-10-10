// Missiles and mines on the track: a small pool of meshes following the
// simulation's shot slots, interpolated between ticks.

import * as THREE from 'three';
import { DT } from '../../shared/config/constants.ts';
import { ShotKind, WEAPON, type Shot } from '../../shared/sim/weapons.ts';
import { toon } from './materials.ts';

const missileGeo = new THREE.CylinderGeometry(0.13, 0.13, 1.1, 6).rotateX(Math.PI / 2);
const noseGeo = new THREE.ConeGeometry(0.13, 0.35, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.72);
const finGeo = new THREE.BoxGeometry(0.5, 0.04, 0.22).translate(0, 0, 0.45);
const flameGeo = new THREE.ConeGeometry(0.16, 0.7, 6).rotateX(Math.PI / 2).translate(0, 0, 0.9);
const mineGeo = new THREE.CylinderGeometry(0.55, 0.62, 0.22, 10).translate(0, 0.11, 0);
const studGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.12, 6).translate(0, 0.28, 0);

const missileMat = toon('#e8e6e0');
const noseMat = toon('#d42a24');
const finMat = toon('#333840');
const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 0.6) });
const mineMat = toon('#2a2c30');

class ShotMesh {
  readonly missile = new THREE.Group();
  readonly mine = new THREE.Group();
  readonly light: THREE.MeshBasicMaterial;
  constructor(parent: THREE.Group) {
    for (const [g, m] of [[missileGeo, missileMat], [noseGeo, noseMat], [finGeo, finMat], [flameGeo, flameMat]] as const) {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = m !== flameMat;
      this.missile.add(mesh);
    }
    const body = new THREE.Mesh(mineGeo, mineMat);
    body.castShadow = true;
    body.receiveShadow = true;
    this.light = new THREE.MeshBasicMaterial({ color: '#400' });
    this.mine.add(body, new THREE.Mesh(studGeo, this.light));
    this.missile.visible = this.mine.visible = false;
    parent.add(this.missile, this.mine);
  }
}

export class ShotView {
  readonly group = new THREE.Group();
  private readonly meshes: ShotMesh[] = [];

  update(shots: readonly Shot[], alpha: number, tick: number): void {
    while (this.meshes.length < shots.length) this.meshes.push(new ShotMesh(this.group));
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      const s = shots[i];
      const kind = s?.kind ?? ShotKind.None;
      m.missile.visible = kind === ShotKind.Missile;
      m.mine.visible = kind === ShotKind.Mine;
      if (kind === ShotKind.Missile) {
        // The simulation position is one tick ahead of what we draw.
        const back = (1 - alpha) * DT;
        m.missile.position.set(s.x - s.vx * back, 0.75, s.z - s.vz * back);
        m.missile.rotation.y = -s.heading;
      } else if (kind === ShotKind.Mine) {
        m.mine.position.set(s.x, 0, s.z);
        m.mine.rotation.y = s.heading;
        const armed = s.age >= WEAPON.mineArm;
        const blink = armed ? Math.floor((tick + i * 7) / 20) % 2 === 0 : false;
        m.light.color.setRGB(blink ? 6 : 0.3, blink ? 0.4 : 0.04, blink ? 0.2 : 0.02);
      }
    }
  }
}
