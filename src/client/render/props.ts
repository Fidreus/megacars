// Trackside props placed from the track geometry: grandstands with an animated
// crowd, sponsor boards, tyre stacks on corner exits, street lamps (with light
// pools at night), waving flags and a pond.

import * as THREE from 'three';
import { distanceToCentreline } from '../../shared/track/builder.ts';
import { PIT } from '../../shared/track/pit.ts';
import type { Track } from '../../shared/track/types.ts';
import { makeRng } from '../../shared/math/rng.ts';
import { drawText } from '../ui/font.ts';
import { themeOf } from './theme.ts';
import { animTime, toon } from './materials.ts';
import { mergeGeometries } from './trackMesh.ts';

export interface KeepOut {
  x: number;
  z: number;
  r: number;
}

export interface Props {
  group: THREE.Group;
  /** Objects only visible when lights are on (night, sunset). */
  nightLights: THREE.Object3D[];
  /** Lamp bulb material (brightened at night). */
  bulbs: THREE.MeshBasicMaterial;
  /** Light-pool material (colour scaled by the mood's lamp strength). */
  pools: THREE.MeshBasicMaterial;
  keepOut: KeepOut[];
}

interface Straight {
  i0: number;
  i1: number;
  length: number;
}

/** Runs of zero curvature at least `minLen` metres long. */
function straights(track: Track, minLen: number): Straight[] {
  const out: Straight[] = [];
  const n = track.n;
  // Start scanning at a curved sample so a straight across s=0 stays in one piece.
  let start = 0;
  while (start < n && Math.abs(track.curv[start]) < 1e-9) start++;
  let i = 0;
  while (i < n) {
    const a = (start + i) % n;
    if (Math.abs(track.curv[a]) >= 1e-9) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && Math.abs(track.curv[(start + j) % n]) < 1e-9) j++;
    const i0 = a;
    const i1 = (start + j - 1) % n;
    const len = j - i;
    if (len >= minLen) out.push({ i0, i1, length: len });
    i = j;
  }
  return out;
}

/** Point at `along` metres from sample i0 (along the tangent) and `off` metres to the side. */
function frame(track: Track, i0: number, along: number, off: number) {
  const tx = track.tx[i0], tz = track.tz[i0];
  const nx = track.nx[i0], nz = track.nz[i0];
  return { x: track.px[i0] + tx * along + nx * off, z: track.pz[i0] + tz * along + nz * off, tx, tz, nx, nz };
}

const SPONSORS: [string, string, string][] = [
  ['TURBO OIL', '#c8261f', '#ffd84a'],
  ['MEGA COLA', '#1d3c8f', '#ffffff'],
  ['AMIGO TYRES', '#111111', '#f2c230'],
  ['PIXEL PETROL', '#2fae4e', '#ffffff'],
  ['BYTE BANK', '#f07a1a', '#111111'],
  ['BLITTER BOOST', '#7a2fae', '#ffd84a'],
];

function boardTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 80;
  c.height = 12;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 80, 12);
  ctx.fillStyle = fg;
  ctx.fillRect(0, 0, 80, 1);
  ctx.fillRect(0, 11, 80, 1);
  drawText(ctx, text, 40, 3, { color: fg, shadow: null, align: 'center' });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** True when a surface facing (nx, nz) can be seen by the north-facing camera. */
function facesCamera(nx: number, nz: number): boolean {
  void nx;
  return nz > 0.5;
}

