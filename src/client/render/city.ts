// Midtown around Manhattan Sprint: art-deco skyscrapers with setback crowns,
// brick walk-ups with fire escapes and rooftop water tanks, big billboards,
// yellow cabs, subway entrances and hot-dog carts. Built like the rest of the
// town (south faces get the detail, the camera looks north).

import * as THREE from 'three';
import { drawText } from '../ui/font.ts';
import { box, decal, parts, tree, windowBox, shade, type Kit } from './buildings.ts';
import { toon } from './materials.ts';

/** Brick and stone colours for the blocks along the street. */
export const CITY = ['#b8a890', '#c8c0b0', '#8a4a3a', '#9a5a44', '#7f9ab0', '#a8a29a', '#c8b89a', '#6f8fa8'];
const BRICK = ['#8a4a3a', '#9a5a44', '#7a4030', '#a86048', '#b06a4a'];
const STONE = '#d8d0bc';
const IRON = '#2a2c30';
const STEEL = '#d8dce0';
const GREEN = '#2f6a4a';
const BEACON = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.35, 0.25) });
const FLAME = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.5) });

function boardTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = fg;
  g.fillRect(0, 0, 128, 2);
  g.fillRect(0, 30, 128, 2);
  drawText(g, text, 64, 11, { color: fg, shadow: null, align: 'center', scale: 2 });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A billboard facing the camera (south), on two steel posts with a catwalk. */
export function cityBillboard(kit: Kit): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  g.name = 'billboard';
  const texts: [string, string, string][] = [
    ['MEGA COLA', '#1d3c8f', '#ffffff'],
    ['BIG APPLE', '#c8261f', '#ffd84a'],
    ['MIDTOWN 24H', '#111111', '#f2c230'],
    ['BROADWAY', '#f4f0e6', '#c8261f'],
    ['PIXEL PIZZA', '#2f8a4a', '#ffffff'],
  ];
  const [text, bg, fg] = texts[Math.floor(rnd() * texts.length)];
  const w = 22;
  const h = 7;
  const y = 13;
  g.add(parts(kit, '#55585e', [box(-w / 2, 0, -1.2, -w / 2 + 0.5, y, -0.7), box(w / 2 - 0.5, 0, -1.2, w / 2, y, -0.7)]));
  // Board with a steel frame, tilted back a little toward the high camera.
  const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), toon('#ffffff', { map: boardTexture(text, bg, fg) }));
  board.position.set(0, y + h / 2, 0.2);
  board.rotation.x = -0.12;
  g.add(board);
  const frame: THREE.BufferGeometry[] = [];
  for (const [x0, y0, x1, y1] of [[-w / 2 - 0.5, y - 0.5, w / 2 + 0.5, y], [-w / 2 - 0.5, y + h, w / 2 + 0.5, y + h + 0.5], [-w / 2 - 0.5, y - 0.5, -w / 2, y + h + 0.5], [w / 2, y - 0.5, w / 2 + 0.5, y + h + 0.5]]) {
    frame.push(box(x0, y0, -0.1, x1, y1, 0.35));
  }
  g.add(parts(kit, STEEL, frame));
  // Catwalk and little spotlights under the board.
  g.add(parts(kit, '#6a6e74', [box(-w / 2, y - 1.1, 0.3, w / 2, y - 0.9, 1.4)]));
  const lamps: THREE.BufferGeometry[] = [];
  for (let x = -w / 2 + 2; x < w / 2; x += 3) lamps.push(box(x - 0.18, y - 1.5, 0.9, x + 0.18, y - 1.1, 1.2));
  g.add(parts(kit, '#f2e6b0', lamps));
  return g;
}

