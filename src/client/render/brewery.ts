// Beer country around Brewery Bash: a brick brewhouse with copper kettles,
// malt silos, beer-festival tents in blue and white, stacks of barrels, hop
// gardens on tall poles, tanker trucks and a giant foaming beer mug. Built
// like the rest of the town (south faces get the detail).

import * as THREE from 'three';
import { drawText } from '../ui/font.ts';
import { box, gableRoof, parts, type Kit } from './buildings.ts';
import { toon } from './materials.ts';

const COPPER = '#c8783a';
const COPPER_DARK = '#9a5428';
const BRICK = '#a8462e';
const OAK = '#8a5a32';
const HOOP = '#3a3632';

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

/** A sign board facing south (+z) at height y. */
function sign(text: string, bg: string, fg: string, w: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * (12 / Math.max(48, text.length * 6 + 8))), toon('#ffffff', { map: signTexture(text, bg, fg) }));
  m.position.set(0, y, z);
  return m;
}

/** A copper brew kettle: drum, domed top and a chimney pipe. */
function kettle(kit: Kit, x: number, z: number, r: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(parts(kit, COPPER, [new THREE.CylinderGeometry(r, r, h, 16).translate(x, h / 2, z)]));
  g.add(parts(kit, COPPER_DARK, [
    new THREE.SphereGeometry(r, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, h, z),
    new THREE.TorusGeometry(r + 0.05, 0.12, 4, 16).rotateX(Math.PI / 2).translate(x, h * 0.35, z),
  ]));
  g.add(parts(kit, COPPER, [new THREE.CylinderGeometry(0.35, 0.35, r * 1.6, 8).translate(x, h + r + r * 0.6, z)]));
  return g;
}

/** The brewhouse: a brick hall with a tall chimney, kettles out front and its name on top. */
export function brewhouse(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const w = 26;
  const d = 14;
  const h = 10;
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), kit.wall(BRICK)));
  g.add(new THREE.Mesh(gableRoof(w, d, h, 2.2, 0.6), kit.plain('#3a4a3a')));
  // Arched gate and white trim on the south face.
  g.add(parts(kit, '#f2e6c8', [box(-w / 2, h - 0.5, d / 2, w / 2, h, d / 2 + 0.1), box(-3, 0, d / 2, 3, 5.2, d / 2 + 0.08)]));
  g.add(parts(kit, '#4a2e1e', [box(-2.5, 0, d / 2 + 0.08, 2.5, 4.6, d / 2 + 0.12)]));
  // Chimney.
  g.add(parts(kit, BRICK, [box(w / 2 - 4, 0, -d / 2 + 1, w / 2 - 1.6, h + 14, -d / 2 + 3.4)]));
  g.add(parts(kit, '#f2e6c8', [box(w / 2 - 4.2, h + 12, -d / 2 + 0.8, w / 2 - 1.4, h + 13, -d / 2 + 3.6)]));
  // Copper kettles in front, under a glass roof.
  for (let i = 0; i < 4; i++) g.add(kettle(kit, -w / 2 + 3.5 + i * 6.2, d / 2 + 5, 2.6, 5.6));
  // A big board on the roof, leaning back toward the camera.
  const board = sign('MEGA BRYGG', '#2a1a10', '#ffd84a', 20, h + 5, 0);
  board.rotation.x = -0.6;
  g.add(board);
  g.add(parts(kit, '#3a3632', [box(-8, h, -0.6, -7.6, h + 4.4, -0.2), box(7.6, h, -0.6, 8, h + 4.4, -0.2)]));
  return g;
}

/** Malt silos: three tall grey cylinders on a frame, with a conveyor. */
export function maltSilos(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 4.6;
    g.add(parts(kit, '#d8d4c8', [new THREE.CylinderGeometry(2.1, 2.1, 14, 14).translate(x, 9, 0)]));
    g.add(parts(kit, '#9aa0a6', [new THREE.ConeGeometry(2.1, 2, 14).rotateX(Math.PI).translate(x, 1, 0)]));
    g.add(parts(kit, '#7a7e84', [new THREE.ConeGeometry(2.2, 1.6, 14).translate(x, 16.8, 0)]));
  }
  g.add(parts(kit, '#5a5e64', [box(-7.5, 0, -1.5, -7, 2, 1.5), box(7, 0, -1.5, 7.5, 2, 1.5), box(-7.5, 2, -1.5, 7.5, 2.4, 1.5)]));
  const belt = box(-0.6, 0, -0.6, 0.6, 1, 13);
  belt.rotateX(0.55);
  belt.translate(4.6, 6, 1);
  g.add(parts(kit, '#6a6e74', [belt]));
  return g;
}

