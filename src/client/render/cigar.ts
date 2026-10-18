// Tobacco country around Cigar Circuit: a brick cigar factory with a smoking
// chimney, a giant cigar resting on an ashtray, a humidor with its lid open,
// slatted drying barns, stacked cigar boxes and fields of tobacco. Built like
// the rest of the town (south faces get the detail).

import * as THREE from 'three';
import { drawText } from '../ui/font.ts';
import { box, gableRoof, parts, type Kit } from './buildings.ts';
import { toon } from './materials.ts';

const BRICK = '#a8462e';
const LEAF = ['#8a5a2e', '#7a4a24', '#9a6a36', '#6a3e1e'];
const WOOD = '#6a3e22';
const GOLD = '#f2c230';
const SMOKE = '#dcdcd8';

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

/** A cigar lying along x: leaf-brown body, rounded head, red-and-gold band, grey ash and a glowing ember. */
function cigar(kit: Kit, len: number, r: number, x: number, y: number, z: number, lit: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = len - (lit ? 3 : 0);
  const x0 = x - len / 2;
  g.add(parts(kit, LEAF[0], [
    new THREE.CylinderGeometry(r, r, body, 12).rotateZ(Math.PI / 2).translate(x0 + body / 2, y, z),
    new THREE.SphereGeometry(r, 12, 8).scale(0.8, 1, 1).translate(x0, y, z),
  ]));
  g.add(parts(kit, '#c8322a', [new THREE.CylinderGeometry(r + 0.08, r + 0.08, len * 0.12, 12).rotateZ(Math.PI / 2).translate(x0 + len * 0.22, y, z)]));
  g.add(parts(kit, GOLD, [new THREE.CylinderGeometry(r + 0.12, r + 0.12, len * 0.025, 12).rotateZ(Math.PI / 2).translate(x0 + len * 0.22, y, z)]));
  if (lit) {
    g.add(parts(kit, '#9a9892', [new THREE.CylinderGeometry(r * 0.92, r * 0.98, 3, 12).rotateZ(Math.PI / 2).translate(x0 + body + 1.5, y, z)]));
    const ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.1, 0.2) });
    g.add(new THREE.Mesh(new THREE.CircleGeometry(r * 0.85, 12).rotateY(Math.PI / 2).translate(x0 + len + 0.03, y, z), ember));
  }
  return g;
}

/** A column of smoke puffs drifting up and to one side from (x, y, z). */
function smoke(kit: Kit, x: number, y: number, z: number, puffs: number, r: number): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < puffs; i++) {
    const s = r * (0.6 + i * 0.18);
    geos.push(new THREE.IcosahedronGeometry(s, 0).translate(x + i * r * 0.55 + (kit.rnd() - 0.5) * r * 0.4, y + i * r * 1.05, z + (kit.rnd() - 0.5) * r * 0.4));
  }
  return parts(kit, SMOKE, geos);
}

/** The factory: a brick hall with a tall banded chimney, smoke and its name over the door. */
export function cigarFactory(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const w = 26;
  const d = 12;
  const h = 9;
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), kit.wall(BRICK)));
  g.add(new THREE.Mesh(gableRoof(w, d, h, 2.4, 0.6), kit.plain('#4a3a32')));
  // Sawtooth skylights along the roof.
  const lights: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) lights.push(box(-10 + i * 5.5, h + 2.2, 0, -8 + i * 5.5, h + 3.4, 0.4));
  g.add(parts(kit, '#7fb8e0', lights));
  // Big doors and a loading ramp.
  g.add(parts(kit, '#3a2616', [box(-3, 0, d / 2, 3, 4.6, d / 2 + 0.08)]));
  g.add(parts(kit, '#b8b2a6', [box(-4.5, 0, d / 2, 4.5, 0.6, d / 2 + 2.4)]));
  g.add(sign('FABRICA', '#1a1410', GOLD, 14, h - 1.8, d / 2 + 0.12));
  // The chimney: brick, with gold and red bands, and smoke.
  const cx = 9;
  const cz = -1;
  const ch = 32;
  g.add(parts(kit, BRICK, [new THREE.CylinderGeometry(1.5, 2.1, ch, 10).translate(cx, ch / 2, cz)]));
  g.add(parts(kit, GOLD, [new THREE.CylinderGeometry(1.62, 1.66, 1.4, 10).translate(cx, ch - 3, cz)]));
  g.add(parts(kit, '#c8322a', [new THREE.CylinderGeometry(1.66, 1.7, 1.4, 10).translate(cx, ch - 1, cz)]));
  g.add(smoke(kit, cx, ch + 2, cz, 5, 1.8));
  return g;
}