/** An art-deco skyscraper: stepped setbacks, stone ledges and a lit spire. */
export function skyscraper(kit: Kit, height = 46): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  g.name = 'skyscraper';
  const w = 13 + rnd() * 6;
  const d = 11 + rnd() * 5;
  const color = CITY[Math.floor(rnd() * CITY.length)];
  const h1 = height * 0.48;
  const h2 = height * 0.28;
  const h3 = height * 0.17;
  const crown = height * 0.07;
  g.add(new THREE.Mesh(windowBox(w, h1, d, 3.2), kit.wall(color)));
  const tiers = [
    { w: w * 0.78, d: d * 0.78, h: h2, y: h1 },
    { w: w * 0.58, d: d * 0.58, h: h3, y: h1 + h2 },
    { w: w * 0.38, d: d * 0.38, h: crown, y: h1 + h2 + h3 },
  ];
  const ledges: THREE.BufferGeometry[] = [];
  for (const t of tiers) {
    ledges.push(box(-t.w / 2 - 0.5, t.y - 0.45, -t.d / 2 - 0.5, t.w / 2 + 0.5, t.y + 0.45, t.d / 2 + 0.5));
    g.add(new THREE.Mesh(windowBox(t.w, t.h, t.d, 3).translate(0, t.y, 0), kit.wall(color)));
  }
  g.add(parts(kit, STONE, ledges));
  // Vertical stone ribs on the south face, and a canopy over the lobby.
  g.add(parts(kit, STONE, [
    box(-w / 2 + 0.4, 0, d / 2, -w / 2 + 1, h1, d / 2 + 0.18),
    box(w / 2 - 1, 0, d / 2, w / 2 - 0.4, h1, d / 2 + 0.18),
    box(-3.2, 4.2, d / 2, 3.2, 4.7, d / 2 + 2.4),
  ]));
  // Crown, spire and the red aircraft beacon.
  const top = h1 + h2 + h3 + crown;
  g.add(parts(kit, STONE, [box(-tiers[2].w / 2 - 0.4, top - 0.3, -tiers[2].d / 2 - 0.4, tiers[2].w / 2 + 0.4, top + 0.3, tiers[2].d / 2 + 0.4)]));
  const spire = Math.max(4, height * 0.16);
  g.add(parts(kit, STEEL, [new THREE.CylinderGeometry(0.12, 0.55, spire, 4).translate(0, top + spire / 2, 0)]));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), BEACON);
  beacon.position.y = top + spire + 0.3;
  g.add(beacon);
  return g;
}

/** A brick walk-up: shopfront, cornice, fire escapes and a rooftop water tank. */
export function tenement(kit: Kit, color = BRICK[0]): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  g.name = 'tenement';
  const w = 11 + rnd() * 5;
  const d = 9 + rnd() * 2;
  const floors = 5 + Math.floor(rnd() * 2);
  const fh = 3.1;
  const h = floors * fh;
  g.add(new THREE.Mesh(windowBox(w, h, d, 2.8), kit.wall(color)));
  // Ground floor: dark plinth, shop glass, a door.
  g.add(parts(kit, shade(color, 0.7), [box(-w / 2 - 0.05, 0, -d / 2 - 0.05, w / 2 + 0.05, 3.4, d / 2 + 0.05)]));
  g.add(parts(kit, '#2a3a52', [box(-w / 2 + 0.7, 0.5, d / 2, w / 2 - 2.2, 3, d / 2 + 0.08)]));
  g.add(parts(kit, '#4a2a20', [box(w / 2 - 1.9, 0.4, d / 2, w / 2 - 0.6, 2.8, d / 2 + 0.12)]));
  // Cornice.
  g.add(parts(kit, shade(color, 0.8), [box(-w / 2 - 0.5, h - 0.4, -d / 2 - 0.5, w / 2 + 0.5, h + 0.4, d / 2 + 0.5)]));
  // Fire escape on the south face: platforms, railings and slanted ladders.
  const iron: THREE.BufferGeometry[] = [];
  const rails: THREE.BufferGeometry[] = [];
  for (let f = 1; f < floors; f++) {
    const y = f * fh + 0.25;
    iron.push(box(-w / 2 + 1.2, y, d / 2, w / 2 - 1.2, y + 0.14, d / 2 + 1.15));
    rails.push(box(-w / 2 + 1.2, y + 0.95, d / 2 + 1.07, w / 2 - 1.2, y + 1.04, d / 2 + 1.15));
    for (let x = -w / 2 + 1.4; x < w / 2 - 1.2; x += 1.5) rails.push(box(x - 0.05, y, d / 2 + 1.05, x + 0.05, y + 0.95, d / 2 + 1.13));
    if (f < floors - 1) {
      const ladder = new THREE.BoxGeometry(0.8, 0.1, fh);
      ladder.rotateX(0.6);
      ladder.translate(w / 2 - 2.6, y + fh / 2, d / 2 + 0.6);
      iron.push(ladder);
    }
  }
  g.add(parts(kit, IRON, iron), parts(kit, '#3a3c40', rails));
  // Parapet and, often, the classic wooden water tank on the roof.
  g.add(parts(kit, shade(color, 0.85), [box(-w / 2, h, -d / 2, w / 2, h + 0.8, -d / 2 + 0.4), box(w / 2 - 0.4, h, -d / 2, w / 2, h + 0.8, d / 2), box(-w / 2, h, d / 2 - 0.4, w / 2, h + 0.8, d / 2)]));
  if (rnd() < 0.65) {
    const tank = waterTower(kit);
    tank.scale.setScalar(0.62);
    tank.position.set((rnd() - 0.5) * (w - 6), h, -d / 4);
    g.add(tank);
  }
  return g;
}