export function buildProps(track: Track): Props {
  const group = new THREE.Group();
  group.name = 'props';
  const nightLights: THREE.Object3D[] = [];
  const keepOut: KeepOut[] = [];
  const rnd = makeRng((track.def.seed ?? 1) * 4241);
  const wallOff = track.def.width / 2 + track.def.runoff;
  const runs = straights(track, 40);

  // --- Grandstand on the far side of the straight through the start line.
  const main = runs.find((r) => r.i0 > r.i1 || r.i0 === 0) ?? runs.reduce((a, b) => (b.length > a.length ? b : a), runs[0]);
  if (main) {
    const side = facesCamera(track.nx[main.i0], track.nz[main.i0]) ? 1 : -1; // outward toward the far side
    // The far side is where the inward normal faces the camera, i.e. outward = -camera.
    const out = -side;
    const startAlong = Math.max(0, (main.i0 > main.i1 ? track.n - main.i0 : 0) - 45);
    const len = Math.min(70, main.length - 10);
    // Behind the pit garages when the pit lane is on this side.
    const pit = track.pit;
    const base = pit && pit.side === out ? pit.pitOff + PIT.laneHalf + PIT.garage + 1 : wallOff + 3;
    buildGrandstand(group, track, main.i0, startAlong, len, out, base, keepOut);
  }

  // --- Sponsor boards facing the camera along straights.
  const boardMats = (themeOf(track.def.theme).sponsors ?? SPONSORS).map(([t, bg, fg]) => toon('#ffffff', { map: boardTexture(t, bg, fg) }));
  const legMat = toon('#55585e');
  // A-frame boards leaning back ~40° so they face the high camera and stay readable.
  const boardGeo = new THREE.BoxGeometry(15, 2.4, 0.2);
  const legGeo = new THREE.BoxGeometry(0.15, 1.6, 0.15);
  let sponsor = 0;
  for (const r of runs) {
    for (const sgn of [1, -1]) {
      // Inward normal of the boards on this side is -sgn·n.
      if (!facesCamera(-sgn * track.nx[r.i0], -sgn * track.nz[r.i0])) continue;
      for (let a = 22; a < r.length - 18; a += 44) {
        const f = frame(track, r.i0, a, sgn * (wallOff + 2.2));
        // Not under or beside a bridge, and never on another stretch of road.
        if (track.deck[(r.i0 + Math.round(a)) % track.n] !== 0 || distanceToCentreline(track, f.x, f.z) < wallOff + 1.5) continue;
        const g = new THREE.Group();
        const board = new THREE.Mesh(boardGeo, boardMats[sponsor++ % boardMats.length]);
        board.position.set(0, 1.0, 0.5);
        board.rotation.x = -0.7;
        board.castShadow = true;
        g.add(board);
        for (const x of [-6.5, 6.5]) {
          const leg = new THREE.Mesh(legGeo, legMat);
          leg.position.set(x, 0.8, -0.3);
          g.add(leg);
        }
        g.position.set(f.x, 0, f.z);
        g.rotation.y = Math.atan2(-sgn * f.nx, -sgn * f.nz);
        group.add(g);
      }
    }
  }

  // --- Tyre stacks outside tight corners.
  const tyreGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.32, 8);
  const tyres = new THREE.InstancedMesh(tyreGeo, toon('#ffffff'), 3000);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let nt = 0;
  let lastPlaced = -10;
  for (let i = 0; i < track.n && nt < 2990; i++) {
    const k = track.curv[i];
    if (Math.abs(k) < 1 / 60 || track.s[i] - lastPlaced < 1.2) continue;
    lastPlaced = track.s[i];
    const outSide = k > 0 ? -1 : 1;
    const off = outSide * (wallOff + 1.35);
    const x = track.px[i] + track.nx[i] * off;
    const z = track.pz[i] + track.nz[i] * off;
    for (let h = 0; h < 3; h++) {
      dummy.position.set(x, 0.16 + h * 0.32, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      tyres.setMatrixAt(nt, dummy.matrix);
      const stack = Math.floor(track.s[i] / 1.2);
      const top = stack % 2 === 0 ? '#e8e6e0' : '#d42a24';
      tyres.setColorAt(nt++, col.set(h === 2 ? top : '#1e1e22'));
    }
  }
  tyres.count = nt;
  tyres.castShadow = true;
  tyres.receiveShadow = true;
  group.add(tyres);

  // --- Street lamps with light pools.
  const bulbs = new THREE.MeshBasicMaterial({ color: '#8a8a80' });
  const poleMat = toon('#4a4e56');
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6).translate(0, 3.5, 0);
  const armGeo = new THREE.BoxGeometry(0.12, 0.12, 3.2).translate(0, 6.9, -1.5);
  const headGeo = new THREE.BoxGeometry(0.5, 0.2, 0.9).translate(0, 6.8, -3.0);
  const poolTex = radialTexture();
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex, color: new THREE.Color(0.85, 0.72, 0.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const poolGeo = new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2);
  for (let s = 20; s < track.length - 10; s += 58) {
    const i = Math.floor((s / track.length) * track.n);
    const sgn = facesCamera(track.nx[i], track.nz[i]) ? -1 : 1; // lamps on the far side
    const off = sgn * (wallOff + 1.2);
    const x = track.px[i] + track.nx[i] * off;
    const z = track.pz[i] + track.nz[i] * off;
    if (track.deck[i] !== 0 || distanceToCentreline(track, x, z) < wallOff + 0.8) continue;
    const lamp = new THREE.Group();
    for (const [geo, mat] of [[poleGeo, poleMat], [armGeo, poleMat], [headGeo, bulbs]] as const) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      lamp.add(m);
    }
    lamp.position.set(x, 0, z);
    // Arm points toward the road (local -z → inward).
    lamp.rotation.y = Math.atan2(sgn * track.nx[i], sgn * track.nz[i]);
    group.add(lamp);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.set(x - sgn * track.nx[i] * 3, 0.05, z - sgn * track.nz[i] * 3);
    pool.renderOrder = 2;
    pool.visible = false;
    nightLights.push(pool);
    group.add(pool);
  }

  // --- A pond somewhere quiet.
  const theme = themeOf(track.def.theme);
  const pond = theme.pond === 'none' ? null : findPondSpot(track, rnd);
  if (pond) {
    group.add(buildPond(pond.x, pond.z, pond.r, rnd, theme.pond === 'ice', theme.shore));
    keepOut.push({ x: pond.x, z: pond.z, r: pond.r + 4 });
  }
  return { group, nightLights, bulbs, pools: poolMat, keepOut };
}

