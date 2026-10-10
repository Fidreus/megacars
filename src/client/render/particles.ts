// GPU particles: square low-res points whose motion is computed in the vertex
// shader from spawn data, faded with an ordered dither (screen-door) instead
// of alpha blending, so they stay crisp, sort-free and suitably retro.

import * as THREE from 'three';

const MAX = 8192;

const VERT = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform float uPxScale;
attribute vec3 aVel;
attribute vec4 aTime;   // birth, life, gravity, drag
attribute vec2 aSize;   // start px, end px
attribute vec3 aColor;
varying vec3 vColor;
varying float vFade;
void main() {
  float age = uTime - aTime.x;
  float t = age / aTime.y;
  if (age < 0.0 || t >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float drag = aTime.w;
  float k = drag > 0.0 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 p = position + aVel * k;
  p.y += 0.5 * aTime.z * age * age;
  p.y = max(p.y, 0.05);
  // HDR colours (sparks, fire) glow on their own; the rest takes the scene light.
  vColor = max(aColor.r, max(aColor.g, aColor.b)) > 1.0 ? aColor : aColor * uLight;
  vFade = 1.0 - t;
  gl_PointSize = mix(aSize.x, aSize.y, t) * uPxScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uDither;
varying vec3 vColor;
varying float vFade;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  bool hot = max(vColor.r, max(vColor.g, vColor.b)) > 1.0;
  if (uDither > 0.5 || hot) {
    // Retro modes (and sparks): screen-door fade with an ordered dither.
    ivec2 g = ivec2(mod(gl_FragCoord.xy, 4.0));
    float threshold = (BAYER[g.y * 4 + g.x] + 0.5) / 16.0;
    if (vFade * 1.15 < threshold) discard;
    gl_FragColor = vec4(vColor, 1.0);
  } else {
    // Full colour: soft, translucent puffs.
    float edge = 1.0 - smoothstep(0.12, 0.25, r2);
    gl_FragColor = vec4(vColor, clamp(vFade * 0.9, 0.0, 1.0) * edge * 0.75);
  }
}
`;

export class Particles {
  readonly points: THREE.Points;
  readonly time = { value: 0 };
  /** Scene light level for unlit particles (smoke, dust). */
  readonly light = { value: 1 };
  /** Point sizes are authored for 0.19 m/pixel; this scales them to the current zoom. */
  readonly pxScale = { value: 1 };
  /** 1 = dithered screen-door fade (retro colour modes), 0 = alpha blended. */
  readonly dither = { value: 0 };
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly tim = new Float32Array(MAX * 4);
  private readonly size = new Float32Array(MAX * 2);
  private readonly col = new Float32Array(MAX * 3);
  private readonly attrs: THREE.BufferAttribute[];
  private next = 0;
  private dirtyFrom = MAX;
  private dirtyTo = -1;

  constructor() {
    const geo = new THREE.BufferGeometry();
    const mk = (arr: Float32Array, n: number) => {
      const a = new THREE.BufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    for (let i = 0; i < MAX; i++) this.tim[i * 4] = -1e9;
    this.attrs = [mk(this.pos, 3), mk(this.vel, 3), mk(this.tim, 4), mk(this.size, 2), mk(this.col, 3)];
    geo.setAttribute('position', this.attrs[0]);
    geo.setAttribute('aVel', this.attrs[1]);
    geo.setAttribute('aTime', this.attrs[2]);
    geo.setAttribute('aSize', this.attrs[3]);
    geo.setAttribute('aColor', this.attrs[4]);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: this.time, uLight: this.light, uPxScale: this.pxScale, uDither: this.dither },
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.name = 'particles';
  }

  /** Share of spawned particles kept (lower on slow machines). */
  density = 1;

  spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number, r: number, g: number, b: number,
    gravity = 0, drag = 0,
  ): void {
    if (this.density < 1 && Math.random() > this.density) return;
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.tim.set([this.time.value, life, gravity, drag], i * 4);
    this.size.set([size0, size1], i * 2);
    this.col.set([r, g, b], i * 3);
    if (i < this.dirtyFrom) this.dirtyFrom = i;
    if (i > this.dirtyTo) this.dirtyTo = i;
  }

  /** Upload what was spawned since the last call. */
  flush(): void {
    if (this.dirtyTo < this.dirtyFrom) return;
    const sizes = [3, 3, 4, 2, 3];
    this.attrs.forEach((a, k) => {
      a.addUpdateRange(this.dirtyFrom * sizes[k], (this.dirtyTo - this.dirtyFrom + 1) * sizes[k]);
      a.needsUpdate = true;
    });
    this.dirtyFrom = MAX;
    this.dirtyTo = -1;
  }
}
