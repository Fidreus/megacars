// Track geometry: ground, road strip (with a procedural shader so markings,
// curbs and surface patches line up exactly with the physics), barriers and
// the start/finish gantry.

import * as THREE from 'three';
import { Surface } from '../../shared/config/surfaces.ts';
import { patchShape } from '../../shared/track/patchShape.ts';
import type { Track } from '../../shared/track/types.ts';
import { buildRamps } from './rampMesh.ts';
import { buildBridges } from './bridgeMesh.ts';
import { themeOf } from './theme.ts';
import { toon } from './materials.ts';

export const SURFACE_COLORS: Record<number, string> = {
  [Surface.Asphalt]: '#3c3d44',
  [Surface.Curb]: '#d8d8d8',
  [Surface.Wet]: '#2d3139',
  [Surface.Gravel]: '#b49a68',
  [Surface.Grass]: '#4c8a3a',
  [Surface.Snow]: '#e9eef5',
  [Surface.Ice]: '#a8d8f0',
  [Surface.Oil]: '#121216',
  [Surface.ShallowWater]: '#3f80aa',
  [Surface.DeepWater]: '#23507a',
};

const MAX_PATCHES = 16;

/** GLSL helpers: cheap hash and value noise. */
const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** Adds a world-position varying to a built-in material's shaders. */
function withWorldPos(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${NOISE_GLSL}`);
}

export function buildTrackView(track: Track): THREE.Group {
  const group = new THREE.Group();
  group.name = 'track';
  group.add(buildGround(track));
  group.add(buildRoad(track));
  group.add(buildWalls(track));
  group.add(buildStartGantry(track));
  group.add(buildGridMarks(track));
  group.add(buildRamps(track));
  const bridges = buildBridges(track);
  if (bridges) group.add(bridges);
  return group;
}

function buildGround(track: Track): THREE.Mesh {
  const b = track.bounds;
  const pad = 500;
  const geo = new THREE.PlaneGeometry(b.maxX - b.minX + pad * 2, b.maxZ - b.minZ + pad * 2);
  geo.rotateX(-Math.PI / 2);
  geo.translate((b.minX + b.maxX) / 2, -0.06, (b.minZ + b.maxZ) / 2);
  const mat = toon(themeOf(track.def.theme).ground);
  mat.onBeforeCompile = (shader) => {
    withWorldPos(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float n = hash12(floor(vWPos.xz * 2.0));
        float big = valueNoise(vWPos.xz * 0.045);
        float mid = valueNoise(vWPos.xz * 0.21 + 17.0);
        float k = 0.80 + 0.22 * big + 0.08 * mid;
        if (n > 0.94) k += 0.13;
        if (n < 0.04) k -= 0.12;
        diffuseColor.rgb *= k;
      }`,
    );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

