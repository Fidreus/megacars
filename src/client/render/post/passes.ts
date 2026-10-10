// Low-res post-processing: bloom (bright extract + blur at half size) and the
// resolve pass (pixel outlines from depth, bloom, colour grading, world-anchored
// ordered dither and palette reduction).

import * as THREE from 'three';
import { PaletteMode, PALETTE_32, paletteLut, type PaletteModeId } from '../palette.ts';

const FS_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Draws one full-screen triangle with a material into a render target. */
export class FullscreenPass {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mesh: THREE.Mesh;

  constructor() {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new THREE.Mesh(tri);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(gl: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.mesh.material = material;
    gl.setRenderTarget(target);
    gl.render(this.scene, this.camera);
  }
}

function shader(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
}

const EXTRACT_FS = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
void main() {
  // Each output pixel averages a 2x2 block of the source (bilinear tap at the centre).
  vec2 uv = gl_FragCoord.xy * 2.0 * uTexel;
  vec3 c = texture(tSrc, uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.6, l), 1.0);
}
`;

const BLUR_FS = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir;
uniform vec2 uTexel;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 c = texture(tSrc, uv).rgb * 0.227027;
  c += texture(tSrc, uv + uDir * uTexel * 1.3846).rgb * 0.316216;
  c += texture(tSrc, uv - uDir * uTexel * 1.3846).rgb * 0.316216;
  c += texture(tSrc, uv + uDir * uTexel * 3.2308).rgb * 0.070270;
  c += texture(tSrc, uv - uDir * uTexel * 3.2308).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;

const RESOLVE_FS = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform sampler3D tLut;
uniform vec2 uSize;
uniform float uNear;
uniform float uFar;
uniform float uOutline;
uniform float uOutlineThr;
uniform float uBloom;
uniform vec3 uTint;
uniform vec3 uLift;
uniform float uExposure;
uniform int uMode;
uniform float uDither;
uniform vec2 uGrid;

float depthAt(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uSize) - 1);
  return uNear + texelFetch(tDepth, p, 0).r * (uFar - uNear);
}

vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 col = texelFetch(tColor, p, 0).rgb;

  // 1-pixel outlines: darken this pixel when a neighbour is clearly farther away.
  if (uOutline > 0.0) {
    float z = depthAt(p);
    float zn = max(max(depthAt(p + ivec2(1, 0)), depthAt(p - ivec2(1, 0))),
                   max(depthAt(p + ivec2(0, 1)), depthAt(p - ivec2(0, 1))));
    if (zn - z > uOutlineThr) col *= 1.0 - uOutline;
  }

  col += texture(tBloom, gl_FragCoord.xy / uSize).rgb * uBloom;
  col = col * uExposure * uTint + uLift;
  vec3 s = toSRGB(clamp(col, 0.0, 1.0));

  // Ordered dither anchored to the world (camera grid), so it never swims.
  vec2 g = mod(gl_FragCoord.xy - 0.5 + uGrid, 4.0);
  float b = (BAYER[int(g.y) * 4 + int(g.x)] + 0.5) / 16.0 - 0.5;
  if (uMode == 1) {
    s = clamp(floor(s * 15.0 + 0.5 + b * uDither) / 15.0, 0.0, 1.0);
  } else if (uMode == 2) {
    vec3 q = clamp(s + b * uDither * 0.11, 0.0, 1.0);
    s = texture(tLut, q * (31.0 / 32.0) + 0.5 / 32.0).rgb;
  }
  gl_FragColor = vec4(s, 1.0);
}
`;

export interface GradeSettings {
  tint: THREE.Color;
  lift: THREE.Color;
  exposure: number;
  bloom: number;
  bloomThreshold: number;
}

/** Per-viewport post-processing targets and passes. */
export class PostChain {
  readonly out: THREE.WebGLRenderTarget;
  private readonly bloomA: THREE.WebGLRenderTarget;
  private readonly bloomB: THREE.WebGLRenderTarget;
  private readonly extract = shader(EXTRACT_FS, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 },
  });
  private readonly blur = shader(BLUR_FS, {
    tSrc: { value: null }, uDir: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2() },
  });
  private readonly resolve = shader(RESOLVE_FS, {
    tColor: { value: null }, tDepth: { value: null }, tBloom: { value: null }, tLut: { value: null },
    uSize: { value: new THREE.Vector2() }, uNear: { value: 1 }, uFar: { value: 1000 },
    uOutline: { value: 0.5 }, uOutlineThr: { value: 0.45 }, uBloom: { value: 1 },
    uTint: { value: new THREE.Color(1, 1, 1) }, uLift: { value: new THREE.Color(0, 0, 0) }, uExposure: { value: 1 },
    uMode: { value: PaletteMode.Bits12 }, uDither: { value: 1 }, uGrid: { value: new THREE.Vector2() },
  });

  constructor() {
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.bloomA = new THREE.WebGLRenderTarget(2, 2, opts);
    this.bloomB = new THREE.WebGLRenderTarget(2, 2, opts);
    this.out = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false,
    });
    this.resolve.uniforms.tLut.value = paletteLut(PALETTE_32);
  }

  resize(w: number, h: number): void {
    this.out.setSize(w, h);
    const bw = Math.max(1, Math.ceil(w / 2));
    const bh = Math.max(1, Math.ceil(h / 2));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
  }

  run(
    gl: THREE.WebGLRenderer, fs: FullscreenPass, scene: THREE.WebGLRenderTarget, camera: THREE.OrthographicCamera,
    grid: THREE.Vector2, grade: GradeSettings, mode: PaletteModeId, outline: boolean,
  ): void {
    const w = scene.width;
    const h = scene.height;
    const bw = this.bloomA.width;
    const bh = this.bloomA.height;
    if (grade.bloom > 0) {
      this.extract.uniforms.tSrc.value = scene.texture;
      this.extract.uniforms.uTexel.value.set(1 / w, 1 / h);
      this.extract.uniforms.uThreshold.value = grade.bloomThreshold;
      fs.render(gl, this.extract, this.bloomA);
      this.blur.uniforms.uTexel.value.set(1 / bw, 1 / bh);
      for (let i = 0; i < 2; i++) {
        this.blur.uniforms.tSrc.value = this.bloomA.texture;
        this.blur.uniforms.uDir.value.set(1, 0);
        fs.render(gl, this.blur, this.bloomB);
        this.blur.uniforms.tSrc.value = this.bloomB.texture;
        this.blur.uniforms.uDir.value.set(0, 1);
        fs.render(gl, this.blur, this.bloomA);
      }
    }
    const u = this.resolve.uniforms;
    u.tColor.value = scene.texture;
    u.tDepth.value = scene.depthTexture;
    u.tBloom.value = this.bloomA.texture;
    u.uSize.value.set(w, h);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uOutline.value = outline ? 0.4 : 0;
    u.uBloom.value = grade.bloom;
    u.uTint.value.copy(grade.tint);
    u.uLift.value.copy(grade.lift);
    u.uExposure.value = grade.exposure;
    u.uMode.value = mode;
    u.uGrid.value.copy(grid);
    fs.render(gl, this.resolve, this.out);
  }
}
