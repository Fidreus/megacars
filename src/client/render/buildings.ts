// A kit of detailed buildings for the towns around the tracks. The camera
// looks north from the south at 57°, so roofs and the south (+z) faces are
// what people see: that is where the detail goes (shop fronts, awnings,
// balconies, doors, roof clutter). Small parts are merged into one geometry
// per colour, and the static batcher merges them further per area.

import * as THREE from 'three';
import { mergeGeometries } from './trackMesh.ts';

export interface Kit {
  rnd: () => number;
  /** Wall with windows (textured, lights up at night), shared per colour. */
  wall: (color: string) => THREE.Material;
  /** Plain toon material, shared per colour. */
  plain: (color: string) => THREE.Material;
}

const choose = <T>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

/** A box from its min corner to max corner (metres). */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Boxes of one colour as one mesh. */
function parts(kit: Kit, color: string, geos: THREE.BufferGeometry[]): THREE.Mesh {
  return new THREE.Mesh(mergeGeometries(geos), kit.plain(color));
}

/** A box whose four sides tile one window every `cell` metres; top and bottom plain. */
export function windowBox(w: number, h: number, d: number, cell = 3.2): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const k = f * 4 + v;
      if (f === 2 || f === 3) {
        uv.setXY(k, 0.02, 0.02);
      } else {
        const across = f < 2 ? d : w;
        uv.setXY(k, uv.getX(k) * Math.max(1, Math.round(across / cell)), uv.getY(k) * Math.max(1, Math.round(h / cell)));
      }
    }
  }
  geo.translate(0, h / 2, 0);
  return geo;
}

/**
 * Gable roof along x: eaves at y0, ridge at y0 + rise, overhanging the
 * w x d footprint. Flat-shaded, closed at both ends.
 */
function gableRoof(w: number, d: number, y0: number, rise: number, over = 0.5): THREE.BufferGeometry {
  const x = w / 2 + over;
  const z = d / 2 + over;
  const y1 = y0 + rise;
  // prettier-ignore
  const p = [
    // south slope
    -x, y0, z, x, y0, z, x, y1, 0, -x, y0, z, x, y1, 0, -x, y1, 0,
    // north slope
    x, y0, -z, -x, y0, -z, -x, y1, 0, x, y0, -z, -x, y1, 0, x, y1, 0,
    // gable ends
    x, y0, z, x, y0, -z, x, y1, 0,
    -x, y0, -z, -x, y0, z, -x, y1, 0,
    // underside
    -x, y0, z, -x, y0, -z, x, y0, -z, -x, y0, z, x, y0, -z, x, y0, z,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** Thin dark lines across a sloped roof: rows of tiles (as slightly raised strips). */
function tileRows(w: number, d: number, y0: number, rise: number, over = 0.5, rows = 5): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const z = d / 2 + over;
  const slope = Math.atan2(rise, z);
  for (const side of [1, -1]) {
    for (let i = 1; i < rows; i++) {
      const t = i / rows;
      const g = new THREE.BoxGeometry(w + over * 2 + 0.02, 0.06, 0.12);
      g.rotateX(side * slope);
      g.translate(0, y0 + rise * (1 - t) + 0.04, side * z * t);
      out.push(g);
    }
  }
  return out;
}

// ------------------------------------------------------------------ homes

/** A detached house with a tiled gable roof, chimney, door and porch. */
export function house(kit: Kit, opts: { wall: string; roof: string; snow?: boolean; w?: number; d?: number }): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const w = opts.w ?? 8 + rnd() * 3;
  const d = opts.d ?? 6.5 + rnd() * 1.5;
  const floors = rnd() < 0.5 ? 2 : 1;
  const h = floors * 2.8 + 0.4;
  g.add(new THREE.Mesh(windowBox(w, h, d, 2.6), kit.wall(opts.wall)));
  // Plinth, door with a little roof, steps.
  g.add(parts(kit, '#8a8478', [box(-w / 2 - 0.05, 0, -d / 2 - 0.05, w / 2 + 0.05, 0.45, d / 2 + 0.05)]));
  const dx = (rnd() - 0.5) * (w - 3);
  g.add(parts(kit, choose(rnd, ['#7a3a22', '#2f4f7a', '#2f6a3a', '#6a2a3a', '#3a3a40']), [box(dx - 0.55, 0.4, d / 2, dx + 0.55, 2.4, d / 2 + 0.08)]));
  g.add(parts(kit, '#d8d2c4', [box(dx - 0.9, 0, d / 2, dx + 0.9, 0.25, d / 2 + 1.1), box(dx - 1, 2.6, d / 2, dx + 1, 2.75, d / 2 + 1)]));
  // Roof with tile rows and a ridge cap.
  const rise = 2.2 + rnd() * 1.4;
  const roof = opts.snow ? '#f2f6fa' : opts.roof;
  g.add(new THREE.Mesh(gableRoof(w, d, h, rise), kit.plain(roof)));
  if (!opts.snow) g.add(parts(kit, shade(opts.roof, 0.72), [...tileRows(w, d, h, rise), box(-w / 2 - 0.5, h + rise - 0.08, -0.12, w / 2 + 0.5, h + rise + 0.12, 0.12)]));
  // Chimney (snow on top in winter).
  const cx = (rnd() < 0.5 ? -1 : 1) * w * 0.28;
  const cz = -d * 0.18;
  const top = h + rise * 0.75 + 1.4;
  g.add(parts(kit, '#9a5a42', [box(cx - 0.45, h, cz - 0.45, cx + 0.45, top, cz + 0.45)]));
  g.add(parts(kit, opts.snow ? '#f2f6fa' : '#5a4038', [box(cx - 0.55, top, cz - 0.55, cx + 0.55, top + 0.2, cz + 0.55)]));
  return g;
}

