// The towns around the tracks, in the style of each theme: apartment blocks
// with shops and balconies, houses with gardens, farms with fields and car
// parks in the countryside; adobe houses, a gas station, a casino and water
// towers in the desert; chalets, an alpine hotel and a ski jump in the snow;
// offices and warehouses at the power plant. Windows light up at night.
// Tall things only go where they can't hide the road from the tilted camera.
// Fronts face south, toward the camera.

import * as THREE from 'three';
import { distanceToCentreline } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { makeRng } from '../../shared/math/rng.ts';
import { toon } from './materials.ts';
import type { KeepOut } from './props.ts';
import {
  adobe, apartment, carPark, chalet, decal, farm, field, garden, gasStation, house, shade, shopFront, warehouse, windowBox, type Kit,
} from './buildings.ts';
import { barrelStack, beerTent, beerTruck, brewhouse, giantMug, hopGarden, maltSilos, pub } from './brewery.ts';
import { cigarBoxes, cigarFactory, dryingBarn, giantCigar, humidor } from './cigar.ts';
import { balloons, bigTop, carousel, dropTower, FAIR, ferrisWheel, rollerCoaster, stall } from './tivoli.ts';

export interface Town {
  group: THREE.Group;
  keepOut: KeepOut[];
  /** Window materials: their emissive glow is turned on at night. */
  windows: THREE.MeshToonMaterial[];
}