function buildRoad(track: Track): THREE.Mesh {
  const { n, px, pz, nx, nz, hw, s, curv } = track;
  const runoff = track.def.runoff;
  const verts = (n + 1) * 2;
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const road = new Float32Array(verts * 4);
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    const reach = hw[i] + runoff;
    const sv = k === n ? track.length : s[i];
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? -1 : 1;
      const v = k * 2 + side;
      pos[v * 3] = px[i] + nx[i] * reach * sgn;
      pos[v * 3 + 1] = track.elev[i];
      pos[v * 3 + 2] = pz[i] + nz[i] * reach * sgn;
      nrm[v * 3 + 1] = 1;
      road[v * 4] = reach * sgn;
      road[v * 4 + 1] = sv;
      road[v * 4 + 2] = hw[i];
      road[v * 4 + 3] = curv[i];
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    // No road over the hole of a broken bridge.
    if (track.deck[k] === 3 || track.deck[(k + 1) % n] === 3) continue;
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aRoad', new THREE.BufferAttribute(road, 4));
  geo.setIndex(idx);

  const patches = (track.def.patches ?? []).slice(0, MAX_PATCHES);
  // Same outlines as the physics grid (patchShape.ts).
  const shapes = patches.map((p, k) => patchShape(p, k, track.def.seed ?? 0));
  const patchData = Array.from({ length: MAX_PATCHES }, (_, k) =>
    k < patches.length ? new THREE.Vector4(patches[k].x, patches[k].z, patches[k].r, patches[k].runoff ? 1 : 0) : new THREE.Vector4(),
  );
  const patchColors = Array.from({ length: MAX_PATCHES }, (_, k) =>
    new THREE.Color(k < patches.length ? (themeOf(track.def.theme).patchColors?.[patches[k].surface] ?? SURFACE_COLORS[patches[k].surface]) : '#000'),
  );
  const uniforms = {
    uPatch: { value: patchData },
    uPatchColor: { value: patchColors },
    uPatchCount: { value: patches.length },
    uPatchRect: { value: Array.from({ length: MAX_PATCHES }, (_, k) => new THREE.Vector2(patches[k]?.hx ?? 0, patches[k]?.hz ?? 0)) },
    uPatchShapeA: { value: Array.from({ length: MAX_PATCHES }, (_, k) => (shapes[k] ? new THREE.Vector4(shapes[k].angle, shapes[k].aspect, shapes[k].a2, shapes[k].p2) : new THREE.Vector4(0, 1, 0, 0))) },
    uPatchShapeB: { value: Array.from({ length: MAX_PATCHES }, (_, k) => (shapes[k] ? new THREE.Vector4(shapes[k].a3, shapes[k].p3, shapes[k].a5, shapes[k].p5) : new THREE.Vector4())) },
    uAsphalt: { value: new THREE.Color(SURFACE_COLORS[Surface.Asphalt]) },
    uRunoff: { value: new THREE.Color(themeOf(track.def.theme).runoff ?? SURFACE_COLORS[track.def.runoffSurface ?? Surface.Grass]) },
    uLine: { value: new THREE.Color('#e6e6e0') },
    uCurbA: { value: new THREE.Color('#d42a24') },
    uCurbB: { value: new THREE.Color('#ececec') },
    uLength: { value: track.length },
  };
  const mat = toon('#ffffff');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    withWorldPos(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nvarying vec4 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        #define MAX_PATCHES ${MAX_PATCHES}
        varying vec4 vRoad;
        uniform vec4 uPatch[MAX_PATCHES];
        uniform vec3 uPatchColor[MAX_PATCHES];
        uniform vec2 uPatchRect[MAX_PATCHES];
        uniform vec4 uPatchShapeA[MAX_PATCHES];
        uniform vec4 uPatchShapeB[MAX_PATCHES];
        uniform int uPatchCount;
        // Distance from the centre over the outline's radius there (< 1 inside); see patchShape.ts.
        float patchEdge(int k, vec2 q) {
          vec4 p = uPatch[k];
          vec2 rr = uPatchRect[k];
          if (rr.x > 0.0) return max(abs(q.x - p.x) / rr.x, abs(q.y - p.y) / rr.y);
          vec4 sa = uPatchShapeA[k];
          vec4 sb = uPatchShapeB[k];
          vec2 d = q - p.xy;
          float c = cos(sa.x), s = sin(sa.x), kk = sqrt(sa.y);
          float u = (d.x * c + d.y * s) / kk;
          float v = (-d.x * s + d.y * c) * kk;
          float th = atan(v, u);
          float lim = p.z * (1.0 + sa.z * cos(2.0 * th + sa.w) + sb.x * cos(3.0 * th + sb.y) + sb.z * cos(5.0 * th + sb.w));
          return length(vec2(u, v)) / lim;
        }
        uniform vec3 uAsphalt;
        uniform vec3 uRunoff;
        uniform vec3 uLine;
        uniform vec3 uCurbA;
        uniform vec3 uCurbB;
        uniform float uLength;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float lat = vRoad.x;
          float sAlong = vRoad.y;
          float hwv = vRoad.z;
          float kap = vRoad.w;
          float a = abs(lat);
          float n1 = hash12(floor(vWPos.xz * 3.0));
          float n2 = valueNoise(vWPos.xz * 0.15);
          vec3 col;
          if (a <= hwv) {
            col = uAsphalt * (0.9 + 0.1 * n1 + 0.08 * n2);
            for (int k = 0; k < MAX_PATCHES; k++) {
              if (k >= uPatchCount) break;
              float e = patchEdge(k, vWPos.xz);
              // A darker rim, like a soaked edge or a drift's shadow.
              if (e < 1.0) col = uPatchColor[k] * (0.88 + 0.2 * n1) * (1.0 - 0.14 * smoothstep(0.78, 1.0, e));
            }
            if (a > hwv - 0.55 && a < hwv - 0.3) col = uLine;
            if (abs(kap) > 1.0 / 140.0 && a > hwv - 0.9) {
              col = mod(floor(sAlong / 1.6), 2.0) < 1.0 ? uCurbA : uCurbB;
            }
            if (abs(kap) < 1e-5 && a < 0.14 && mod(sAlong, 9.0) < 4.5) col = uLine;
            if (sAlong < 2.0 || sAlong > uLength - 0.02) {
              float cx = floor(lat + hwv);
              float cy = floor(sAlong);
              col = mod(cx + cy, 2.0) < 1.0 ? vec3(0.85) : vec3(0.015);
            }
          } else {
            col = uRunoff * (0.84 + 0.14 * n1 + 0.1 * n2);
            for (int k = 0; k < MAX_PATCHES; k++) {
              if (k >= uPatchCount) break;
              if (uPatch[k].w > 0.5 && patchEdge(k, vWPos.xz) < 1.0) col = uPatchColor[k] * (0.84 + 0.2 * n1);
            }
          }
          diffuseColor.rgb = col;
        }`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'road';
  return mesh;
}

function buildWalls(track: Track): THREE.Mesh {
  const H = 0.9;
  const T = 0.7;
  const pos: number[] = [];
  const col: number[] = [];
  const red = new THREE.Color('#c8261f');
  const white = new THREE.Color('#e8e6e0');
  const concrete = new THREE.Color('#9a9a98');
  const dark = new THREE.Color('#6e6e6c');
  const quad = (
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, c: THREE.Color,
  ) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  };
  for (let side = 0; side < 2; side++) {
    const outline = track.walls.outlines[side];
    const sgn = side === 0 ? 1 : -1;
    const m = outline.length / 2;
    let along = 0;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const x0 = outline[i * 2], z0 = outline[i * 2 + 1];
      const x1 = outline[j * 2], z1 = outline[j * 2 + 1];
      const seg = Math.hypot(x1 - x0, z1 - z0);
      if (track.deck[i] === 3 || track.deck[j] === 3) {
        along += seg;
        continue;
      }
      // Up on a bridge the barrier rides on the deck.
      const y0 = track.elev[i];
      const y1 = track.elev[j];
      const ox0 = track.nx[i] * sgn * T, oz0 = track.nz[i] * sgn * T;
      const ox1 = track.nx[j] * sgn * T, oz1 = track.nz[j] * sgn * T;
      const stripe = Math.floor((along + seg / 2) / 3) % 2 === 0 ? red : white;
      along += seg;
      // Inner face (toward the road), top, outer face.
      quad(x0, y0, z0, x1, y1, z1, x1, y1 + H, z1, x0, y0 + H, z0, concrete);
      quad(x0, y0 + H, z0, x1, y1 + H, z1, x1 + ox1, y1 + H, z1 + oz1, x0 + ox0, y0 + H, z0 + oz0, stripe);
      quad(x0 + ox0, y0 + H, z0 + oz0, x1 + ox1, y1 + H, z1 + oz1, x1 + ox1, y1, z1 + oz1, x0 + ox0, y0, z0 + oz0, dark);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'walls';
  return mesh;
}

function buildStartGantry(track: Track): THREE.Group {
  const g = new THREE.Group();
  const i = 0;
  const reach = track.hw[i] + track.def.runoff * 0.5;
  const heading = Math.atan2(track.tx[i], -track.tz[i]);
  g.position.set(track.px[i], 0, track.pz[i]);
  g.rotation.y = -heading;
  const steel = toon('#5d6470');
  const postGeo = new THREE.BoxGeometry(0.5, 6, 0.5);
  for (const sx of [-reach, reach]) {
    const post = new THREE.Mesh(postGeo, steel);
    post.position.set(sx, 3, 0);
    post.castShadow = true;
    g.add(post);
  }
  // Checkered banner.
  const cvs = document.createElement('canvas');
  cvs.width = 32;
  cvs.height = 4;
  const ctx = cvs.getContext('2d')!;
  for (let x = 0; x < 32; x++) {
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f0f0f0' : '#111';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(new THREE.BoxGeometry(reach * 2 + 0.5, 1.1, 0.35), toon('#ffffff', { map: tex }));
  banner.position.set(0, 5.6, 0);
  banner.castShadow = true;
  g.add(banner);
  // Start lights (driven by the race countdown later).
  const lightMat = new THREE.MeshBasicMaterial({ color: '#3a0d0d' });
  for (let k = 0; k < 5; k++) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.2), lightMat.clone());
    lamp.position.set((k - 2) * 0.8, 4.7, 0.1);
    lamp.name = `startLamp${k}`;
    g.add(lamp);
  }
  g.name = 'gantry';
  return g;
}

function buildGridMarks(track: Track): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  for (const slot of track.grid) {
    const fx = Math.sin(slot.heading);
    const fz = -Math.cos(slot.heading);
    const bar = new THREE.PlaneGeometry(2.4, 0.35);
    bar.rotateX(-Math.PI / 2);
    bar.rotateY(-slot.heading);
    bar.translate(slot.x + fx * 2.7, 0.012, slot.z + fz * 2.7);
    geos.push(bar);
  }
  const merged = mergeGeometries(geos);
  const mesh = new THREE.Mesh(merged, toon('#e6e6e0'));
  mesh.receiveShadow = true;
  mesh.name = 'gridMarks';
  return mesh;
}

/** Minimal geometry merge (non-indexed position + normal). */
export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
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
