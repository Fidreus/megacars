// Procedural race cars: low wedge bodies with flared arches, splitter, side
// skirts, diffuser, big wings, racing stripes in a contrast colour and a roof
// number. Paint is glossy (Phong) so cars pop against the toon-shaded world;
// lights are unlit HDR materials so they bloom. At night headlights throw a
// cone of light onto the road.

import * as THREE from 'three';
import type { League } from '../../shared/game/leagues.ts';
import { toon } from './materials.ts';
import { mergeByMaterial } from './batch.ts';
import { drawText } from '../ui/font.ts';
import type { PaintLook, PaintPattern } from '../game/paints.ts';

type Line = [number, number][];

interface Style {
  /** Top line of the body from front to rear: x along the car (front negative), y height. */
  top: Line;
  /** Cabin top line from windscreen base to rear window base. */
  cabin: Line;
  cabinWidth: number;
  /** Where the flat roof is, for the number roundel. */
  roofZ: number;
  roofY: number;
  wing: 'big' | 'duck' | 'tall';
  scoop: 'none' | 'roof' | 'blower';
}

const STYLES: Style[] = [
  {
    // "Viper": cab-forward wedge with a big wing.
    top: [[-2.35, 0.42], [-2.2, 0.56], [-1.2, 0.68], [-0.55, 0.74], [1.55, 0.84], [2.2, 0.82], [2.32, 0.6]],
    cabin: [[-0.55, 0.74], [0.0, 1.1], [0.95, 1.12], [1.55, 0.84]],
    cabinWidth: 1.5,
    roofZ: 0.45,
    roofY: 1.12,
    wing: 'big',
    scoop: 'none',
  },
  {
    // "Interceptor": long GT with a ducktail.
    top: [[-2.4, 0.44], [-2.25, 0.6], [-0.85, 0.78], [-0.75, 0.79], [1.3, 0.86], [2.15, 0.9], [2.38, 0.66]],
    cabin: [[-0.75, 0.79], [-0.15, 1.2], [0.75, 1.21], [1.3, 0.86]],
    cabinWidth: 1.52,
    roofZ: 0.3,
    roofY: 1.21,
    wing: 'duck',
    scoop: 'none',
  },
  {
    // "Brute": muscle car with a blower through the bonnet and a tall wing.
    top: [[-2.4, 0.5], [-2.3, 0.72], [-0.2, 0.84], [-0.15, 0.85], [1.6, 0.86], [2.25, 0.86], [2.38, 0.68]],
    cabin: [[-0.15, 0.85], [0.3, 1.2], [1.2, 1.21], [1.6, 0.86]],
    cabinWidth: 1.54,
    roofZ: 0.75,
    roofY: 1.21,
    wing: 'tall',
    scoop: 'blower',
  },
];

/** Body style for each car model (INTERCEPTOR, VIPER, BRUTE). */
export const MODEL_STYLE = [1, 0, 2];

const BODY_W = 1.92;
const TRACK_HALF = 0.98;
const BOTTOM = 0.22;

function extrude(points: Line, width: number): THREE.BufferGeometry {
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

/** Closed side profile: the top line plus a flat bottom. */
function bodyProfile(top: Line): Line {
  const front = top[0][0];
  const rear = top[top.length - 1][0];
  return [[front, BOTTOM + 0.06], ...top, [rear, BOTTOM + 0.04], [rear - 0.1, BOTTOM], [front + 0.15, BOTTOM]];
}

/** Thin boxes laid along segments [from, to) of a top line (stripes, roof skin). */
function alongLine(line: Line, width: number, thick: number, x: number, from = 0, to = line.length - 1): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = from; i < to; i++) {
    const [z0, y0] = line[i];
    const [z1, y1] = line[i + 1];
    const len = Math.hypot(z1 - z0, y1 - y0);
    if (len < 0.05) continue;
    const g = new THREE.BoxGeometry(width, thick, len);
    g.rotateX(-Math.atan2(y1 - y0, z1 - z0));
    g.translate(x, (y0 + y1) / 2 + thick / 2, (z0 + z1) / 2);
    out.push(g);
  }
  return out;
}