function buildGrandstand(
  group: THREE.Group, track: Track, i0: number, startAlong: number, len: number, out: number, base: number, keepOut: KeepOut[],
): void {
  const tiers = 6;
  const depth = 1.3;
  const rise = 0.75;
  const f0 = frame(track, i0, startAlong + len / 2, 0);
  const g = new THREE.Group();
  // Local frame: x along the straight, z away from the track.
  const concrete: THREE.BufferGeometry[] = [];
  const seats: THREE.BufferGeometry[] = [];
  for (let k = 0; k < tiers; k++) {
    const h = (k + 1) * rise;
    concrete.push(new THREE.BoxGeometry(len, h, depth).translate(0, h / 2, base + (k + 0.5) * depth));
    seats.push(new THREE.BoxGeometry(len, 0.12, 0.45).translate(0, h + 0.06, base + k * depth + 0.25));
  }
  const back = base + tiers * depth;
  concrete.push(new THREE.BoxGeometry(len, 8.2, 0.4).translate(0, 4.1, back + 0.2));
  const add = (geos: THREE.BufferGeometry[], color: string) => {
    const m = new THREE.Mesh(mergeGeometries(geos), toon(color));
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  add(concrete, '#b8b6ae');
  add(seats, '#2f5fb8');
  // Narrow canopy over the back rows only, so the crowd stays visible from above.
  const canopyDepth = depth * 2.2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 1, 0.3, canopyDepth), toon('#c8261f'));
  roof.position.set(0, 8.2, back - canopyDepth / 2 + 0.4);
  roof.castShadow = true;
  g.add(roof);
  for (let x = -len / 2; x <= len / 2 + 0.01; x += len / 6) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 8.2, 0.25), toon('#6e6e6c'));
    post.position.set(x, 4.1, back - canopyDepth + 0.6);
    post.castShadow = true;
    g.add(post);
  }

  // Crowd: small figures on every tier, bobbing (cheering) on the GPU.
  const count = Math.floor((len / 0.75) * tiers);
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.75, 0.36).translate(0, 0.38, 0), toon('#ffffff'), count);
  const shirts = ['#e8322a', '#2f6fe0', '#f2c230', '#ffffff', '#2fae4e', '#f07a1a', '#9a45d8', '#222222', '#e88aa0'];
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  const rnd = makeRng(99);
  let n = 0;
  for (let k = 0; k < tiers; k++) {
    for (let x = -len / 2 + 0.5; x < len / 2 - 0.4 && n < count; x += 0.75) {
      if (rnd() < 0.18) continue;
      dummy.position.set(x + (rnd() - 0.5) * 0.2, (k + 1) * rise + 0.1, base + k * depth + 0.75);
      dummy.updateMatrix();
      crowd.setMatrixAt(n, dummy.matrix);
      crowd.setColorAt(n++, c.set(shirts[Math.floor(rnd() * shirts.length)]));
    }
  }
  crowd.count = n;
  crowd.castShadow = true;
  const mat = crowd.material as THREE.MeshToonMaterial;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = animTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float id = float(gl_InstanceID);
        float ph = fract(sin(id * 12.9898) * 43758.5453);
        transformed.y += max(0.0, sin(uTime * (5.0 + ph * 4.0) + ph * 30.0)) * 0.22 * step(0.35, ph);`,
      );
  };
  g.add(crowd);

  // Flags along the roof edge.
  const flagGeo = new THREE.PlaneGeometry(1.4, 0.8, 6, 1).translate(0.7, 0, 0);
  const flagColors = ['#e8322a', '#ffd84a', '#2f6fe0', '#ffffff', '#2fae4e'];
  for (let i = 0; i < 6; i++) {
    const x = -len / 2 + (i + 0.5) * (len / 6);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4), toon('#dddddd'));
    pole.position.set(x, 9.5, back - canopyDepth + 0.6);
    g.add(pole);
    const fm = toon(flagColors[i % flagColors.length], { side: THREE.DoubleSide });
    fm.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = animTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed.z += sin(uTime * 7.0 + position.x * 3.5 + ${i}.0) * 0.18 * position.x;`);
    };
    const flag = new THREE.Mesh(flagGeo, fm);
    flag.position.set(x, 10.3, back - canopyDepth + 0.6);
    flag.castShadow = true;
    g.add(flag);
  }

  g.position.set(f0.x, 0, f0.z);
  // Local +x along the track tangent, local +z outward (out·n).
  const ox = track.nx[i0] * out;
  const oz = track.nz[i0] * out;
  g.rotation.y = Math.atan2(ox, oz);
  // atan2 above maps local +z onto the outward normal; the tangent then follows.
  group.add(g);
  for (let a = -len / 2; a <= len / 2; a += 10) {
    keepOut.push({ x: f0.x + track.tx[i0] * a + ox * (base + 5), z: f0.z + track.tz[i0] * a + oz * (base + 5), r: 9 });
  }
}