/** Garden around a house: lawn, picket fence or hedge, a path to the door, a tree. */
export function garden(kit: Kit, w: number, d: number, opts: { lawn: string; fence: string; hedge: boolean; tree: string }): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  g.add(decal(kit, w, d, opts.lawn, 0, 0, 0.012));
  // Path from the front edge to the house.
  g.add(decal(kit, 1.4, d / 2, '#c8bfae', (rnd() - 0.5) * 2, d / 4, 0.02));
  if (opts.hedge) {
    const hs: THREE.BufferGeometry[] = [];
    hs.push(box(-w / 2, 0, -d / 2, -w / 2 + 0.8, 1.1, d / 2), box(w / 2 - 0.8, 0, -d / 2, w / 2, 1.1, d / 2), box(-w / 2, 0, -d / 2, w / 2, 1.1, -d / 2 + 0.8));
    hs.push(box(-w / 2, 0, d / 2 - 0.8, -1.2, 1.1, d / 2), box(1.2, 0, d / 2 - 0.8, w / 2, 1.1, d / 2));
    g.add(parts(kit, '#2f6b2e', hs));
  } else {
    const fs: THREE.BufferGeometry[] = [];
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(2, Math.round(len / 0.7));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        fs.push(box(x - 0.06, 0, z - 0.06, x + 0.06, 0.9, z + 0.06));
      }
      const rail = new THREE.BoxGeometry(len, 0.08, 0.05).rotateY(-Math.atan2(z1 - z0, x1 - x0)).translate((x0 + x1) / 2, 0.65, (z0 + z1) / 2);
      fs.push(rail);
    };
    edge(-w / 2, -d / 2, w / 2, -d / 2);
    edge(-w / 2, -d / 2, -w / 2, d / 2);
    edge(w / 2, -d / 2, w / 2, d / 2);
    edge(-w / 2, d / 2, -1, d / 2);
    edge(1, d / 2, w / 2, d / 2);
    g.add(parts(kit, opts.fence, fs));
  }
  // A garden tree in a back corner, and a flower bed.
  const tx = (rnd() < 0.5 ? -1 : 1) * (w / 2 - 1.8);
  g.add(tree(kit, opts.tree, tx, -d / 2 + 1.8, 0.8 + rnd() * 0.4));
  g.add(decal(kit, 2.4, 0.9, choose(rnd, ['#e8508a', '#f2c230', '#e8322a', '#9a7ae0']), -tx * 0.6, d / 2 - 1.2, 0.03));
  return g;
}

