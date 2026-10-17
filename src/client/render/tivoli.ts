// The fun fair around Tivoli Twist: a Ferris wheel, a carousel, a striped
// big top, a little roller coaster, a drop tower, candy and popcorn stalls
// and bunches of balloons. Built like the rest of the town (south faces get
// the detail, the camera looks north).

import * as THREE from 'three';
import { drawText } from '../ui/font.ts';
import { box, parts, type Kit } from './buildings.ts';
import { toon } from './materials.ts';

/** Bright fairground colours. */
export const FAIR = ['#e8322a', '#f2c230', '#2f6fe0', '#2fae4e', '#f07a1a', '#9a45d8', '#f28aa0', '#28c4d0'];
const STEEL = '#d8dce0';
const WHITE = '#f6f2ea';

function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const w = Math.max(48, text.length * 6 + 8);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = 12;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, 12);
  drawText(ctx, text, w / 2, 3, { color: fg, shadow: null, align: 'center' });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A sign board facing south (+z) at height y, leaning back a little toward the camera. */
function sign(text: string, bg: string, fg: string, w: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * (12 / Math.max(48, text.length * 6 + 8))), toon('#ffffff', { map: signTexture(text, bg, fg) }));
  m.position.set(0, y, z);
  m.rotation.x = -0.35;
  return m;
}

/** Alternating coloured slices of a cone (a striped tent or carousel roof). */
function stripedCone(kit: Kit, r: number, h: number, y: number, colors: [string, string], slices = 12): THREE.Group {
  const g = new THREE.Group();
  const a: THREE.BufferGeometry[] = [];
  const b: THREE.BufferGeometry[] = [];
  for (let i = 0; i < slices; i++) {
    const geo = new THREE.ConeGeometry(r, h, 2, 1, true, (i / slices) * Math.PI * 2, (Math.PI * 2) / slices).translate(0, y + h / 2, 0);
    (i % 2 === 0 ? a : b).push(geo);
  }
  g.add(parts(kit, colors[0], a), parts(kit, colors[1], b));
  return g;
}

/** The landmark: a Ferris wheel facing the camera, gondolas in every colour. */
export function ferrisWheel(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const R = 15;
  const hub = R + 3.5;
  // A-frame legs either side of the wheel.
  const legs: THREE.BufferGeometry[] = [];
  for (const z of [-1.4, 1.4]) {
    for (const x of [-8, 8]) {
      const len = Math.hypot(x, hub);
      const leg = new THREE.CylinderGeometry(0.28, 0.36, len, 6);
      leg.rotateZ(Math.atan2(x, hub));
      leg.translate(x / 2, hub / 2, z);
      legs.push(leg);
    }
  }
  legs.push(new THREE.CylinderGeometry(0.4, 0.4, 3.4, 8).rotateX(Math.PI / 2).translate(0, hub, 0));
  g.add(parts(kit, '#5d6470', legs));
  // Rim, spokes.
  const rim: THREE.BufferGeometry[] = [new THREE.TorusGeometry(R, 0.3, 6, 40).translate(0, hub, 0.9), new THREE.TorusGeometry(R, 0.3, 6, 40).translate(0, hub, -0.9)];
  const spokes = 16;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    rim.push(new THREE.CylinderGeometry(0.1, 0.1, R, 4).rotateZ(a + Math.PI / 2).translate((Math.cos(a) * R) / 2, hub + (Math.sin(a) * R) / 2, 0.9));
  }
  g.add(parts(kit, STEEL, rim));
  // Gondolas hang below the rim, each its own colour.
  for (let i = 0; i < spokes; i += 2) {
    const a = (i / spokes) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const y = hub + Math.sin(a) * R - 1.4;
    g.add(parts(kit, FAIR[(i / 2) % FAIR.length], [box(x - 1.3, y - 1.1, -1.2, x + 1.3, y + 0.8, 1.2)]));
    g.add(parts(kit, WHITE, [box(x - 1.45, y + 0.8, -1.35, x + 1.45, y + 1.05, 1.35)]));
  }
  // Lights on the rim (little bulbs) and a ticket booth.
  const bulbs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    bulbs.push(new THREE.SphereGeometry(0.22, 5, 4).translate(Math.cos(a) * R, hub + Math.sin(a) * R, 1.25));
  }
  g.add(parts(kit, '#fff2a0', bulbs));
  g.add(parts(kit, '#e8322a', [box(-1.5, 0, 3, 1.5, 2.4, 5)]));
  g.add(parts(kit, WHITE, [box(-1.7, 2.4, 2.8, 1.7, 2.7, 5.2)]));
  g.add(parts(kit, '#7a7e84', [box(-10, 0, -3, 10, 0.25, 3)]));
  return g;
}