/** The landmark: a giant cigar smouldering on a glass ashtray, smoke curling up. */
export function giantCigar(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  g.add(parts(kit, '#3c5a6a', [new THREE.CylinderGeometry(8.4, 8, 1.6, 18).translate(0, 0.8, 0)]));
  g.add(parts(kit, '#24323c', [new THREE.CylinderGeometry(6.6, 6.2, 0.2, 18).translate(0, 1.62, 0)]));
  // Rest notches on the rim.
  g.add(parts(kit, '#3c5a6a', [box(-1.2, 1.6, 6.8, 1.2, 2.6, 8.6), box(-1.2, 1.6, -8.6, 1.2, 2.6, -6.8)]));
  const c = cigar(kit, 26, 2.3, 0, 2.6 + 2.3, 0, true);
  c.rotation.z = 0.1;
  g.add(c);
  g.add(smoke(kit, 12.5, 7, 0, 4, 1.6));
  return g;
}

/** A humidor: a big wooden box, lid thrown back, rows of cigars inside. */
export function humidor(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const w = 22;
  const d = 12;
  const h = 7;
  g.add(parts(kit, WOOD, [box(-w / 2, 0, -d / 2, w / 2, h, d / 2)]));
  g.add(parts(kit, '#8a5a32', [box(-w / 2 - 0.2, h - 0.4, -d / 2 - 0.2, w / 2 + 0.2, h, d / 2 + 0.2), box(-w / 2 - 0.2, 0, -d / 2 - 0.2, w / 2 + 0.2, 0.5, d / 2 + 0.2)]));
  g.add(parts(kit, '#2a1a0e', [box(-w / 2 + 0.8, h - 0.5, -d / 2 + 0.8, w / 2 - 0.8, h + 0.02, d / 2 - 0.8)]));
  // Cigars lined up side by side, alternating leaf shades.
  const n = 8;
  for (let i = 0; i < n; i++) {
    const z = -d / 2 + 1.6 + (i * (d - 3.2)) / (n - 1);
    g.add(cigar(kit, w - 2.4, 0.7, 0, h + 0.1, z, false).translateY(0));
  }
  // The lid, hinged along the back edge and leaning back toward the camera's far side.
  const lid = new THREE.Group();
  lid.add(parts(kit, WOOD, [box(-w / 2, 0, 0, w / 2, 0.8, d)]));
  lid.add(parts(kit, '#8a5a32', [box(-w / 2 + 1, 0.8, 1, w / 2 - 1, 0.95, d - 1)]));
  lid.position.set(0, h, -d / 2);
  lid.rotation.x = -1.9;
  g.add(lid);
  // Brass plate and a round hygrometer on the front.
  g.add(sign('HUMIDOR', '#c8a028', '#2a1a0e', 9, 3.4, d / 2 + 0.1));
  g.add(parts(kit, '#f6f2ea', [new THREE.CylinderGeometry(0.9, 0.9, 0.2, 14).rotateX(Math.PI / 2).translate(8, 4.8, d / 2 + 0.1)]));
  return g;
}

/** A tobacco drying barn: dark slatted walls, a gable roof, vents along the ridge. */
export function dryingBarn(kit: Kit, color: string): THREE.Group {
  const g = new THREE.Group();
  const w = 10 + Math.floor(kit.rnd() * 2) * 2;
  const d = 8;
  const h = 5;
  g.add(parts(kit, '#4a2e1c', [box(-w / 2, 0, -d / 2, w / 2, h, d / 2)]));
  // Vertical slats on the south face, so the leaves can breathe.
  const slats: THREE.BufferGeometry[] = [];
  for (let x = -w / 2 + 0.7; x < w / 2 - 0.4; x += 1.1) slats.push(box(x, 0.8, d / 2, x + 0.5, h - 0.4, d / 2 + 0.07));
  g.add(parts(kit, '#2a170c', slats));
  g.add(new THREE.Mesh(gableRoof(w, d, h, 2.6, 0.6), kit.plain(color)));
  const vents: THREE.BufferGeometry[] = [];
  for (let x = -w / 2 + 1.5; x < w / 2; x += 3) vents.push(box(x, h + 2.4, -0.7, x + 1.2, h + 3.2, 0.7));
  g.add(parts(kit, '#2a170c', vents));
  return g;
}

/** A stack of cigar boxes, each with a gold-and-red label on the lid. */
export function cigarBoxes(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const levels = 2 + Math.floor(kit.rnd() * 2);
  for (let i = 0; i < levels; i++) {
    const w = 6.4 - i * 0.6;
    const d = 4.4 - i * 0.3;
    const y = i * 1.5;
    const dx = (kit.rnd() - 0.5) * 0.8;
    g.add(parts(kit, i % 2 === 0 ? '#8a5a32' : '#6a3e22', [box(dx - w / 2, y, -d / 2, dx + w / 2, y + 1.5, d / 2)]));
    g.add(parts(kit, '#c8322a', [box(dx - 1.4, y + 0.3, d / 2, dx + 1.4, y + 1.2, d / 2 + 0.06)]));
    g.add(parts(kit, GOLD, [box(dx - 0.9, y + 0.5, d / 2 + 0.06, dx + 0.9, y + 1.0, d / 2 + 0.1)]));
  }
  return g;
}