/** A round leafy tree (trunk + two lumpy crowns). */
export function tree(kit: Kit, color: string, x = 0, z = 0, s = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(parts(kit, '#6b4a2e', [new THREE.CylinderGeometry(0.2 * s, 0.28 * s, 2 * s, 5).translate(x, s, z)]));
  const c1 = new THREE.IcosahedronGeometry(1.6 * s, 0).translate(x, 3 * s, z);
  const c2 = new THREE.IcosahedronGeometry(1.1 * s, 0).translate(x + 0.7 * s, 3.8 * s, z - 0.3 * s);
  g.add(parts(kit, color, [c1, c2]));
  return g;
}

/** A flat coloured patch on the ground (lawn, path, parking, field). */
export function decal(kit: Kit, w: number, d: number, color: string, x = 0, z = 0, y = 0.02, rot = 0): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  if (rot) geo.rotateY(rot);
  geo.translate(x, y, z);
  const m = new THREE.Mesh(geo, kit.plain(color));
  m.receiveShadow = true;
  m.userData.decal = true;
  return m;
}

// --------------------------------------------------------------- the city

/**
 * Apartment block: a ground floor of shops with glass and a striped awning,
 * balconies up the south face, a parapet round the roof and roof clutter.
 */
export function apartment(kit: Kit, w: number, d: number, h: number, color: string, trim: string): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const shop = 3.6;
  g.add(new THREE.Mesh(windowBox(w, h - shop, d), kit.wall(color)).translateY(shop));
  // Ground floor: darker band, shop windows, an awning on the south side.
  g.add(parts(kit, shade(color, 0.7), [box(-w / 2 - 0.1, 0, -d / 2 - 0.1, w / 2 + 0.1, shop, d / 2 + 0.1)]));
  const panes: THREE.BufferGeometry[] = [];
  const n = Math.max(1, Math.round(w / 3.4));
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + (i + 0.15) * (w / n);
    const x1 = -w / 2 + (i + 0.85) * (w / n);
    panes.push(box(x0, 0.5, d / 2 + 0.1, x1, 2.8, d / 2 + 0.16));
  }
  g.add(parts(kit, '#2a3a52', panes));
  const stripes = [choose(kit.rnd, ['#e8322a', '#2f6fe0', '#2f8a4a', '#f2c230', '#e86a2a']), '#f4f0e6'];
  const aw: THREE.BufferGeometry[][] = [[], []];
  const sw = 0.6;
  for (let i = 0, x = -w / 2; x < w / 2 - 0.01; i++, x += sw) {
    const g2 = box(x, 0, 0, Math.min(w / 2, x + sw), 0.08, 1.4);
    g2.rotateX(0.35);
    g2.translate(0, 3.1, d / 2 + 0.1);
    aw[i % 2].push(g2);
  }
  g.add(parts(kit, stripes[0], aw[0]), parts(kit, stripes[1], aw[1]));
  // Balconies on alternate window columns of every other floor (south face).
  const floors = Math.floor((h - shop) / 3.2);
  const cols = Math.max(1, Math.round(w / 3.2));
  const slabs: THREE.BufferGeometry[] = [];
  const rails: THREE.BufferGeometry[] = [];
  const cw = w / cols;
  for (let f = 1; f < floors; f++) {
    for (let c = (f % 2); c < cols; c += 2) {
      const x0 = -w / 2 + c * cw + 0.2;
      const x1 = x0 + cw - 0.4;
      const y = shop + f * 3.2;
      slabs.push(box(x0, y - 0.05, d / 2, x1, y + 0.1, d / 2 + 1));
      rails.push(box(x0, y + 0.1, d / 2 + 0.92, x1, y + 0.95, d / 2 + 1), box(x0, y + 0.1, d / 2, x0 + 0.08, y + 0.95, d / 2 + 1), box(x1 - 0.08, y + 0.1, d / 2, x1, y + 0.95, d / 2 + 1));
    }
  }
  if (slabs.length) g.add(parts(kit, '#d8d4cc', slabs), parts(kit, trim, rails));
  // Roof: gravel, a parapet in the trim colour, then clutter.
  g.add(parts(kit, '#a8a29a', [box(-w / 2, h - 0.05, -d / 2, w / 2, h + 0.05, d / 2)]));
  const p = 0.35;
  g.add(parts(kit, trim, [
    box(-w / 2 - 0.15, h, d / 2 - p, w / 2 + 0.15, h + 0.8, d / 2 + 0.15),
    box(-w / 2 - 0.15, h, -d / 2 - 0.15, w / 2 + 0.15, h + 0.8, -d / 2 + p),
    box(-w / 2 - 0.15, h, -d / 2, -w / 2 + p, h + 0.8, d / 2),
    box(w / 2 - p, h, -d / 2, w / 2 + 0.15, h + 0.8, d / 2),
  ]));
  roofClutter(kit, g, w, d, h);
  return g;
}