/** A patch of paint on the top of the body: z along the car (front negative), x across. */
interface Patch {
  z0: number;
  z1: number;
  xc: number;
  w: number;
}

/**
 * Thin patches laid over the bonnet, roof and deck (the painted tops, not
 * the glass between them): bold shapes that read when the car is a few pixels.
 */
function patternPatches(st: Style, pattern: PaintPattern): Patch[] {
  const front = st.top[0][0];
  const rear = st.top[st.top.length - 1][0];
  const cab = st.cabin;
  const roof0 = cab[1][0];
  const roof1 = cab[2][0];
  const whole = (xc: number, w: number): Patch => ({ z0: front, z1: rear, xc, w });
  switch (pattern) {
    case 'plain':
      return [];
    case 'stripe':
      return [whole(0, 0.5)];
    case 'dual':
      return [whole(-0.34, 0.3), whole(0.34, 0.3)];
    case 'twotone':
      return [{ z0: front, z1: cab[0][0], xc: 0, w: 1.7 }, { z0: roof0, z1: roof1, xc: 0, w: 1.4 }];
    case 'halves':
      return [whole(-0.5, 1.0)];
    case 'bands': {
      const mid = (roof0 + roof1) / 2;
      return [
        { z0: front + 0.45, z1: front + 0.9, xc: 0, w: 2 }, { z0: front + 1.3, z1: front + 1.75, xc: 0, w: 2 },
        { z0: mid - 0.22, z1: mid + 0.22, xc: 0, w: 2 }, { z0: rear - 0.95, z1: rear - 0.5, xc: 0, w: 2 },
      ];
    }
    case 'chequer': {
      const out: Patch[] = [];
      const cell = 0.32;
      const rows = Math.floor((rear - front) / cell);
      for (let r = 0; r < rows; r++) {
        for (let c = -1; c <= 1; c++) if ((r + c) % 2 === 0) out.push({ z0: front + r * cell, z1: front + (r + 1) * cell, xc: c * cell, w: cell });
      }
      return out;
    }
  }
}

/** The patches as thin boxes following the body's top line. */
function patchGeometry(st: Style, patches: Patch[]): THREE.BufferGeometry[] {
  const cab = st.cabin;
  const roofStart = st.top.findIndex((p) => p[0] === cab[0][0]);
  const roofEnd = st.top.findIndex((p) => p[0] === cab[cab.length - 1][0]);
  // The painted tops: bonnet, roof skin, deck (line, first and last segment, thickness, half width).
  const pieces: [Line, number, number, number, number][] = [
    [st.top, 0, roofStart, 0.03, BODY_W / 2 - 0.05],
    [cab, 1, 2, 0.05, (st.cabinWidth - 0.16) / 2],
    [st.top, roofEnd, st.top.length - 1, 0.03, BODY_W / 2 - 0.05],
  ];
  const out: THREE.BufferGeometry[] = [];
  for (const [line, from, to, thick, half] of pieces) {
    for (const p of patches) {
      const x0 = Math.max(p.xc - p.w / 2, -half);
      const x1 = Math.min(p.xc + p.w / 2, half);
      if (x1 - x0 < 0.05) continue;
      for (let i = from; i < to; i++) {
        const [za, ya] = line[i];
        const [zb, yb] = line[i + 1];
        const a = Math.max(za, p.z0);
        const b = Math.min(zb, p.z1);
        if (b - a < 0.04) continue;
        const ay = ya + ((yb - ya) * (a - za)) / (zb - za);
        const by = ya + ((yb - ya) * (b - za)) / (zb - za);
        const g = new THREE.BoxGeometry(x1 - x0, thick, Math.hypot(b - a, by - ay));
        g.rotateX(-Math.atan2(by - ay, b - a));
        g.translate((x0 + x1) / 2, (ay + by) / 2 + thick / 2, (a + b) / 2);
        out.push(g);
      }
    }
  }
  return out;
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute('position');
    const n = ng.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.36, 12).rotateZ(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.38, 8).rotateZ(Math.PI / 2);
const headGeo = new THREE.BoxGeometry(0.5, 0.08, 0.1);
const exhaustGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.32, 8).rotateX(Math.PI / 2);

