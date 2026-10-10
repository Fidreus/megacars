// Procedural low-poly sports car. The body is an extruded side profile; the
// roof carries the car colour so cars read clearly from above.

import * as THREE from 'three';
import { toon } from './materials.ts';

const BODY_W = 1.86;

function extrudeProfile(points: [number, number][], width: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  // Profile x (length, front = negative) becomes local z (forward = -z).
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

let shared: {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  wing: THREE.BufferGeometry;
  post: THREE.BufferGeometry;
  lamp: THREE.BufferGeometry;
  stripe: THREE.BufferGeometry;
} | null = null;

function geometries() {
  if (shared) return shared;
  const wheel = new THREE.CylinderGeometry(0.37, 0.37, 0.32, 10);
  wheel.rotateZ(Math.PI / 2);
  shared = {
    body: extrudeProfile(
      [
        [-2.25, 0.26], [2.25, 0.26], [2.25, 0.62], [2.18, 0.84], [1.55, 0.88],
        [-0.72, 0.8], [-2.0, 0.66], [-2.25, 0.55],
      ],
      BODY_W,
    ),
    cabin: extrudeProfile([[-0.72, 0.79], [1.5, 0.87], [0.9, 1.22], [-0.12, 1.22]], 1.52),
    roof: new THREE.BoxGeometry(1.42, 0.06, 0.96).translate(0, 1.24, 0.38),
    wheel,
    wing: new THREE.BoxGeometry(1.8, 0.07, 0.42).translate(0, 1.08, 2.02),
    post: new THREE.BoxGeometry(0.08, 0.22, 0.12),
    lamp: new THREE.BoxGeometry(0.44, 0.14, 0.06),
    stripe: new THREE.BoxGeometry(0.34, 0.02, 1.25).translate(0, 0.79, -1.35),
  };
  return shared;
}

const glass = toon('#16202e');
const tyre = toon('#1b1b1e');
const headlight = new THREE.MeshBasicMaterial({ color: '#fff3c4' });
const taillight = new THREE.MeshBasicMaterial({ color: '#ff2b1c' });
const stripeMat = toon('#f2f2ea');

export class CarView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly frontPivots: THREE.Object3D[] = [];
  private roll = 0;
  private pitch = 0;

  constructor(color: string) {
    const g = geometries();
    const paint = toon(color);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.body) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    add(g.body, paint);
    add(g.cabin, glass);
    add(g.roof, paint);
    add(g.wing, paint);
    add(g.stripe, stripeMat);
    for (const x of [-0.7, 0.7]) {
      const post = add(g.post, tyre);
      post.position.set(x, 0.95, 2.02);
    }
    for (const x of [-0.6, 0.6]) {
      add(g.lamp, headlight).position.set(x, 0.52, -2.26);
      add(g.lamp, taillight).position.set(x, 0.6, 2.26);
    }
    for (const [x, z, front] of [
      [-0.97, -1.38, true], [0.97, -1.38, true], [-0.97, 1.42, false], [0.97, 1.42, false],
    ] as const) {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, 0.37, z);
      add(g.wheel, tyre, pivot);
      this.root.add(pivot);
      if (front) this.frontPivots.push(pivot);
    }
    this.root.add(this.body);
  }

  /** Place the car; accelerations drive the body roll and pitch. */
  update(x: number, y: number, z: number, heading: number, steer: number, latAccel: number, longAccel: number, dt: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = -heading;
    const targetRoll = Math.max(-0.11, Math.min(0.11, latAccel * 0.006));
    const targetPitch = Math.max(-0.07, Math.min(0.07, longAccel * 0.004));
    const k = 1 - Math.exp(-9 * dt);
    this.roll += (targetRoll - this.roll) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
    for (const p of this.frontPivots) p.rotation.y = -steer * 0.45;
  }
}