function roofClutter(kit: Kit, g: THREE.Group, w: number, d: number, h: number): void {
  const { rnd } = kit;
  // Stairwell / lift box with a door.
  const sx = (rnd() - 0.5) * (w - 5);
  g.add(parts(kit, '#c8c2b8', [box(sx - 1.4, h, -d / 2 + 1, sx + 1.4, h + 2.6, -d / 2 + 3.6)]));
  g.add(parts(kit, '#5a5f66', [box(sx - 1.6, h + 2.6, -d / 2 + 0.8, sx + 1.6, h + 2.8, -d / 2 + 3.8), box(sx - 0.5, h, -d / 2 + 3.6, sx + 0.5, h + 2, -d / 2 + 3.65)]));
  // Air-con units with fans.
  const units: THREE.BufferGeometry[] = [];
  const fans: THREE.BufferGeometry[] = [];
  const count = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + 1.6 + rnd() * (w - 3.2);
    const z = rnd() * (d / 2 - 1.6);
    units.push(box(x - 0.8, h, z - 0.6, x + 0.8, h + 0.9, z + 0.6));
    fans.push(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 10).translate(x, h + 0.93, z));
  }
  g.add(parts(kit, '#b8bcc0', units), parts(kit, '#3a3d44', fans));
  const extra = rnd();
  if (extra < 0.35) {
    // Solar panels in tilted rows.
    const panels: THREE.BufferGeometry[] = [];
    for (let r = 0; r < 3; r++) {
      const pg = box(-w / 2 + 1.2, 0, -0.6, w / 2 - 1.2, 0.08, 0.6);
      pg.rotateX(-0.45);
      pg.translate(0, h + 0.6, d / 2 - 1.8 - r * 1.7);
      panels.push(pg);
    }
    g.add(parts(kit, '#1e3460', panels));
  } else if (extra < 0.65) {
    // Water tank on legs.
    const tx = w / 4;
    const legs: THREE.BufferGeometry[] = [];
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) legs.push(box(tx + lx - 0.08, h, lz - 0.08, tx + lx + 0.08, h + 1.4, lz + 0.08));
    g.add(parts(kit, '#5a4a3a', legs));
    g.add(parts(kit, '#8a6a4a', [new THREE.CylinderGeometry(1.2, 1.2, 1.8, 12).translate(tx, h + 2.3, 0)]));
    g.add(parts(kit, '#5a4a3a', [new THREE.ConeGeometry(1.3, 0.7, 12).translate(tx, h + 3.55, 0)]));
  } else {
    // Antenna mast and a satellite dish.
    g.add(parts(kit, '#d8d8d8', [box(w / 3 - 0.06, h, -0.06, w / 3 + 0.06, h + 5, 0.06), box(w / 3 - 0.9, h + 4, -0.04, w / 3 + 0.9, h + 4.08, 0.04)]));
    g.add(parts(kit, '#e8e8e8', [new THREE.SphereGeometry(0.7, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.4).rotateX(-1.1).translate(-w / 4, h + 1, d / 4)]));
  }
}