/** A beer-festival tent: white walls, a blue-and-white striped roof, benches out front. */
export function beerTent(kit: Kit): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const w = 20 + Math.floor(rnd() * 3) * 4;
  const d = 12;
  g.add(parts(kit, '#f4f2ea', [box(-w / 2, 0, -d / 2, w / 2, 3.4, d / 2)]));
  // Roof stripes along x.
  const blue: THREE.BufferGeometry[] = [];
  const white: THREE.BufferGeometry[] = [];
  const n = Math.round(w / 2);
  for (let i = 0; i < n; i++) {
    const roof = gableRoof(w / n, d, 3.4, 3.2, 0.5);
    roof.translate(-w / 2 + (i + 0.5) * (w / n), 0, 0);
    (i % 2 === 0 ? blue : white).push(roof);
  }
  g.add(parts(kit, '#2f6fe0', blue), parts(kit, '#f4f2ea', white));
  // Entrance with a garland, and long tables outside.
  g.add(parts(kit, '#6a4a2e', [box(-2, 0, d / 2, 2, 2.8, d / 2 + 0.06)]));
  g.add(parts(kit, '#2f8a4a', [box(-w / 2, 3.2, d / 2 + 0.05, w / 2, 3.5, d / 2 + 0.2)]));
  const tables: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + 3 + i * ((w - 6) / 2);
    tables.push(box(x - 2.4, 0.7, d / 2 + 2.4, x + 2.4, 0.85, d / 2 + 3.2));
    tables.push(box(x - 2.4, 0.4, d / 2 + 1.7, x + 2.4, 0.5, d / 2 + 2.0), box(x - 2.4, 0.4, d / 2 + 3.6, x + 2.4, 0.5, d / 2 + 3.9));
  }
  g.add(parts(kit, OAK, tables));
  g.add(sign(rnd() < 0.5 ? 'BIERHALLE' : 'ÖLTÄLT', '#2f6fe0', '#ffffff', 7, 6.2, d / 2 + 0.6));
  return g;
}

/** A barrel lying on its side along x. */
function barrel(x: number, y: number, z: number, wood: THREE.BufferGeometry[], hoops: THREE.BufferGeometry[]): void {
  wood.push(new THREE.CylinderGeometry(0.62, 0.62, 1.5, 10).rotateZ(Math.PI / 2).translate(x, y, z));
  for (const dx of [-0.5, 0.5]) hoops.push(new THREE.CylinderGeometry(0.66, 0.66, 0.12, 10).rotateZ(Math.PI / 2).translate(x + dx, y, z));
}

/** Barrels stacked in a pyramid on a pallet. */
export function barrelStack(kit: Kit): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const wood: THREE.BufferGeometry[] = [];
  const hoops: THREE.BufferGeometry[] = [];
  const base = 3 + Math.floor(rnd() * 2);
  for (let row = 0; row < base; row++) {
    for (let i = 0; i < base - row; i++) {
      for (const x of [-0.8, 0.8]) barrel(x, 0.62 + row * 1.1, (i - (base - row - 1) / 2) * 1.26, wood, hoops);
    }
  }
  g.add(parts(kit, OAK, wood), parts(kit, HOOP, hoops));
  g.add(parts(kit, '#b8a07a', [box(-1.8, 0, -base * 0.7, 1.8, 0.05, base * 0.7)]));
  g.rotation.y = Math.PI / 2;
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}

/** The landmark: a beer mug as tall as a house, foam spilling over. */
export function giantMug(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const r = 4;
  const h = 11;
  g.add(parts(kit, '#e8a020', [new THREE.CylinderGeometry(r, r * 0.92, h, 18).translate(0, h / 2 + 1, 0)]));
  // Glass base and rim.
  g.add(parts(kit, '#d8e8ee', [
    new THREE.CylinderGeometry(r * 1.02, r * 1.02, 1, 18).translate(0, 0.5, 0),
    new THREE.TorusGeometry(r * 0.78, 0.7, 6, 14, Math.PI).rotateZ(-Math.PI / 2).translate(r + 0.2, h / 2 + 1, 0),
  ]));
  // Foam: a crown of blobs and drips down the side.
  const foam: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(r * 1.05, r * 1.02, 1.4, 18).translate(0, h + 1.5, 0)];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    foam.push(new THREE.SphereGeometry(1.5, 8, 6).translate(Math.cos(a) * r * 0.7, h + 2.4, Math.sin(a) * r * 0.7));
  }
  foam.push(new THREE.SphereGeometry(2, 8, 6).translate(0, h + 3, 0));
  for (const a of [0.4, 1.9, 3.6]) foam.push(new THREE.CapsuleGeometry(0.55, 2.2, 2, 6).translate(Math.cos(a) * r, h - 0.4, Math.sin(a) * r));
  g.add(parts(kit, '#fbf6e8', foam));
  // Bubbles.
  const bubbles: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const a = i * 2.4;
    bubbles.push(new THREE.SphereGeometry(0.28, 6, 4).translate(Math.cos(a) * (r + 0.02), 2.5 + ((i * 3.7) % (h - 3)), Math.sin(a) * (r + 0.02)));
  }
  g.add(parts(kit, '#f8d878', bubbles));
  g.add(parts(kit, '#7a7e84', [box(-5, 0, -5, 5, 0.3, 5)]));
  return g;
}