/** A carousel: round platform, horses on poles and a striped roof. */
export function carousel(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const R = 7;
  g.add(parts(kit, '#c8a050', [new THREE.CylinderGeometry(R, R + 0.3, 0.8, 24).translate(0, 0.4, 0)]));
  g.add(parts(kit, '#f2c230', [new THREE.CylinderGeometry(1.1, 1.1, 5.5, 12).translate(0, 3.5, 0)]));
  const poles: THREE.BufferGeometry[] = [];
  const horses: THREE.BufferGeometry[][] = [[], [], []];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = R - 1.6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    poles.push(new THREE.CylinderGeometry(0.08, 0.08, 5, 4).translate(x, 3.3, z));
    const y = 2 + (i % 3) * 0.5;
    const horse = box(-0.25, y, -0.9, 0.25, y + 0.9, 0.9);
    horse.rotateY(-a);
    horse.translate(x - Math.cos(a) * 0, 0, z);
    horses[i % 3].push(horse);
  }
  g.add(parts(kit, STEEL, poles));
  g.add(parts(kit, WHITE, horses[0]), parts(kit, '#3a2a20', horses[1]), parts(kit, '#c8783a', horses[2]));
  g.add(parts(kit, '#e8322a', [new THREE.CylinderGeometry(R + 0.4, R + 0.4, 0.7, 24).translate(0, 5.9, 0)]));
  g.add(stripedCone(kit, R + 0.6, 3.6, 6.2, ['#e8322a', WHITE], 16));
  g.add(parts(kit, '#f2c230', [new THREE.SphereGeometry(0.7, 8, 6).translate(0, 10.1, 0)]));
  return g;
}

/** The circus big top: a red-and-white striped tent with flags on its poles. */
export function bigTop(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const R = 11;
  const wall = 4;
  const a: THREE.BufferGeometry[] = [];
  const b: THREE.BufferGeometry[] = [];
  const slices = 20;
  for (let i = 0; i < slices; i++) {
    const geo = new THREE.CylinderGeometry(R, R, wall, 2, 1, true, (i / slices) * Math.PI * 2, (Math.PI * 2) / slices).translate(0, wall / 2, 0);
    (i % 2 === 0 ? a : b).push(geo);
  }
  g.add(parts(kit, '#e8322a', a), parts(kit, WHITE, b));
  g.add(stripedCone(kit, R + 0.8, 7, wall, ['#e8322a', '#f2c230'], 20));
  // Main pole and flag, entrance flaps facing the camera.
  g.add(parts(kit, STEEL, [new THREE.CylinderGeometry(0.15, 0.15, 4, 5).translate(0, wall + 8.5, 0)]));
  g.add(parts(kit, '#2f6fe0', [box(0, wall + 9.4, -0.05, 2.2, wall + 10.6, 0.05)]));
  g.add(parts(kit, '#2a1a10', [box(-2, 0, R - 0.2, 2, 3.4, R + 0.2)]));
  g.add(sign('CIRKUS', '#2f6fe0', '#ffd84a', 7, wall + 1.2, R + 0.8));
  return g;
}