/** One- or two-storey shop with a big sign on the parapet. */
export function shopFront(kit: Kit, w: number, d: number, color: string, sign: string): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const h = rnd() < 0.5 ? 4.2 : 7.2;
  g.add(parts(kit, color, [box(-w / 2, 0, -d / 2, w / 2, h, d / 2)]));
  g.add(parts(kit, '#2a3a52', [box(-w / 2 + 0.6, 0.4, d / 2, w / 2 - 0.6, 3.2, d / 2 + 0.06)]));
  if (h > 5) g.add(new THREE.Mesh(windowBox(w - 0.2, h - 4, d - 0.2), kit.wall(color)).translateY(4));
  g.add(parts(kit, sign, [box(-w / 2 + 0.4, h, d / 2 - 0.3, w / 2 - 0.4, h + 1.4, d / 2)]));
  g.add(parts(kit, '#f4f0e6', [box(-w / 2 + 0.9, h + 0.4, d / 2, w / 2 - 0.9, h + 1, d / 2 + 0.04)]));
  g.add(parts(kit, '#a8a29a', [box(-w / 2, h - 0.05, -d / 2, w / 2, h + 0.05, d / 2)]));
  roofClutter(kit, g, w, d, h);
  return g;
}

/** A parked car (box body and cabin). */
export function parkedCar(kit: Kit, color: string, x: number, z: number, rot: number): THREE.Group {
  const g = new THREE.Group();
  g.add(parts(kit, color, [box(-0.95, 0.25, -2.1, 0.95, 1.05, 2.1)]));
  g.add(parts(kit, '#2a3446', [box(-0.85, 1.05, -1.1, 0.85, 1.6, 0.9)]));
  g.add(parts(kit, '#1c1d22', [box(-1, 0, -1.5, 1, 0.45, -0.9), box(-1, 0, 0.9, 1, 0.45, 1.5)]));
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  return g;
}

/** A car park: asphalt, white bays and a few cars. */
export function carPark(kit: Kit, w: number, d: number): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  g.add(decal(kit, w, d, '#4a4c52', 0, 0, 0.015));
  const bays = Math.floor(w / 2.8);
  const lines: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 2; row++) {
    const zc = (row === 0 ? -1 : 1) * (d / 4);
    for (let i = 0; i <= bays; i++) {
      const x = -w / 2 + 0.5 + i * 2.8;
      lines.push(new THREE.PlaneGeometry(0.14, d / 2 - 1).rotateX(-Math.PI / 2).translate(x, 0.025, zc));
    }
    for (let i = 0; i < bays; i++) {
      if (rnd() < 0.45) continue;
      g.add(parkedCar(kit, choose(rnd, ['#e8322a', '#2f6fe0', '#f0f0e8', '#2a2c30', '#f2c230', '#5ac8c8', '#9aa0a6', '#2f8a4a']), -w / 2 + 0.5 + (i + 0.5) * 2.8, zc, (row === 0 ? 0 : Math.PI) + (rnd() - 0.5) * 0.1));
    }
  }
  const m = parts(kit, '#e8e8e0', lines);
  m.userData.decal = true;
  g.add(m);
  return g;
}

// ------------------------------------------------------------- the country

/** A red barn with white trim and a gambrel-ish roof, and silos beside it. */
export function farm(kit: Kit): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const w = 14;
  const d = 9;
  g.add(parts(kit, '#b8322a', [box(-w / 2, 0, -d / 2, w / 2, 5, d / 2)]));
  g.add(parts(kit, '#f4f0e6', [
    box(-w / 2 - 0.05, 0, d / 2, -w / 2 + 0.3, 5, d / 2 + 0.06), box(w / 2 - 0.3, 0, d / 2, w / 2 + 0.05, 5, d / 2 + 0.06),
    box(-2.2, 0, d / 2, 2.2, 0.25, d / 2 + 0.06), box(-2.2, 4, d / 2, 2.2, 4.25, d / 2 + 0.06),
    box(-2.2, 0, d / 2, -1.95, 4.25, d / 2 + 0.06), box(1.95, 0, d / 2, 2.2, 4.25, d / 2 + 0.06),
  ]));
  g.add(parts(kit, '#6a2a22', [box(-1.95, 0.25, d / 2, 1.95, 4, d / 2 + 0.04)]));
  g.add(new THREE.Mesh(gableRoof(w, d, 5, 3.4, 0.6), kit.plain('#5a5f66')));
  // Silos with domes.
  const n = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const x = w / 2 + 3 + i * 4.6;
    g.add(parts(kit, '#c8ccd0', [new THREE.CylinderGeometry(2, 2, 11, 14).translate(x, 5.5, -1)]));
    g.add(parts(kit, '#8a9096', [new THREE.SphereGeometry(2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, 11, -1)]));
  }
  return g;
}