/** A hop garden: rows of tall poles with green bines climbing strings. */
export function hopGarden(kit: Kit, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const poles: THREE.BufferGeometry[] = [];
  const bines: THREE.BufferGeometry[] = [];
  const cones: THREE.BufferGeometry[] = [];
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 4) {
    for (let z = -d / 2; z <= d / 2 + 0.01; z += 3) {
      poles.push(new THREE.CylinderGeometry(0.1, 0.12, 6.5, 4).translate(x, 3.25, z));
      if (x < w / 2 - 0.01) {
        bines.push(new THREE.CylinderGeometry(0.45, 0.25, 5, 5).translate(x + 2, 2.6, z));
        cones.push(new THREE.SphereGeometry(0.55, 5, 4).translate(x + 2, 4.9, z));
      }
    }
  }
  const wires: THREE.BufferGeometry[] = [];
  for (let z = -d / 2; z <= d / 2 + 0.01; z += 3) wires.push(box(-w / 2, 6.4, z - 0.03, w / 2, 6.45, z + 0.03));
  g.add(parts(kit, '#7a5a3a', poles), parts(kit, '#3c8a34', bines), parts(kit, '#9ac850', cones), parts(kit, '#5a5e64', wires));
  const soil = parts(kit, '#6a5a3a', [new THREE.PlaneGeometry(w + 2, d + 2).rotateX(-Math.PI / 2).translate(0, 0.012, 0)]);
  soil.userData.decal = true;
  g.add(soil);
  return g;
}

/** A beer tanker truck: cab and a shiny tank with the brewery's colours. */
export function beerTruck(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  g.add(parts(kit, '#c8261f', [box(-1.2, 0.6, 3.2, 1.2, 3, 5.4)]));
  g.add(parts(kit, '#2a3446', [box(-1.1, 2, 5.4, 1.1, 2.8, 5.46)]));
  g.add(parts(kit, '#d8dce0', [new THREE.CylinderGeometry(1.3, 1.3, 6.6, 12).rotateX(Math.PI / 2).translate(0, 2.1, -0.4)]));
  g.add(parts(kit, '#e8a020', [new THREE.CylinderGeometry(1.33, 1.33, 2.2, 12).rotateX(Math.PI / 2).translate(0, 2.1, -0.4)]));
  g.add(parts(kit, '#1c1d22', [box(-1.3, 0, 3.6, 1.3, 0.9, 4.8), box(-1.3, 0, -3, 1.3, 0.9, -1.2), box(-1, 0.5, -3.8, 1, 0.8, 3.2)]));
  return g;
}

/** A pub with a hanging sign: gabled, half-timbered front. */
export function pub(kit: Kit, color: string): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const w = 10 + rnd() * 3;
  const d = 8;
  const h = 6.4;
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), kit.wall(color)));
  g.add(new THREE.Mesh(gableRoof(w, d, h, 3, 0.5), kit.plain('#5a3a2a')));
  g.add(parts(kit, '#4a2e1e', [
    box(-w / 2, 3.1, d / 2, w / 2, 3.4, d / 2 + 0.06),
    box(-w / 2, 0, d / 2, -w / 2 + 0.3, h, d / 2 + 0.06), box(w / 2 - 0.3, 0, d / 2, w / 2, h, d / 2 + 0.06),
    box(-1, 0, d / 2, 1, 2.6, d / 2 + 0.08),
  ]));
  const names = ['THE FROTHY', 'HOPS INN', 'OLD BARREL', 'PUB', 'KROG'];
  g.add(sign(names[Math.floor(rnd() * names.length)], '#2a1a10', '#f2c230', 6, h - 1.4, d / 2 + 0.12));
  g.add(barrelStack(kit).translateX(w / 2 + 2).translateZ(d / 2 - 1));
  return g;
}