/** A wooden water tank on a steel frame. */
export function waterTower(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  g.name = 'water-tower';
  const legs: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) legs.push(box(x - 0.18, 0, z - 0.18, x + 0.18, 7, z + 0.18));
  legs.push(box(-2, 3.2, -0.1, 2, 3.45, 0.1), box(-0.1, 3.2, -2, 0.1, 3.45, 2));
  g.add(parts(kit, '#5a4a3a', legs));
  g.add(parts(kit, '#8a6a4a', [new THREE.CylinderGeometry(3.1, 3.1, 4.4, 14).translate(0, 9.2, 0)]));
  g.add(parts(kit, '#6a4a32', [new THREE.ConeGeometry(3.35, 1.7, 14).translate(0, 12.25, 0)]));
  g.add(parts(kit, '#3a2a20', [
    new THREE.TorusGeometry(3.12, 0.09, 4, 18).rotateX(Math.PI / 2).translate(0, 7.8, 0),
    new THREE.TorusGeometry(3.12, 0.09, 4, 18).rotateX(Math.PI / 2).translate(0, 10.5, 0),
  ]));
  return g;
}

/** A yellow cab: rounder than the parked cars, with a roof sign. */
export function taxi(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  g.name = 'taxi';
  g.add(parts(kit, '#f2c230', [box(-0.95, 0.3, -2.1, 0.95, 1.05, 2.1)]));
  g.add(parts(kit, '#2a3446', [box(-0.85, 1.05, -1.1, 0.85, 1.65, 0.9)]));
  g.add(parts(kit, '#1c1d22', [box(-1, 0, -1.5, 1, 0.45, -0.9), box(-1, 0, 0.9, 1, 0.45, 1.5)]));
  // Checker band along both sides.
  const checks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    if (i % 2) continue;
    checks.push(box(-0.97, 0.62, -1.9 + i * 0.32, -0.93, 0.8, -1.9 + (i + 1) * 0.32));
    checks.push(box(0.93, 0.62, -1.9 + i * 0.32, 0.97, 0.8, -1.9 + (i + 1) * 0.32));
  }
  g.add(parts(kit, '#111111', checks));
  g.add(parts(kit, '#f4f0e6', [box(-0.35, 1.65, -0.15, 0.35, 1.95, 0.15)]));
  g.add(parts(kit, '#f2e6b0', [box(-0.98, 0.55, 1.95, -0.7, 0.75, 2.1), box(0.7, 0.55, 1.95, 0.98, 0.75, 2.1)]));
  return g;
}

/** A subway entrance: stairs going down behind green railings, globe lamps and a sign. */
export function subwayEntrance(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  g.name = 'subway';
  g.add(parts(kit, '#16181c', [box(-3.4, 0, -5.4, 3.4, 0.18, 5.4)]));
  // Steps down into the dark.
  const steps: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) steps.push(box(-3.1, 0.05, -4.8 + i * 1.4, 3.1, 0.14 - i * 0.16, -4.8 + (i + 1) * 1.4));
  g.add(parts(kit, '#3a3d44', steps));
  // Green railings along both sides and the back.
  const rails: THREE.BufferGeometry[] = [];
  for (const x of [-3.6, 3.6]) {
    rails.push(box(x - 0.1, 0, -5.6, x + 0.1, 1.15, -5.4), box(x - 0.1, 0, 5.2, x + 0.1, 1.15, 5.4));
    for (let z = -5.4; z <= 5.4; z += 2.7) rails.push(box(x - 0.08, 0, z - 0.08, x + 0.08, 1.15, z + 0.08));
  }
  rails.push(box(-3.6, 1.05, -5.5, 3.6, 1.2, -5.3), box(-3.6, 1.05, 5.3, 3.6, 1.2, 5.5));
  g.add(parts(kit, GREEN, rails));
  // Globe lamps on the front posts.
  const posts: THREE.BufferGeometry[] = [];
  const globes: THREE.BufferGeometry[] = [];
  for (const x of [-3.6, 3.6]) {
    posts.push(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 6).translate(x, 1.3, 5.9));
    globes.push(new THREE.SphereGeometry(0.42, 8, 6).translate(x, 2.8, 5.9));
  }
  g.add(parts(kit, '#4a4e56', posts), parts(kit, '#f2e6b0', globes));
  // Sign across the entrance.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.8), toon('#ffffff', { map: boardTexture('SUBWAY', '#1d3c8f', '#ffffff') }));
  sign.position.set(0, 3.4, 5.5);
  g.add(sign);
  return g;
}