/** A field: rows of crops in two tones, hedges along two sides. */
export function field(kit: Kit, w: number, d: number, tones: [string, string]): THREE.Group {
  const g = new THREE.Group();
  g.add(decal(kit, w, d, tones[0], 0, 0, 0.01));
  const rows: THREE.BufferGeometry[] = [];
  for (let x = -w / 2 + 1; x < w / 2; x += 2) rows.push(new THREE.PlaneGeometry(0.9, d - 1).rotateX(-Math.PI / 2).translate(x, 0.018, 0));
  const m = parts(kit, tones[1], rows);
  m.userData.decal = true;
  g.add(m);
  g.add(parts(kit, '#2f6b2e', [box(-w / 2, 0, -d / 2 - 0.9, w / 2, 1.3, -d / 2), box(-w / 2 - 0.9, 0, -d / 2, -w / 2, 1.3, d / 2)]));
  return g;
}

// ---------------------------------------------------------------- desert

/** Adobe house: soft-edged flat roof with a parapet, poking vigas, a bright door. */
export function adobe(kit: Kit, color: string): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const w = 8 + rnd() * 5;
  const d = 7 + rnd() * 3;
  const h = rnd() < 0.4 ? 6.4 : 3.6;
  g.add(new THREE.Mesh(windowBox(w, h, d, 3), kit.wall(color)));
  const dark = shade(color, 0.85);
  g.add(parts(kit, dark, [
    box(-w / 2 - 0.1, h, d / 2 - 0.4, w / 2 + 0.1, h + 0.7, d / 2 + 0.1),
    box(-w / 2 - 0.1, h, -d / 2 - 0.1, w / 2 + 0.1, h + 0.7, -d / 2 + 0.4),
    box(-w / 2 - 0.1, h, -d / 2, -w / 2 + 0.4, h + 0.7, d / 2),
    box(w / 2 - 0.4, h, -d / 2, w / 2 + 0.1, h + 0.7, d / 2),
  ]));
  const vigas: THREE.BufferGeometry[] = [];
  for (let x = -w / 2 + 0.8; x < w / 2 - 0.4; x += 1.4) vigas.push(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 6).rotateX(Math.PI / 2).translate(x, h - 0.5, d / 2 + 0.4));
  g.add(parts(kit, '#6a4a2e', vigas));
  g.add(parts(kit, choose(rnd, ['#2f8ac8', '#5ac8c8', '#e8322a', '#2f8a4a']), [box(-0.6, 0, d / 2, 0.6, 2.3, d / 2 + 0.08)]));
  if (rnd() < 0.5) g.add(parts(kit, '#c8b090', [box(-w / 2 + 0.6, h, -d / 2 + 0.6, -w / 2 + 3, h + 2.2, -d / 2 + 3)]));
  return g;
}