function radialTexture(): THREE.CanvasTexture {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
      const a = Math.max(0, 1 - d) ** 1.6;
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(a * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function findPondSpot(track: Track, rnd: () => number): KeepOut | null {
  const b = track.bounds;
  const clear = track.def.width / 2 + track.def.runoff + 12;
  for (let t = 0; t < 400; t++) {
    const r = 14 + rnd() * 10;
    const x = b.minX + 20 + rnd() * (b.maxX - b.minX - 40);
    const z = b.minZ + 20 + rnd() * (b.maxZ - b.minZ - 40);
    let ok = true;
    for (let a = 0; a < 16 && ok; a++) {
      const ang = (a / 16) * Math.PI * 2;
      if (distanceToCentreline(track, x + Math.cos(ang) * r, z + Math.sin(ang) * r) < clear) ok = false;
    }
    if (ok && distanceToCentreline(track, x, z) > r + clear) return { x, z, r };
  }
  return null;
}

function buildPond(x: number, z: number, r: number, rnd: () => number, frozen = false, shoreColor = '#b49a68'): THREE.Group {
  const g = new THREE.Group();
  const seg = 28;
  const radii = Array.from({ length: seg }, () => r * (0.85 + rnd() * 0.25));
  const ring = (scale: number, y: number, edgeAttr: boolean) => {
    const pos: number[] = [x, y, z];
    const edge: number[] = [0];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(x + Math.cos(a) * radii[i] * scale, y, z + Math.sin(a) * radii[i] * scale);
      edge.push(1);
    }
    const idx: number[] = [];
    for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    if (edgeAttr) geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
    geo.setIndex(idx);
    return geo;
  };
  const shore = new THREE.Mesh(ring(1.18, -0.03, false), toon(shoreColor));
  shore.receiveShadow = true;
  g.add(shore);
  if (frozen) {
    const ice = new THREE.Mesh(ring(1, 0.0, false), toon('#bfe3f2'));
    ice.receiveShadow = true;
    g.add(ice);
    return g;
  }
  const mat = toon('#2f6f9f');
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = animTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;\nvarying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;\nvXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vEdge;\nvarying vec2 vXZ;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float w = sin(vXZ.x * 0.7 + vXZ.y * 0.4 + uTime * 1.6) + sin(vXZ.x * -0.5 + vXZ.y * 0.9 - uTime * 1.1);
          float band = floor(w * 1.5 + 0.5) / 3.0;
          diffuseColor.rgb *= 0.9 + 0.12 * band;
          if (band > 0.6) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.78, 0.9), 0.5);
          if (vEdge > 0.9 + 0.04 * sin(uTime * 2.0 + vXZ.x)) diffuseColor.rgb = vec3(0.82, 0.88, 0.9);
        }`,
      );
  };
  const water = new THREE.Mesh(ring(1, 0.0, true), mat);
  water.receiveShadow = true;
  g.add(water);
  return g;
}
