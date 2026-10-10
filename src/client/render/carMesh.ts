// Procedural low-poly cars in three body styles. The roof carries the car
// colour and a race number so cars read clearly from above. Lights are
// unlit HDR materials so they bloom; at night headlights throw a cone of
// light onto the road.

import * as THREE from 'three';
import { toon } from './materials.ts';
import { drawText } from '../ui/font.ts';

type Profile = [number, number][];

interface Style {
  body: Profile;
  cabin: Profile;
  cabinWidth: number;
  roof: [number, number, number, number]; // width, z-centre, length, height
  wing: boolean;
  scoop: boolean;
}

// Side profiles: x = along the car (front negative), y = height.
const STYLES: Style[] = [
  {
    // Wedge supercar.
    body: [[-2.3, 0.24], [2.25, 0.24], [2.25, 0.66], [2.15, 0.86], [1.5, 0.9], [-0.6, 0.78], [-2.05, 0.6], [-2.3, 0.48]],
    cabin: [[-0.6, 0.77], [1.5, 0.89], [0.95, 1.18], [-0.05, 1.18]],
    cabinWidth: 1.5,
    roof: [1.4, 0.43, 0.94, 1.2],
    wing: true,
    scoop: false,
  },
  {
    // Rounded GT.
    body: [[-2.25, 0.26], [2.3, 0.26], [2.3, 0.7], [2.0, 0.86], [1.25, 0.9], [-0.8, 0.82], [-1.9, 0.72], [-2.25, 0.56]],
    cabin: [[-0.8, 0.81], [1.3, 0.89], [0.75, 1.28], [-0.25, 1.28]],
    cabinWidth: 1.54,
    roof: [1.44, 0.25, 0.94, 1.3],
    wing: false,
    scoop: false,
  },
  {
    // Muscle car with a long bonnet and a scoop.
    body: [[-2.35, 0.28], [2.3, 0.28], [2.3, 0.74], [2.2, 0.86], [0.7, 0.88], [-2.1, 0.82], [-2.35, 0.66]],
    cabin: [[-0.25, 0.87], [1.65, 0.87], [1.25, 1.26], [0.2, 1.26]],
    cabinWidth: 1.56,
    roof: [1.48, 0.73, 1.0, 1.28],
    wing: true,
    scoop: true,
  },
];

const BODY_W = 1.86;

function extrudeProfile(points: Profile, width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  // Profile x (length, front = negative) becomes local z (forward = -z).
  geo.rotateY(-Math.PI / 2);
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  return geo;
}

const styleGeoCache = new Map<number, { body: THREE.BufferGeometry; cabin: THREE.BufferGeometry }>();
function styleGeometry(i: number) {
  let g = styleGeoCache.get(i);
  if (!g) {
    const st = STYLES[i];
    g = { body: extrudeProfile(st.body, BODY_W), cabin: extrudeProfile(st.cabin, st.cabinWidth) };
    styleGeoCache.set(i, g);
  }
  return g;
}

const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.32, 10).rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 6).rotateZ(Math.PI / 2);
const lampGeo = new THREE.BoxGeometry(0.44, 0.14, 0.06);
const exhaustGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 6).rotateX(Math.PI / 2);
const glass = toon('#16202e');
const tyre = toon('#1b1b1e');
const hub = toon('#9aa0a8');
const dark = toon('#26262a');