/** A hot-dog cart under a red-and-white umbrella. */
export function hotDogCart(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hot-dog-cart';
  g.add(parts(kit, '#d8d8d8', [box(-1.3, 0, -0.8, 1.3, 1.1, 0.8)]));
  g.add(parts(kit, '#c8322a', [box(-1.4, 1.1, -0.9, 1.4, 1.25, 0.9)]));
  g.add(parts(kit, '#2a2c30', [
    new THREE.CylinderGeometry(0.4, 0.4, 0.14, 10).rotateZ(Math.PI / 2).translate(-0.8, 0.4, -0.9),
    new THREE.CylinderGeometry(0.4, 0.4, 0.14, 10).rotateZ(Math.PI / 2).translate(0.8, 0.4, -0.9),
  ]));
  // Umbrella: alternating red and white slices.
  const a: THREE.BufferGeometry[] = [];
  const b: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const geo = new THREE.ConeGeometry(2.6, 0.9, 2, 1, true, (i / 12) * Math.PI * 2, (Math.PI * 2) / 12).translate(0, 3.5, 0);
    (i % 2 === 0 ? a : b).push(geo);
  }
  g.add(parts(kit, '#c8322a', a), parts(kit, '#f4f0e6', b));
  g.add(parts(kit, STEEL, [new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5).translate(0, 2.2, 0)]));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), toon('#ffffff', { map: boardTexture('HOT DOGS', '#f2c230', '#111111') }));
  sign.position.set(0, 1.7, 0.86);
  g.add(sign);
  return g;
}

/** The landmark: Liberty on her star fort, torch up. */
export function libertyStatue(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  g.name = 'liberty';
  g.add(parts(kit, '#b8b2a6', [new THREE.CylinderGeometry(8, 9, 3, 8).translate(0, 1.5, 0)]));
  g.add(parts(kit, '#a8a29a', [box(-3.6, 3, -3.6, 3.6, 12, 3.6)]));
  g.add(parts(kit, STONE, [box(-4.3, 12, -4.3, 4.3, 13.2, 4.3)]));
  const copper = '#4a9a7a';
  // Robe, torso and head.
  g.add(parts(kit, copper, [
    new THREE.CylinderGeometry(1.7, 3.2, 14, 10).translate(0, 20, 0),
    new THREE.SphereGeometry(1.45, 10, 8).translate(0, 28.4, 0),
  ]));
  // Crown spikes.
  const spikes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + i * 0.3;
    spikes.push(new THREE.ConeGeometry(0.2, 1.3, 4).rotateZ(a).translate(Math.sin(a) * 1.5, 29.4, 0));
  }
  g.add(parts(kit, copper, spikes));
  // Raised arm and torch, tablet in the other hand.
  g.add(parts(kit, copper, [new THREE.CylinderGeometry(0.34, 0.42, 7, 6).rotateZ(-0.6).translate(2.7, 30.6, 0)]));
  g.add(parts(kit, '#c8a850', [new THREE.CylinderGeometry(0.75, 0.42, 2.2, 8).translate(4.5, 34.6, 0)]));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.5, 6), FLAME);
  flame.position.set(4.5, 36.4, 0);
  g.add(flame);
  g.add(parts(kit, copper, [box(-3.4, 22, -0.9, -2.1, 26, 0.9)]));
  return g;
}

/** A little planted square with a fountain, for the middle of the block. */
export function cityPark(kit: Kit): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  g.name = 'city-park';
  g.add(decal(kit, 34, 20, '#4a8a3e', 0, 0, 0.02));
  g.add(decal(kit, 30, 2.4, '#c8bfae', 0, 0, 0.028));
  g.add(decal(kit, 2.4, 16, '#c8bfae', 0, 0, 0.028));
  for (let i = 0; i < 10; i++) {
    const x = (rnd() - 0.5) * 28;
    const z = (rnd() - 0.5) * 14;
    if (Math.abs(x) < 4 || Math.abs(z) < 3) continue;
    g.add(tree(kit, ['#3c7d34', '#4a8a3a', '#2f6b2e'][Math.floor(rnd() * 3)], x, z, 0.8 + rnd() * 0.4));
  }
  // Fountain: stone basin, water and a jet.
  g.add(parts(kit, '#b8b2a6', [new THREE.CylinderGeometry(3.4, 3.8, 0.9, 16).translate(0, 0.45, 0)]));
  g.add(parts(kit, '#3a6f9a', [new THREE.CylinderGeometry(3, 3, 0.2, 16).translate(0, 0.95, 0)]));
  g.add(parts(kit, '#d8d4cc', [new THREE.CylinderGeometry(0.5, 0.8, 2.6, 10).translate(0, 2.1, 0)]));
  return g;
}

/** Brick colour for the walk-ups the town scatters around. */
export function brickColor(rnd: () => number): string {
  return BRICK[Math.floor(rnd() * BRICK.length)];
}
