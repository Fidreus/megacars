// Tall, colourful buildings around every track, in the style of its theme:
// pastel apartment blocks in the countryside, a casino hotel and water tower
// in the desert, painted wooden houses, an alpine hotel and a ski jump in
// the snow, glass offices at the power plant. Windows light up at night.
// Tall things only go where they can't hide the road from the tilted camera.

import * as THREE from 'three';
import { distanceToCentreline } from '../../shared/track/builder.ts';
import type { Track } from '../../shared/track/types.ts';
import { makeRng } from '../../shared/math/rng.ts';
import { toon } from './materials.ts';
import type { KeepOut } from './props.ts';

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

/** A box whose side faces tile one window every `cell` metres; the roof is plain wall. */
function windowBox(w: number, h: number, d: number, cell = 3.2): THREE.BufferGeometry {
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
  const plain = (color: string) => toon(color);

  const free = (x: number, z: number, r: number) =>
    ![...existing, ...keepOut].some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < (k.r + r) ** 2);
  // The camera looks north at 57°: h metres of height hide ~0.65·h of ground north of it.
  const hidesRoad = (x: number, z: number, r: number, h: number) => {
    for (let dz = r; dz >= -r - h * 0.65; dz -= 2) {
      for (const dx of [-r, 0, r]) if (distanceToCentreline(track, x + dx, z + dz) < clear) return true;
    }
    return false;
  };
  const pick = (r: number, h: number, minGap: number, maxGap: number, tries = 300): [number, number] | null => {
    for (let t = 0; t < tries; t++) {
      const x = b.minX - pad + rnd() * (b.maxX - b.minX + pad * 2);
      const z = b.minZ - pad + rnd() * (b.maxZ - b.minZ + pad * 2);
      const d = distanceToCentreline(track, x, z);
      if (d < clear + r + minGap || d > clear + r + maxGap) continue;
      if (!free(x, z, r) || hidesRoad(x, z, r, h)) continue;
      return [x, z];
    }
    return null;
  };
  const add = (obj: THREE.Object3D, x: number, z: number, r: number, turn = true) => {
    obj.position.set(x, 0, z);
    if (turn) obj.rotation.y = Math.floor(rnd() * 4) * (Math.PI / 2) + (rnd() - 0.5) * 0.2;
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
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

  /** Apartment block: windows all over, a coloured roof edge and rooftop clutter. */
  const block = (w: number, d: number, h: number, color: string, trim: string) => {
    const g = new THREE.Group();
    g.add(mesh(windowBox(w, h, d), wall(color)));
    g.add(mesh(new THREE.BoxGeometry(w + 0.4, 0.6, d + 0.4), plain(trim), 0, h + 0.3, 0));
    if (rnd() < 0.6) g.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 10), plain('#c8c4bc'), w * 0.25, h + 1.7, d * 0.2));
    if (rnd() < 0.7) g.add(mesh(new THREE.BoxGeometry(2, 1.2, 1.4), plain('#9aa0a6'), -w * 0.25, h + 1.2, -d * 0.2));
    return g;
  };

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
    return g;
  };

  const waterTower = (color: string) => {
    const g = new THREE.Group();
    for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) g.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 16, 6), plain('#7a6a5a'), lx, 8, lz));
    g.add(mesh(new THREE.SphereGeometry(4.2, 16, 10), plain(color), 0, 19, 0));
    g.add(mesh(new THREE.ConeGeometry(1.2, 2, 8), plain('#c8c4bc'), 0, 23.8, 0));
    return g;
  };

  /** Painted wooden house with a steep roof (snow-capped in winter). */
  const woodHouse = (color: string, snow: boolean) => {
    const g = new THREE.Group();
    const w = 7 + rnd() * 3;
    const d = 6 + rnd() * 2;
    const h = 6 + rnd() * 5;
    g.add(mesh(windowBox(w, h, d, 2.6), wall(color)));
    const roof = new THREE.CylinderGeometry(0.01, d * 0.78, 4.5, 4, 1).rotateY(Math.PI / 4);
    roof.scale(w / d, 1, 1);
    g.add(mesh(roof.toNonIndexed(), plain(snow ? '#f4f7fa' : '#3a3a40'), 0, h + 2.25, 0));
    return g;
  };

  const alpineHotel = () => {
    const g = new THREE.Group();
    g.add(mesh(windowBox(26, 18, 11), wall('#c84a32')));
    g.add(mesh(new THREE.BoxGeometry(27, 1.2, 12), plain('#f4f7fa'), 0, 18.6, 0));
    g.add(mesh(windowBox(10, 26, 10), wall('#e8d8b8'), 0, 0, -2));
    g.add(mesh(new THREE.ConeGeometry(8, 6, 4).rotateY(Math.PI / 4), plain('#f4f7fa'), 0, 29, -2));
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
    return g;
  };

  // ------------------------------------------------------------- layout

  const pastels = ['#f28aa0', '#5ac8c8', '#ffd84a', '#ff9a4a', '#9a7ae0', '#7ad08a', '#f0f0e8', '#6fa0ff'];
  const trims = ['#e8322a', '#2f6fe0', '#ffffff', '#2a2c30', '#f2c230'];
  const place = (count: number, r: number, h: number, minGap: number, maxGap: number, make: () => THREE.Object3D, turn = true) => {
    for (let k = 0; k < count; k++) {
      const p = pick(r, h, minGap, maxGap);
      if (p) add(make(), p[0], p[1], r, turn);
    }
  };

  if (theme === 'countryside') {
    // A small town of colourful blocks, some close enough to tower over the action.
    place(10, 9, 30, 4, 60, () => block(10 + rnd() * 6, 9 + rnd() * 4, 12 + Math.floor(rnd() * 6) * 3.2, choose(pastels), choose(trims)));
    place(14, 7, 16, 6, 110, () => block(8 + rnd() * 4, 7 + rnd() * 3, 6.4 + Math.floor(rnd() * 3) * 3.2, choose(pastels), choose(trims)));
  } else if (theme === 'desert') {
    place(1, 13, 40, 6, 70, casino);
    place(2, 5, 26, 5, 70, () => waterTower(choose(['#e8322a', '#5ac8c8', '#f0f0e8'])));
    const adobe = ['#d8956a', '#e8b07a', '#c97a52', '#5ac8c8', '#f28aa0'];
    place(12, 8, 18, 4, 90, () => block(9 + rnd() * 6, 8 + rnd() * 4, 6.4 + Math.floor(rnd() * 4) * 3.2, choose(adobe), choose(['#5ac8c8', '#f2c230', '#e8322a'])));
  } else if (theme === 'winter') {
    place(1, 15, 30, 6, 70, alpineHotel);
    place(1, 6, 34, 10, 80, skiJump);
    const woods = ['#c8322a', '#e8b030', '#2f6fe0', '#2f8a4a', '#e86a2a', '#f0f0e8'];
    place(18, 6, 13, 3, 90, () => woodHouse(choose(woods), true));
  } else if (theme === 'nuclear') {
    place(4, 9, 38, 6, 80, officeTower);
    place(6, 8, 20, 4, 90, () => block(10 + rnd() * 6, 9 + rnd() * 3, 9.6 + Math.floor(rnd() * 3) * 3.2, choose(['#c8ccd0', '#f2c230', '#5ac8c8', '#e8e8e0']), '#e8322a'));
  }
  // Street frontage: walk along the track and line it with buildings just
  // behind the barriers - as tall as the camera allows at each spot.
  const street = (h: number, color: string): THREE.Object3D => {
    if (theme === 'winter' && h < 14) return woodHouse(color, true);
    return block(9 + rnd() * 5, 7 + rnd() * 3, h, color, choose(trims));
  };
  const palette = theme === 'desert'
    ? ['#d8956a', '#e8b07a', '#c97a52', '#5ac8c8', '#f28aa0', '#ffd84a']
    : theme === 'winter'
      ? ['#c8322a', '#e8b030', '#2f6fe0', '#2f8a4a', '#e86a2a', '#f0f0e8']
      : theme === 'nuclear'
        ? ['#c8ccd0', '#f2c230', '#5ac8c8', '#e8e8e0', '#9fa6a8']
        : pastels;
  const heights = theme === 'winter' ? [22.4, 16, 12.8, 9.6, 6.4] : [28.8, 22.4, 16, 12.8, 9.6, 6.4];
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
      obj.rotation.y = Math.atan2(-track.tz[i], track.tx[i]);
    }
  }
  return { group, keepOut, windows };
}