const glass = new THREE.MeshPhongMaterial({ color: '#0e1622', specular: '#9fb8d8', shininess: 90 });
const tyre = toon('#18181b');
const carbon = toon('#1c1d22');
const pipe = toon('#3a3a40');
const chrome = new THREE.MeshPhongMaterial({ color: '#b8bcc4', specular: '#ffffff', shininess: 80 });
const rimMat = new THREE.MeshPhongMaterial({ color: '#c9ced6', specular: '#ffffff', shininess: 60 });

let coneTexture: THREE.CanvasTexture | null = null;
let glowTex: THREE.CanvasTexture | null = null;

/** Soft rounded-rectangle glow for the underglow (shared). */
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(32, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = Math.max(0, Math.abs(x - 15.5) - 6) / 10;
      const dy = Math.max(0, Math.abs(y - 31.5) - 18) / 14;
      const a = Math.max(0, 1 - Math.hypot(dx, dy)) ** 2;
      const k = (y * 32 + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

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

function numberTexture(n: number, ring: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(16, 16, 15.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4f4ee';
  ctx.beginPath();
  ctx.arc(16, 16, 13, 0, Math.PI * 2);
  ctx.fill();
  drawText(ctx, String(n), 16.5, 6, { color: '#111', shadow: null, align: 'center', scale: 3 });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A stripe colour that contrasts with the paint. */
function stripeColor(paint: string): string {
  const c = new THREE.Color(paint).convertLinearToSRGB();
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return l > 0.62 ? '#15161a' : '#f2f2ea';
}

export class CarView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly frontPivots: THREE.Object3D[] = [];
  private readonly wheels: THREE.Object3D[] = [];
  private readonly headMat = new THREE.MeshBasicMaterial({ color: '#fff3c4' });
  private readonly tailMat = new THREE.MeshBasicMaterial({ color: '#ff2b1c' });
  private readonly cone: THREE.Mesh;
  private lightsOn = false;
  private roll = 0;
  private pitch = 0;
  private spin = 0;
  private wrecked = false;
  private readonly paints: { mat: THREE.MeshPhongMaterial; color: THREE.Color }[] = [];

  /**
   * `league`: Supercars and Megacars each get their own racier kit. `look`: the
   * second colour and pattern of a paint job (default: a racing stripe in a contrast colour).
   */
  constructor(color: string, number: number, style = number % STYLES.length, league: League = 'standard', look?: PaintLook) {
    const st = STYLES[style];
    const paint = new THREE.MeshPhongMaterial({ color, specular: '#5a5a5a', shininess: 45 });
    const stripeHex = look?.accent ?? stripeColor(color);
    const stripe = new THREE.MeshPhongMaterial({ color: stripeHex, specular: '#5a5a5a', shininess: 45 });
    for (const mat of [paint, stripe]) this.paints.push({ mat, color: mat.color.clone() });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.body) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const front = st.top[0][0];
    const rear = st.top[st.top.length - 1][0];
    const cab = st.cabin;

    // Body shell and glasshouse.
    add(extrude(bodyProfile(st.top), BODY_W), paint);
    add(extrude([...cab, [cab[cab.length - 1][0], cab[0][1] - 0.02], [cab[0][0], cab[0][1] - 0.02]], st.cabinWidth), glass);
    // Painted roof skin between the windscreen and the rear window.
    add(merge(alongLine(cab, st.cabinWidth - 0.16, 0.04, 0, 1, 2)), paint);

    // Flared arches over all four wheels.
    const arches: THREE.BufferGeometry[] = [];
    for (const z of [-1.4, 1.42]) {
      for (const x of [-1, 1]) arches.push(new THREE.BoxGeometry(0.16, 0.34, 1.15).translate(x * (BODY_W / 2 + 0.04), 0.62, z));
    }
    add(merge(arches), paint);

    // Carbon aero: splitter, side skirts, diffuser with fins, bonnet vents.
    const aero = [
      new THREE.BoxGeometry(BODY_W + 0.2, 0.06, 0.4).translate(0, BOTTOM + 0.03, front + 0.1),
      new THREE.BoxGeometry(0.12, 0.12, 2.0).translate(-(BODY_W / 2 + 0.03), BOTTOM + 0.1, 0),
      new THREE.BoxGeometry(0.12, 0.12, 2.0).translate(BODY_W / 2 + 0.03, BOTTOM + 0.1, 0),
      new THREE.BoxGeometry(BODY_W - 0.3, 0.14, 0.3).translate(0, BOTTOM + 0.06, rear - 0.05),
    ];
    for (const x of [-0.45, 0, 0.45]) aero.push(new THREE.BoxGeometry(0.05, 0.2, 0.3).translate(x, BOTTOM + 0.1, rear - 0.05));
    add(merge(aero), carbon);

    // The pattern (by default one bold racing stripe over bonnet, roof and deck).
    const patches = patternPatches(st, look?.pattern ?? 'stripe');
    if (patches.length) add(merge(patchGeometry(st, patches)), stripe);

    // Wing or ducktail spoiler (Supercars and Megacars get their own, below).
    if (league === 'mega') {
      this.megaKit(add, paint, stripe, front, rear, st.roofY, st.roofZ);
    } else if (league === 'super') {
      this.supercarKit(add, paint, stripe, front, rear);
    } else if (st.wing === 'duck') {
      add(new THREE.BoxGeometry(BODY_W - 0.1, 0.12, 0.3).translate(0, st.top[st.top.length - 2][1] + 0.08, rear - 0.25), stripe);
    } else {
      const h = st.wing === 'tall' ? 1.3 : 1.12;
      add(new THREE.BoxGeometry(2.04, 0.07, 0.5).translate(0, h, rear - 0.35), paint);
      add(merge([
        new THREE.BoxGeometry(0.06, 0.38, 0.64).translate(-1.03, h - 0.1, rear - 0.35),
        new THREE.BoxGeometry(0.06, 0.38, 0.64).translate(1.03, h - 0.1, rear - 0.35),
        new THREE.BoxGeometry(0.07, h - 0.8, 0.14).translate(-0.55, (h + 0.8) / 2, rear - 0.35),
        new THREE.BoxGeometry(0.07, h - 0.8, 0.14).translate(0.55, (h + 0.8) / 2, rear - 0.35),
      ]), carbon);
    }
    if (st.scoop === 'roof') {
      add(new THREE.BoxGeometry(0.5, 0.14, 0.6).translate(0, st.roofY + 0.07, st.roofZ + 0.3), carbon);
    } else if (st.scoop === 'blower') {
      add(merge([
        new THREE.BoxGeometry(0.62, 0.28, 0.7).translate(0, 0.96, -1.15),
        new THREE.BoxGeometry(0.72, 0.08, 0.3).translate(0, 1.13, -1.3),
      ]), chrome);
    }

    // Roof number roundel.
    const num = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.8),
      new THREE.MeshToonMaterial({ map: numberTexture(number, stripeHex), transparent: true, alphaTest: 0.5 }),
    );
    num.rotation.x = -Math.PI / 2;
    num.position.set(0, st.roofY + 0.075, st.roofZ - 0.05);
    this.body.add(num);

    // Lights: slim angry headlights and a full-width tail light bar.
    for (const x of [-0.62, 0.62]) {
      const h = add(headGeo, this.headMat);
      h.position.set(x, st.top[0][1] + 0.06, front + 0.07);
      h.rotation.y = x > 0 ? 0.18 : -0.18;
    }
    add(new THREE.BoxGeometry(BODY_W - 0.3, 0.07, 0.05), this.tailMat).position.set(0, st.top[st.top.length - 1][1] - 0.05, rear + 0.01);
    for (const x of [-0.35, 0.35]) add(exhaustGeo, pipe).position.set(x, BOTTOM + 0.14, rear + 0.05);
    // Tiny parts don't need their own shadow (the body's covers them).
    for (const o of this.body.children) {
      const m = o as THREE.Mesh;
      if (m.material === this.headMat || m.material === this.tailMat || m.material === pipe) m.castShadow = false;
    }
    // One mesh per material: far fewer draw calls for eight cars.
    mergeByMaterial(this.body);

    // Wheels: fat tyres with bright rims; front ones steer, all of them spin.
    for (const [x, z, isFront] of [
      [-TRACK_HALF, -1.4, true], [TRACK_HALF, -1.4, true], [-TRACK_HALF, 1.42, false], [TRACK_HALF, 1.42, false],
    ] as const) {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, 0.4, z);
      const spinner = new THREE.Object3D();
      pivot.add(spinner);
      add(wheelGeo, tyre, spinner);
      add(rimGeo, rimMat, spinner).castShadow = false;
      this.wheels.push(spinner);
      this.root.add(pivot);
      if (isFront) this.frontPivots.push(pivot);
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
    this.cone.position.set(0, 0.04, -10.4);
    this.cone.renderOrder = 2;
    this.cone.visible = false;
    this.root.add(this.cone);
  }

  /**
   * Supercars: widebody haunches, a double-deck wing on swan necks, canards,
   * side intakes, a racing stripe down each flank, an LED nose bar and a
   * neon glow under the car in its own colour.
   */
  private supercarKit(
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, parent?: THREE.Object3D) => THREE.Mesh,
    paint: THREE.Material, stripe: THREE.Material, front: number, rear: number,
  ): void {
    const W = BODY_W / 2;
    add(merge([
      new THREE.BoxGeometry(0.2, 0.44, 1.5).translate(-(W + 0.13), 0.6, 1.4),
      new THREE.BoxGeometry(0.2, 0.44, 1.5).translate(W + 0.13, 0.6, 1.4),
      new THREE.BoxGeometry(0.12, 0.36, 1.2).translate(-(W + 0.09), 0.6, -1.4),
      new THREE.BoxGeometry(0.12, 0.36, 1.2).translate(W + 0.09, 0.6, -1.4),
    ]), paint);
    // Wing: main plane and flap, in the stripe colour, on carbon swan necks.
    const h = 1.38;
    const z = rear - 0.3;
    add(merge([
      new THREE.BoxGeometry(2.3, 0.07, 0.56).translate(0, h, z),
      new THREE.BoxGeometry(2.3, 0.05, 0.3).rotateX(-0.45).translate(0, h + 0.14, z + 0.3),
    ]), stripe);
    add(merge([
      new THREE.BoxGeometry(0.06, 0.62, 0.95).translate(-1.16, h + 0.02, z + 0.1),
      new THREE.BoxGeometry(0.06, 0.62, 0.95).translate(1.16, h + 0.02, z + 0.1),
      new THREE.BoxGeometry(0.07, 0.6, 0.12).translate(-0.5, h - 0.3, z - 0.15),
      new THREE.BoxGeometry(0.07, 0.6, 0.12).translate(0.5, h - 0.3, z - 0.15),
      // Canards on the nose corners and a deeper splitter.
      new THREE.BoxGeometry(0.34, 0.04, 0.26).rotateZ(0.25).translate(-(W - 0.05), 0.5, front + 0.35),
      new THREE.BoxGeometry(0.34, 0.04, 0.26).rotateZ(-0.25).translate(W - 0.05, 0.5, front + 0.35),
      new THREE.BoxGeometry(BODY_W + 0.4, 0.05, 0.5).translate(0, BOTTOM - 0.01, front + 0.05),
      // Side intakes ahead of the rear wheels.
      new THREE.BoxGeometry(0.06, 0.22, 0.6).translate(-(W + 0.02), 0.62, 0.45),
      new THREE.BoxGeometry(0.06, 0.22, 0.6).translate(W + 0.02, 0.62, 0.45),
    ]), carbon);
    // A stripe down each flank.
    add(merge([
      new THREE.BoxGeometry(0.03, 0.09, 3.4).translate(-(W + 0.015), 0.42, 0),
      new THREE.BoxGeometry(0.03, 0.09, 3.4).translate(W + 0.015, 0.42, 0),
    ]), stripe);
    add(new THREE.BoxGeometry(BODY_W - 0.5, 0.05, 0.05).translate(0, 0.5, front + 0.02), this.headMat);
    // Neon underglow: an unlit additive patch on the road under the car.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 6.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color: new THREE.Color((paint as THREE.MeshPhongMaterial).color).multiplyScalar(3),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    glow.position.y = 0.06;
    glow.renderOrder = 2;
    this.root.add(glow);
  }

  /**
   * Megacars: the Supercars kit and then some. A third wing element on
   * endplates, a shark fin and velocity stacks down the deck, quad pipes and
   * a bigger diffuser, so a Megacar is never mistaken for a Supercar.
   */
  private megaKit(
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, parent?: THREE.Object3D) => THREE.Mesh,
    paint: THREE.Material, stripe: THREE.Material, front: number, rear: number, roofY: number, roofZ: number,
  ): void {
    this.supercarKit(add, paint, stripe, front, rear);
    const h = 1.38;
    const z = rear - 0.3;
    // A third wing element, capped by vertical endplates.
    add(merge([
      new THREE.BoxGeometry(2.5, 0.06, 0.5).translate(0, h + 0.34, z + 0.04),
      new THREE.BoxGeometry(0.05, 0.36, 0.5).translate(-1.24, h + 0.2, z + 0.04),
      new THREE.BoxGeometry(0.05, 0.36, 0.5).translate(1.24, h + 0.2, z + 0.04),
    ]), stripe);
    // A shark fin down the spine, behind the roof number.
    add(new THREE.BoxGeometry(0.06, 0.36, 1.0).translate(0, roofY - 0.14, roofZ + 0.95), stripe);
    // Chrome velocity stacks either side of the fin.
    const stacks: THREE.BufferGeometry[] = [];
    for (const x of [-0.42, 0.42]) {
      const y = roofY + 0.02;
      const sz = roofZ + 0.72;
      stacks.push(new THREE.CylinderGeometry(0.1, 0.13, 0.34, 8).translate(x, y + 0.09, sz));
      stacks.push(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 8).translate(x, y + 0.27, sz));
    }
    add(merge(stacks), chrome);
    // A deeper diffuser and quad pipes.
    add(merge([
      new THREE.BoxGeometry(0.05, 0.3, 0.4).translate(-0.78, BOTTOM + 0.14, rear - 0.02),
      new THREE.BoxGeometry(0.05, 0.3, 0.4).translate(0.78, BOTTOM + 0.14, rear - 0.02),
    ]), carbon);
    for (const x of [-0.62, 0.62]) add(exhaustGeo, pipe).position.set(x, BOTTOM + 0.14, rear + 0.05);
  }

  setLights(on: boolean, strength = 1): void {
    this.lightsOn = on;
    this.cone.visible = on && strength > 0;
    (this.cone.material as THREE.MeshBasicMaterial).color.setRGB(0.85 * strength, 0.77 * strength, 0.57 * strength);
    this.headMat.color.setRGB(on ? 4 : 1.6, on ? 3.7 : 1.5, on ? 2.8 : 1.25);
  }

  /** A burnt-out shell while wrecked. */
  setWreck(on: boolean): void {
    if (on === this.wrecked) return;
    this.wrecked = on;
    for (const p of this.paints) {
      if (on) p.mat.color.copy(p.color).multiplyScalar(0.18);
      else p.mat.color.copy(p.color);
      p.mat.specular.setScalar(on ? 0.05 : 0.35);
    }
  }

  /** Place the car; accelerations drive the body roll and pitch. */
  update(
    x: number, y: number, z: number, heading: number, steer: number,
    latAccel: number, longAccel: number, braking: boolean, speed: number, dt: number,
  ): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = -heading;
    const targetRoll = Math.max(-0.1, Math.min(0.1, latAccel * 0.005));
    const targetPitch = Math.max(-0.06, Math.min(0.06, longAccel * 0.0035));
    const k = 1 - Math.exp(-9 * dt);
    this.roll += (targetRoll - this.roll) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
    for (const p of this.frontPivots) p.rotation.y = -steer * 0.45;
    this.spin -= (speed / 0.4) * dt;
    for (const w of this.wheels) w.rotation.x = this.spin;
    const tail = braking ? 6 : this.lightsOn ? 2.4 : 1.2;
    this.tailMat.color.setRGB(tail, tail * 0.08, tail * 0.05);
  }
}