/** One window cell: wall frame, glass, a sill. White = wall (tinted by the material colour). */
function windowTexture(lit: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = lit ? '#000000' : '#ffffff';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = lit ? '#ffd27a' : '#2a3a5a';
  g.fillRect(4, 4, 8, 8);
  if (!lit) {
    g.fillStyle = '#7aa0d0';
    g.fillRect(4, 4, 3, 3);
    g.fillStyle = '#d8d8d8';
    g.fillRect(3, 12, 10, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let wallTex: THREE.CanvasTexture | null = null;
let litTex: THREE.CanvasTexture | null = null;

export function buildTown(track: Track, theme: string, existing: readonly KeepOut[]): Town {
  const group = new THREE.Group();
  group.name = 'town';
  const keepOut: KeepOut[] = [];
  const windows: THREE.MeshToonMaterial[] = [];
  wallTex ??= windowTexture(false);
  litTex ??= windowTexture(true);
  const rnd = makeRng((track.def.seed ?? 1) * 92821);
  const clear = track.def.width / 2 + track.def.runoff + 2;
  const b = track.bounds;
  const pad = 110;

  const mats = new Map<string, THREE.MeshToonMaterial>();
  /** Wall material with windows in this colour (shared per colour). */
  const wall = (color: string) => {
    let m = mats.get(color);
    if (!m) {
      m = toon(color, { map: wallTex!, emissiveMap: litTex!, emissive: new THREE.Color('#ffc860'), emissiveIntensity: 0 });
      mats.set(color, m);
      windows.push(m);
    }
    return m;
  };
  const plainMats = new Map<string, THREE.MeshToonMaterial>();
  const plain = (color: string) => {
    let m = plainMats.get(color);
    if (!m) plainMats.set(color, (m = toon(color)));
    return m;
  };
  const kit: Kit = { rnd, wall, plain };

  const free = (x: number, z: number, r: number) =>
    ![...existing, ...keepOut].some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < (k.r + r) ** 2);
  // The camera looks north at 57°: h metres of height hide ~0.65·h of ground north of it.
  const hidesRoad = (x: number, z: number, r: number, h: number) => {
    for (let dz = r; dz >= -r - h * 0.65; dz -= 2) {
      for (const dx of [-r, 0, r]) if (distanceToCentreline(track, x + dx, z + dz) < clear) return true;
    }
    return false;
  };
  // distanceToCentreline only knows the strip near the road (1e9 beyond it),
  // so farther out measure to the centreline samples directly.
  const far = (x: number, z: number) => {
    const near = distanceToCentreline(track, x, z);
    if (near < 1e8) return near;
    let best = Infinity;
    for (let i = 0; i < track.n; i += 3) best = Math.min(best, (track.px[i] - x) ** 2 + (track.pz[i] - z) ** 2);
    return Math.sqrt(best);
  };
  const pick = (r: number, h: number, minGap: number, maxGap: number, tries = 300): [number, number] | null => {
    for (let t = 0; t < tries; t++) {
      const x = b.minX - pad + rnd() * (b.maxX - b.minX + pad * 2);
      const z = b.minZ - pad + rnd() * (b.maxZ - b.minZ + pad * 2);
      const d = far(x, z);
      if (d < clear + r + minGap || d > clear + r + maxGap) continue;
      if (!free(x, z, r) || hidesRoad(x, z, r, h)) continue;
      return [x, z];
    }
    return null;
  };
  const add = (obj: THREE.Object3D, x: number, z: number, r: number, turn = true) => {
    obj.position.set(x, 0, z);
    // Mostly facing the camera (south), a little askew.
    if (turn) obj.rotation.y = (rnd() < 0.8 ? 0 : (rnd() < 0.5 ? -1 : 1) * (Math.PI / 2)) + (rnd() - 0.5) * 0.16;
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        // Ground patches take shadows but don't cast them.
        o.castShadow = !o.userData.decal;
        o.receiveShadow = true;
      }
    });
    group.add(obj);
    keepOut.push({ x, z, r });
  };
  const choose = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };

  // ------------------------------------------------------------ builders

  /** Desert casino hotel: a tall slab with a neon crown. */
  const casino = () => {
    const g = new THREE.Group();
    const h = 34;
    g.add(mesh(windowBox(12, h, 9), wall('#f2d7a0')));
    g.add(mesh(windowBox(20, 8, 14), wall('#e8a060')));
    const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.6, 2.6) });
    g.add(mesh(new THREE.BoxGeometry(12.6, 2.2, 9.6), neon, 0, h + 1.1, 0));
    g.add(mesh(new THREE.BoxGeometry(13, 0.6, 10), plain('#ffd84a'), 0, h - 0.4, 0));
    const star = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.2, 0.8) });
    g.add(mesh(new THREE.OctahedronGeometry(2.2, 0), star, 0, h + 5, 0));
    // A porte-cochère with lights in front.
    g.add(mesh(new THREE.BoxGeometry(14, 0.8, 5), plain('#e8322a'), 0, 4.4, 9.5));
    for (const x of [-6, 6]) g.add(mesh(new THREE.BoxGeometry(0.5, 4.4, 0.5), plain('#f2d7a0'), x, 2.2, 11.5));
    return g;
  };

  const waterTower = (color: string) => {
    const g = new THREE.Group();
    for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) g.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 16, 6), plain('#7a6a5a'), lx, 8, lz));
    g.add(mesh(new THREE.SphereGeometry(4.2, 16, 10), plain(color), 0, 19, 0));
    g.add(mesh(new THREE.ConeGeometry(1.2, 2, 8), plain('#c8c4bc'), 0, 23.8, 0));
    return g;
  };

  const alpineHotel = () => {
    const g = new THREE.Group();
    g.add(mesh(windowBox(26, 18, 11), wall('#c84a32')));
    g.add(mesh(new THREE.BoxGeometry(27, 1.2, 12), plain('#f4f7fa'), 0, 18.6, 0));
    g.add(mesh(windowBox(10, 26, 10), wall('#e8d8b8'), 0, 0, -2));
    g.add(mesh(new THREE.ConeGeometry(8, 6, 4).rotateY(Math.PI / 4), plain('#f4f7fa'), 0, 29, -2));
    // Wooden balconies along the south face.
    for (let y = 4; y < 17; y += 3.4) g.add(mesh(new THREE.BoxGeometry(24, 0.9, 1.2), plain('#6a4a2e'), 0, y, 6.1));
    return g;
  };

  const skiJump = () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(4, 32, 4), plain('#e8e8e8'), 0, 16, 0));
    const ramp = new THREE.BoxGeometry(3, 1, 30);
    ramp.rotateX(-0.7);
    g.add(mesh(ramp, plain('#2f6fe0'), 0, 20, 10));
    g.add(mesh(new THREE.BoxGeometry(6, 3, 6), plain('#e8322a'), 0, 33.5, 0));
    return g;
  };

  const officeTower = () => {
    const g = new THREE.Group();
    const h = 28 + rnd() * 10;
    g.add(mesh(windowBox(12, h, 12, 2.4), wall('#7fb8e0')));
    g.add(mesh(new THREE.BoxGeometry(12.6, 1, 12.6), plain('#e8322a'), 0, h + 0.5, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 8, 4), plain('#dddddd'), 3, h + 4, 3));
    g.add(mesh(new THREE.BoxGeometry(14, 4, 14), plain('#5a6a7a'), 0, 2, 0));
    return g;
  };

  /** A house on its plot: garden, then the house set back from the front. */
  const homeLot = (wallColor: string, roof: string, snow: boolean, lawn: string, gw = 15 + rnd() * 3, gd = 15 + rnd() * 2) => {
    const g = new THREE.Group();
    g.add(garden(kit, gw, gd, { lawn, fence: snow ? '#6a4a2e' : choose(['#f4f0e6', '#f4f0e6', '#8a6a4a']), hedge: !snow && rnd() < 0.35, tree: snow ? '#24553a' : choose(['#3c7d34', '#4a8a3a', '#2f6b2e']) }));
    const h = house(kit, { wall: wallColor, roof, snow, w: Math.min(10, gw - 5), d: Math.min(8, gd - 6) });
    h.position.z = -1.5;
    g.add(h);
    return g;
  };

  /**
   * A little residential street: a lane with a pavement, houses on both
   * sides facing it, a street lamp or two. Returns the street and its radius.
   */
  const neighbourhood = (walls: readonly string[], roofs: readonly string[], snow: boolean, lawn: string) => {
    const g = new THREE.Group();
    const lots = 3 + Math.floor(rnd() * 3);
    const lw = 12;
    const len = lots * lw;
    g.add(decal(kit, len + 8, 6, snow ? '#c8d0d8' : '#55585e', 0, 0, 0.014));
    g.add(decal(kit, len + 8, 1.4, snow ? '#e8eef4' : '#b8b2a6', 0, -3.7, 0.016), decal(kit, len + 8, 1.4, snow ? '#e8eef4' : '#b8b2a6', 0, 3.7, 0.016));
    for (const side of [-1, 1]) {
      for (let i = 0; i < lots; i++) {
        if (rnd() < 0.12) continue;
        const lot = homeLot(choose(walls), choose(roofs), snow, lawn, lw - 0.6, 13);
        lot.position.set(-len / 2 + (i + 0.5) * lw, 0, side * (4.4 + 6.5));
        // Front to the street: north-side houses face south, south-side ones north.
        lot.rotation.y = side < 0 ? 0 : Math.PI;
        g.add(lot);
      }
    }
    return { g, r: Math.hypot(len / 2 + 4, 18) };
  };

  // ------------------------------------------------------------- layout

  const pastels = ['#f28aa0', '#5ac8c8', '#ffd84a', '#ff9a4a', '#9a7ae0', '#7ad08a', '#f0f0e8', '#6fa0ff'];
  const trims = ['#e8322a', '#2f6fe0', '#ffffff', '#2a2c30', '#f2c230'];
  const signs = ['#e8322a', '#2f6fe0', '#2f8a4a', '#f2c230', '#9a7ae0'];
  const place = (count: number, r: number, h: number, minGap: number, maxGap: number, make: () => THREE.Object3D, turn = true) => {
    let n = 0;
    for (let k = 0; k < count; k++) {
      const p = pick(r, h, minGap, maxGap);
      if (p) {
        add(make(), p[0], p[1], r, turn);
        n++;
      }
    }
    return n;
  };
  const block = (h: number, palette: readonly string[]) => apartment(kit, 10 + rnd() * 6, 9 + rnd() * 4, h, choose(palette), choose(trims));

  if (theme === 'countryside') {
    // Town: apartment blocks with shops, a few car parks among them.
    place(8, 9, 30, 4, 60, () => block(12 + Math.floor(rnd() * 6) * 3.2, pastels));
    place(4, 11, 2, 4, 70, () => carPark(kit, 20 + Math.floor(rnd() * 3) * 2.8, 14));
    // Suburbs: little streets of houses, and a few houses on their own.
    const walls = ['#f0e6d2', '#e8d0b0', '#f2f0e8', '#c8d8e8', '#f0c8b8', '#e8e0a8', '#f8f0d8'];
    const roofs = ['#c8502e', '#b8442a', '#d8683a', '#a83a2a', '#c86a3a', '#6a7078'];
    for (let k = 0; k < 6; k++) {
      const { g, r } = neighbourhood(walls, roofs, false, '#5a9a44');
      const p = pick(r, 10, 10, 130);
      if (p) add(g, p[0], p[1], r, false);
    }
    place(8, 10, 10, 8, 110, () => homeLot(choose(walls), choose(roofs), false, '#5a9a44'));
    // Farms out in the fields.
    for (let k = 0; k < 3; k++) {
      const p = pick(16, 16, 40, 160);
      if (!p) continue;
      add(farm(kit), p[0], p[1], 16);
      for (let f = 0; f < 3; f++) {
        const fp = pick(14, 2, 30, 200);
        if (fp) add(field(kit, 26 + rnd() * 10, 20 + rnd() * 8, choose([['#7a8a3a', '#9aa848'], ['#c8a850', '#d8bc68'], ['#5a7a32', '#6e9a3e'], ['#8a6a3a', '#a07a44']] as [string, string][])), fp[0], fp[1], 14, false);
      }
    }
  } else if (theme === 'desert') {
    place(1, 13, 40, 6, 70, casino);
    place(2, 5, 26, 5, 70, () => waterTower(choose(['#e8322a', '#5ac8c8', '#f0f0e8'])));
    place(1, 12, 9, 6, 60, () => gasStation(kit));
    place(2, 11, 2, 4, 70, () => carPark(kit, 22, 14));
    const adobeColors = ['#d8956a', '#e8b07a', '#c97a52', '#e8c8a0', '#f28aa0', '#5ac8c8'];
    place(20, 8, 9, 4, 110, () => adobe(kit, choose(adobeColors)));
    place(5, 9, 22, 4, 80, () => block(9.6 + Math.floor(rnd() * 3) * 3.2, adobeColors));
  } else if (theme === 'winter') {
    place(1, 15, 30, 6, 70, alpineHotel);
    place(1, 6, 34, 10, 80, skiJump);
    place(2, 11, 2, 4, 70, () => carPark(kit, 20, 14));
    const woods = ['#8a4a2a', '#9a3a2a', '#6a4a32', '#c8322a', '#2f6fe0', '#2f8a4a', '#e8b030'];
    place(16, 8, 12, 3, 110, () => chalet(kit, choose(woods)));
    for (let k = 0; k < 3; k++) {
      const { g, r } = neighbourhood(woods, ['#5a5f66'], true, '#dfe8f0');
      const p = pick(r, 10, 10, 130);
      if (p) add(g, p[0], p[1], r, false);
    }
  } else if (theme === 'brewery') {
    // Landmarks inside the loops, where every lap passes them: the brewhouse,
    // the giant mug and a beer tent. Then the yard, festival and pubs around.
    const at = (make: () => THREE.Object3D, x: number, z: number, r: number, h: number) => {
      if (far(x, z) > clear + r && free(x, z, r) && !hidesRoad(x, z, r, h)) add(make(), x, z, r, false);
    };
    for (const lm of track.def.landmarks ?? []) {
      const make = lm.kind === 'brewhouse' ? () => brewhouse(kit) : lm.kind === 'mug' ? () => giantMug(kit) : () => beerTent(kit);
      const [r, h] = lm.kind === 'brewhouse' ? [18, 26] : lm.kind === 'mug' ? [7, 16] : [13, 7];
      at(make, lm.x, lm.z, r, h);
    }
    place(1, 18, 26, 6, 60, () => brewhouse(kit));
    place(3, 9, 18, 6, 80, () => maltSilos(kit));
    place(7, 13, 7, 3, 90, () => beerTent(kit));
    place(16, 3.5, 4, 1, 50, () => barrelStack(kit));
    place(5, 5, 4, 2, 60, () => beerTruck(kit));
    place(12, 9, 10, 3, 100, () => pub(kit, choose(['#f0e6d2', '#e8d0b0', '#f8f0d8', '#c8d8b8', '#f0c8a0'])));
    place(2, 11, 2, 4, 70, () => carPark(kit, 20, 14));
    for (let k = 0; k < 7; k++) {
      const p = pick(16, 7, 20, 160);
      if (p) add(hopGarden(kit, 24 + Math.floor(rnd() * 3) * 4, 15), p[0], p[1], 16, false);
    }
    // Barley fields further out.
    for (let k = 0; k < 6; k++) {
      const p = pick(16, 2, 40, 200);
      if (p) add(field(kit, 28 + rnd() * 10, 20 + rnd() * 8, rnd() < 0.6 ? ['#c8a850', '#d8bc68'] : ['#7a8a3a', '#9aa848']), p[0], p[1], 16, false);
    }
  } else if (theme === 'tivoli') {
    // The big rides inside the circuit, where every lap passes them; stalls,
    // balloons, a coaster and a drop tower around the outside.
    const at = (make: () => THREE.Object3D, x: number, z: number, r: number, h: number) => {
      if (far(x, z) > clear + r && free(x, z, r) && !hidesRoad(x, z, r, h)) add(make(), x, z, r, false);
    };
    for (const lm of track.def.landmarks ?? []) {
      const make = lm.kind === 'ferriswheel' ? () => ferrisWheel(kit) : lm.kind === 'carousel' ? () => carousel(kit) : () => bigTop(kit);
      const [r, h] = lm.kind === 'ferriswheel' ? [11, 34] : lm.kind === 'carousel' ? [8, 10] : [12, 12];
      at(make, lm.x, lm.z, r, h);
    }
    place(2, 16, 10, 6, 70, () => rollerCoaster(kit, 30));
    place(1, 5, 32, 8, 90, () => dropTower(kit));
    place(2, 12, 12, 8, 120, () => bigTop(kit));
    place(2, 8, 10, 6, 90, () => carousel(kit));
    place(2, 6, 10, 4, 60, () => carousel(kit));
    place(30, 4, 4, 1, 60, () => stall(kit, choose(FAIR)));
    place(16, 2, 6, 1, 50, () => balloons(kit));
    place(2, 11, 2, 4, 70, () => carPark(kit, 20, 14));
  } else if (theme === 'cigar') {
    // The big three on the north side, behind the start straight where every
    // lap passes them: the factory, the giant cigar and the humidor. Barns,
    // stacks of cigar boxes and tobacco fields round the rest.
    const at = (make: () => THREE.Object3D, x: number, z: number, r: number, h: number) => {
      if (far(x, z) > clear + r && free(x, z, r) && !hidesRoad(x, z, r, h)) add(make(), x, z, r, false);
    };
    for (const lm of track.def.landmarks ?? []) {
      const make = lm.kind === 'factory' ? () => cigarFactory(kit) : lm.kind === 'cigar' ? () => giantCigar(kit) : () => humidor(kit);
      const [r, h] = lm.kind === 'factory' ? [16, 36] : lm.kind === 'cigar' ? [14, 16] : [13, 12];
      at(make, lm.x, lm.z, r, h);
    }
    place(14, 6.5, 8, 3, 90, () => dryingBarn(kit, choose(['#6a3a22', '#5a5f66', '#8a4a2a'])));
    place(14, 3.5, 4, 1, 60, () => cigarBoxes(kit));
    place(2, 11, 2, 4, 70, () => carPark(kit, 20, 14));
    // Tobacco fields further out.
    for (let k = 0; k < 8; k++) {
      const p = pick(16, 2, 30, 200);
      if (p) add(field(kit, 28 + rnd() * 10, 20 + rnd() * 8, rnd() < 0.6 ? ['#5a7a2a', '#7a9a38'] : ['#6a8a30', '#8aa83e']), p[0], p[1], 16, false);
    }
  } else if (theme === 'nuclear') {
    place(4, 9, 38, 6, 80, officeTower);
    place(5, 15, 12, 4, 110, () => warehouse(kit, choose(['#c8ccd0', '#d8d4c8', '#9fa6a8', '#5ac8c8'])));
    place(4, 12, 2, 4, 80, () => carPark(kit, 24, 14));
    place(4, 8, 20, 4, 90, () => block(9.6 + Math.floor(rnd() * 3) * 3.2, ['#c8ccd0', '#f2c230', '#5ac8c8', '#e8e8e0']));
  }
  // Street frontage: walk along the track and line it with buildings just
  // behind the barriers - as tall as the camera allows at each spot.
  const palette = theme === 'desert'
    ? ['#d8956a', '#e8b07a', '#c97a52', '#5ac8c8', '#f28aa0', '#ffd84a']
    : theme === 'winter'
      ? ['#c8322a', '#e8b030', '#2f6fe0', '#2f8a4a', '#e86a2a', '#f0f0e8']
      : theme === 'brewery'
        ? ['#a8462e', '#f0e6d2', '#e8a020', '#2f6fe0', '#2f8a4a', '#f8f0d8']
        : theme === 'tivoli'
        ? FAIR
        : theme === 'cigar'
        ? ['#6a3a22', '#5a5f66', '#8a4a2a']
        : theme === 'nuclear'
        ? ['#c8ccd0', '#f2c230', '#5ac8c8', '#e8e8e0', '#9fa6a8']
        : pastels;
  const street = (h: number, color: string): THREE.Object3D => {
    if (theme === 'tivoli') return h < 8 ? stall(kit, color) : balloons(kit);
    if (theme === 'cigar') return h < 5 ? cigarBoxes(kit) : dryingBarn(kit, color);
    if (theme === 'winter' && h < 14) return chalet(kit, color);
    if (theme === 'brewery' && h < 14) return pub(kit, color);
    if (h < 10) return shopFront(kit, 9 + rnd() * 4, 8, theme === 'desert' ? color : shade(color, 1), choose(signs));
    return block(h, [color]);
  };
  const heights = theme === 'tivoli' || theme === 'cigar' ? [6.4, 4] : theme === 'winter' ? [22.4, 16, 12.8, 9.6, 6.4] : theme === 'brewery' ? [16, 9.6, 6.4] : [28.8, 22.4, 16, 12.8, 9.6, 6.4];
  for (let i = 0; i < track.n; i += 30) {
    for (const side of [-1, 1]) {
      if (rnd() > 0.7) continue;
      const r = 6.5;
      const gap = 2 + rnd() * 7;
      const off = (track.hw[i] + track.def.runoff + 1 + gap + r) * side;
      const x = track.px[i] + track.nx[i] * off;
      const z = track.pz[i] + track.nz[i] * off;
      if (distanceToCentreline(track, x, z) < clear + r - 0.5 || !free(x, z, r)) continue;
      const h = heights.find((hh) => !hidesRoad(x, z, r, hh));
      if (h === undefined) continue;
      const obj = street(h - (rnd() < 0.5 ? 3.2 : 0), choose(palette));
      add(obj, x, z, r, false);
      // Square to the track, front (shops, balconies) toward the track or
      // away from it - whichever is more southerly, where the camera sees it.
      const along = Math.atan2(-track.tz[i], track.tx[i]);
      obj.rotation.y = Math.cos(along) >= 0 ? along : along + Math.PI;
    }
  }
  return { group, keepOut, windows };
}