/** A little roller coaster: a wavy track on stilts with a train of cars. */
export function rollerCoaster(kit: Kit, len: number): THREE.Group {
  const g = new THREE.Group();
  const rails: THREE.BufferGeometry[] = [];
  const stilts: THREE.BufferGeometry[] = [];
  const height = (x: number) => 4 + 3.2 * Math.sin((x / len) * Math.PI * 3) + 2 * Math.sin((x / len) * Math.PI * 7);
  const step = 2;
  for (let x = -len / 2; x < len / 2; x += step) {
    const y0 = height(x + len / 2);
    const y1 = height(x + step + len / 2);
    const seg = Math.hypot(step, y1 - y0);
    for (const z of [-0.7, 0.7]) {
      const r = new THREE.CylinderGeometry(0.12, 0.12, seg, 4).rotateZ(Math.atan2(y1 - y0, step) - Math.PI / 2);
      r.translate(x + step / 2, (y0 + y1) / 2, z);
      rails.push(r);
    }
    if (Math.round(x / step) % 2 === 0) {
      stilts.push(new THREE.CylinderGeometry(0.14, 0.18, y0, 4).translate(x, y0 / 2, -0.7), new THREE.CylinderGeometry(0.14, 0.18, y0, 4).translate(x, y0 / 2, 0.7));
    }
  }
  g.add(parts(kit, '#e8322a', rails), parts(kit, '#f6f2ea', stilts));
  // The train near the top of the first hill.
  const cars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const x = -len / 2 + len / 6 + i * 2.2;
    const y = height(x + len / 2);
    cars.push(box(x - 0.9, y + 0.2, -0.9, x + 0.9, y + 1.2, 0.9));
  }
  g.add(parts(kit, '#2f6fe0', cars));
  return g;
}

/** A drop tower: a tall mast with a ring of seats part way up. */
export function dropTower(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const h = 30;
  g.add(parts(kit, STEEL, [new THREE.CylinderGeometry(0.9, 1.1, h, 8).translate(0, h / 2, 0)]));
  g.add(parts(kit, '#e8322a', [new THREE.CylinderGeometry(1.4, 1.4, 1.6, 8).translate(0, h + 0.8, 0)]));
  g.add(parts(kit, '#f2c230', [new THREE.TorusGeometry(2.6, 0.6, 6, 16).rotateX(Math.PI / 2).translate(0, h * 0.62, 0)]));
  g.add(parts(kit, '#9a45d8', [new THREE.CylinderGeometry(3.2, 3.6, 1, 12).translate(0, 0.5, 0)]));
  g.add(sign('FRITT FALL', '#9a45d8', '#ffffff', 6, 3, 3.8));
  return g;
}

/** A sweet stall: a booth with a striped awning and what it sells on a sign. */
export function stall(kit: Kit, color: string): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const w = 4 + Math.floor(rnd() * 2) * 1.5;
  const d = 3;
  g.add(parts(kit, WHITE, [box(-w / 2, 0, -d / 2, w / 2, 2.4, d / 2)]));
  g.add(parts(kit, color, [box(-w / 2, 0, d / 2, w / 2, 1.1, d / 2 + 0.6)]));
  // Awning stripes sloping toward the camera.
  const a: THREE.BufferGeometry[] = [];
  const b: THREE.BufferGeometry[] = [];
  const n = Math.round(w / 0.7);
  for (let i = 0; i < n; i++) {
    const s = box(-w / 2 + (i * w) / n, 0, -0.05, -w / 2 + ((i + 1) * w) / n, 0.08, 1.6);
    s.rotateX(0.35).translate(0, 2.9, d / 2 - 0.2);
    (i % 2 === 0 ? a : b).push(s);
  }
  g.add(parts(kit, color, a), parts(kit, WHITE, b));
  const goods = ['POPCORN', 'SOCKERVADD', 'GODIS', 'LOTTERI', 'KORV', 'GLASS', 'CHURROS', 'SKJUTBANA'];
  g.add(sign(goods[Math.floor(rnd() * goods.length)], color, '#ffffff', w, 3.6, d / 2 - 0.4));
  return g;
}

/** A bunch of balloons on strings above a little cart. */
export function balloons(kit: Kit): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  g.add(parts(kit, '#f6f2ea', [box(-0.7, 0, -0.5, 0.7, 1, 0.5)]));
  const strings: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const x = (rnd() - 0.5) * 2.4;
    const z = (rnd() - 0.5) * 1.6;
    const y = 4.2 + rnd() * 1.8;
    g.add(parts(kit, FAIR[i % FAIR.length], [new THREE.SphereGeometry(0.55, 8, 6).scale(1, 1.2, 1).translate(x, y, z)]));
    strings.push(new THREE.CylinderGeometry(0.03, 0.03, y - 1, 3).translate(x * 0.5, (y + 1) / 2, z * 0.5));
  }
  g.add(parts(kit, '#e8e8e8', strings));
  return g;
}