/** A desert gas station: canopy on posts, pumps and a small shop. */
export function gasStation(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  g.add(decal(kit, 22, 16, '#5a5c60', 0, 0, 0.015));
  const posts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-6, -3], [6, -3], [-6, 3], [6, 3]]) posts.push(box(x - 0.25, 0, z - 0.25, x + 0.25, 5, z + 0.25));
  g.add(parts(kit, '#e8e8e8', posts));
  g.add(parts(kit, '#e8322a', [box(-8, 5, -4.5, 8, 6, 4.5)]));
  g.add(parts(kit, '#f2f0e8', [box(-8.05, 5.3, 4.5, 8.05, 5.7, 4.56)]));
  const pumps: THREE.BufferGeometry[] = [];
  for (const x of [-3, 3]) pumps.push(box(x - 0.4, 0, -0.6, x + 0.4, 1.6, 0.6));
  g.add(parts(kit, '#f2c230', pumps));
  const shop = shopFront(kit, 9, 6, '#f0e6d2', '#2f6fe0');
  shop.position.set(0, 0, -9);
  g.add(shop);
  return g;
}

// ---------------------------------------------------------------- winter

/** Wooden chalet: dark timber, deep snowy roof, a balcony on the south. */
export function chalet(kit: Kit, color: string): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const w = 9 + rnd() * 3;
  const d = 7 + rnd() * 2;
  const h = 5.6;
  g.add(new THREE.Mesh(windowBox(w, h, d, 2.6), kit.wall(color)));
  g.add(parts(kit, '#6a6c70', [box(-w / 2 - 0.1, 0, -d / 2 - 0.1, w / 2 + 0.1, 0.8, d / 2 + 0.1)]));
  g.add(parts(kit, '#5a3a22', [box(-w / 2 + 0.6, 2.9, d / 2, w / 2 - 0.6, 3.05, d / 2 + 1.2), box(-w / 2 + 0.6, 3.05, d / 2 + 1.1, w / 2 - 0.6, 3.9, d / 2 + 1.2)]));
  g.add(new THREE.Mesh(gableRoof(w, d, h, 3.6, 1.1), kit.plain('#f2f6fa')));
  g.add(parts(kit, '#5a3a22', [box(-w / 2 - 1.1, h - 0.25, -d / 2 - 1.1, w / 2 + 1.1, h, d / 2 + 1.1)]));
  const cx = w * 0.25;
  g.add(parts(kit, '#7a7c80', [box(cx - 0.5, h, -0.8, cx + 0.5, h + 4.6, 0.2)]));
  g.add(parts(kit, '#f2f6fa', [box(cx - 0.6, h + 4.6, -0.9, cx + 0.6, h + 4.9, 0.3)]));
  return g;
}

// --------------------------------------------------------------- industry

/** Warehouse with a sawtooth roof, loading doors and a few containers. */
export function warehouse(kit: Kit, color: string): THREE.Group {
  const { rnd } = kit;
  const g = new THREE.Group();
  const w = 20 + rnd() * 8;
  const d = 14;
  const h = 7;
  g.add(parts(kit, color, [box(-w / 2, 0, -d / 2, w / 2, h, d / 2)]));
  const teeth: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  for (let z = -d / 2; z < d / 2 - 0.1; z += 3.5) {
    const t = gableRoof(w, 3.5, 0, 2, 0);
    t.translate(0, h, z + 1.75);
    teeth.push(t);
    glass.push(box(-w / 2 + 0.2, h, z + 3.3, w / 2 - 0.2, h + 1.6, z + 3.5));
  }
  g.add(parts(kit, '#9aa0a6', teeth), parts(kit, '#6fa8d0', glass));
  const doors: THREE.BufferGeometry[] = [];
  for (let x = -w / 2 + 3; x < w / 2 - 2; x += 5) doors.push(box(x - 1.6, 0, d / 2, x + 1.6, 4.2, d / 2 + 0.08));
  g.add(parts(kit, '#e8c030', doors));
  const containers = Math.floor(rnd() * 4);
  for (let i = 0; i < containers; i++) {
    const c = parts(kit, choose(rnd, ['#2f6fe0', '#e8322a', '#2f8a4a', '#e86a2a']), [box(-1.2, 0, -3, 1.2, 2.6, 3)]);
    c.position.set(-w / 2 + 2 + i * 3, i === 3 ? 2.6 : 0, d / 2 + 5);
    c.rotation.y = Math.PI / 2;
    g.add(c);
  }
  return g;
}

/** Hex colour times k (0..1 darker). */
export function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}