let coneTexture: THREE.CanvasTexture | null = null;
function headlightCone(): THREE.CanvasTexture {
  if (coneTexture) return coneTexture;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    const v = y / (S - 1); // 0 = at the car, 1 = far end
    for (let x = 0; x < S; x++) {
      const u = (x / (S - 1)) * 2 - 1;
      const halfWidth = 0.22 + 0.78 * v;
      const across = Math.max(0, 1 - Math.abs(u) / halfWidth);
      const along = Math.min(1, v * 6) * (1 - v) ** 1.3;
      const a = Math.min(1, across ** 0.7 * along * 1.4);
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(a * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  coneTexture = new THREE.CanvasTexture(c);
  coneTexture.colorSpace = THREE.NoColorSpace;
  return coneTexture;
}

function numberTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f4ee';
  ctx.beginPath();
  ctx.arc(8, 8, 7.5, 0, Math.PI * 2);
  ctx.fill();
  drawText(ctx, String(n), 8.5, 4.5, { color: '#111', shadow: null, align: 'center' });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CarView {
  readonly root = new THREE.Group();
  /** Exhaust position in car space (for backfire particles). */
  readonly exhaust = new THREE.Vector3(0.55, 0.42, 2.3);
  private readonly body = new THREE.Group();
  private readonly frontPivots: THREE.Object3D[] = [];
  private readonly headMat = new THREE.MeshBasicMaterial({ color: '#fff3c4' });
  private readonly tailMat = new THREE.MeshBasicMaterial({ color: '#ff2b1c' });
  private readonly cone: THREE.Mesh;
  private lightsOn = false;
  private roll = 0;
  private pitch = 0;

  constructor(color: string, number: number, style = number % STYLES.length) {
    const st = STYLES[style];
    const g = styleGeometry(style);
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
    const [rw, rz, rl, rh] = st.roof;
    add(new THREE.BoxGeometry(rw, 0.06, rl), paint).position.set(0, rh + 0.02, rz);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78), new THREE.MeshToonMaterial({ map: numberTexture(number), transparent: true, alphaTest: 0.5 }));
    num.rotation.x = -Math.PI / 2;
    num.position.set(0, rh + 0.06, rz);
    this.body.add(num);
    if (st.wing) {
      add(new THREE.BoxGeometry(1.8, 0.07, 0.42), paint).position.set(0, 1.08, 2.0);
      for (const x of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.08, 0.22, 0.12), dark).position.set(x, 0.95, 2.0);
    }
    if (st.scoop) add(new THREE.BoxGeometry(0.6, 0.14, 0.9), dark).position.set(0, 0.9, -1.1);
    // Bonnet stripe.
    add(new THREE.BoxGeometry(0.34, 0.02, 1.0), toon('#f2f2ea')).position.set(0, st.body[st.body.length - 2][1] + 0.01, -1.6);
    for (const x of [-0.6, 0.6]) {
      add(lampGeo, this.headMat).position.set(x, 0.5, -2.31);
      add(lampGeo, this.tailMat).position.set(x, 0.58, 2.26);
    }
    for (const x of [-0.55, 0.55]) add(exhaustGeo, dark).position.set(x, 0.36, 2.3);
    for (const [x, z, front] of [
      [-0.97, -1.38, true], [0.97, -1.38, true], [-0.97, 1.42, false], [0.97, 1.42, false],
    ] as const) {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, 0.37, z);
      add(wheelGeo, tyre, pivot);
      add(hubGeo, hub, pivot);
      this.root.add(pivot);
      if (front) this.frontPivots.push(pivot);
    }
    this.root.add(this.body);

    const coneMat = new THREE.MeshBasicMaterial({
      map: headlightCone(),
      color: new THREE.Color(0.75, 0.68, 0.5),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.cone = new THREE.Mesh(new THREE.PlaneGeometry(10, 16), coneMat);
    this.cone.rotation.x = -Math.PI / 2;
    this.cone.rotation.z = Math.PI; // texture v=0 at the car
    this.cone.position.set(0, 0.04, -10.2);
    this.cone.renderOrder = 2;
    this.cone.visible = false;
    this.root.add(this.cone);
  }

  setLights(on: boolean, strength = 1): void {
    this.lightsOn = on;
    this.cone.visible = on && strength > 0;
    (this.cone.material as THREE.MeshBasicMaterial).color.setRGB(0.85 * strength, 0.77 * strength, 0.57 * strength);
    this.headMat.color.setRGB(on ? 4 : 1, on ? 3.7 : 0.95, on ? 2.8 : 0.75);
  }

  /** Place the car; accelerations drive the body roll and pitch. */
  update(
    x: number, y: number, z: number, heading: number, steer: number,
    latAccel: number, longAccel: number, braking: boolean, dt: number,
  ): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = -heading;
    const targetRoll = Math.max(-0.11, Math.min(0.11, latAccel * 0.006));
    const targetPitch = Math.max(-0.07, Math.min(0.07, longAccel * 0.004));
    const k = 1 - Math.exp(-9 * dt);
    this.roll += (targetRoll - this.roll) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
    for (const p of this.frontPivots) p.rotation.y = -steer * 0.45;
    const tail = braking ? 5 : this.lightsOn ? 2.2 : 0.9;
    this.tailMat.color.setRGB(tail, tail * 0.1, tail * 0.06);
  }
}
