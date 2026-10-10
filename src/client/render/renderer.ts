// Retro render pipeline: each viewport renders the 3D scene into a small
// render target (internal resolution ≈ 240 lines), runs the low-res post
// chain (outlines, bloom, grading, dither, palette), then a composite pass
// upscales it with nearest-neighbour filtering by an integer factor, applies
// the sub-pixel scroll offset, overlays the Canvas2D UI and an optional CRT look.

import * as THREE from 'three';
import { CanvasUI } from '../ui/canvasUI.ts';
import { PaletteMode, type PaletteModeId } from './palette.ts';
import { PixelCamera } from './pixelCamera.ts';
import { FullscreenPass, PostChain, type GradeSettings } from './post/passes.ts';

/** Target number of internal lines; the integer scale is floor(deviceHeight / this). */
const TARGET_LINES = 240;

export class Viewport {
  readonly cam = new PixelCamera();
  readonly rt: THREE.WebGLRenderTarget;
  readonly post = new PostChain();
  /** World-anchored dither offset (camera position on the pixel grid). */
  readonly grid = new THREE.Vector2();
  /** Position and size in low-res (UI) pixels. */
  x = 0;
  w = 1;
  h = 1;

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    this.rt.depthTexture = new THREE.DepthTexture(4, 4);
  }

  resize(x: number, w: number, h: number): void {
    this.x = x;
    this.w = w;
    this.h = h;
    // One pixel of margin on every side so the sub-pixel shift never shows an edge.
    this.rt.setSize(w + 2, h + 2);
    this.post.resize(w + 2, h + 2);
  }
}

const COMPOSITE_VS = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FS = /* glsl */ `
precision highp float;
uniform sampler2D tView0;
uniform sampler2D tView1;
uniform sampler2D tUI;
uniform vec2 uOff0;
uniform vec2 uOff1;
uniform float uScale;
uniform float uSplitX;
uniform float uView1X;
uniform float uCrt;
uniform vec2 uDevice;

vec3 sampleScene(vec2 frag) {
  vec2 lp = floor(frag / uScale);
  vec3 col;
  if (lp.x < uSplitX) {
    col = texelFetch(tView0, ivec2(floor((frag + uOff0) / uScale)) + ivec2(1), 0).rgb;
  } else {
    vec2 f = frag - vec2(uView1X * uScale, 0.0);
    col = texelFetch(tView1, ivec2(floor((f + uOff1) / uScale)) + ivec2(1), 0).rgb;
  }
  vec4 ui = texelFetch(tUI, ivec2(lp), 0);
  return mix(col, ui.rgb, ui.a);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (uCrt > 1.5 && uScale >= 4.0) {
    // Gentle barrel distortion of the whole screen.
    vec2 uv = frag / uDevice * 2.0 - 1.0;
    uv *= 1.0 + 0.018 * dot(uv, uv);
    if (abs(uv.x) > 1.0 || abs(uv.y) > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    frag = floor((uv * 0.5 + 0.5) * uDevice) + 0.5;
  }
  vec3 col = sampleScene(frag);
  if (uCrt > 0.5 && uScale >= 3.0) {
    // Scanlines: darken the last device row of every low-res line.
    float row = mod(gl_FragCoord.y, uScale);
    col *= row < 1.0 ? 0.74 : 1.0;
    // Aperture-grille mask and vignette.
    if (uCrt > 1.5) {
      float m = mod(gl_FragCoord.x, 3.0);
      col *= m < 1.0 ? vec3(1.06, 0.94, 0.94) : m < 2.0 ? vec3(0.94, 1.06, 0.94) : vec3(0.94, 0.94, 1.06);
    }
    vec2 v = gl_FragCoord.xy / uDevice - 0.5;
    col *= 1.0 - 0.55 * dot(v, v);
    col *= 1.06;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export class RetroRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly ui = new CanvasUI();
  readonly viewports: Viewport[] = [new Viewport()];
  deviceW = 1;
  deviceH = 1;
  scale = 1;
  lowW = 1;
  lowH = 1;
  forcedScale: number | null = null;
  /** 0 = off, 1 = scanlines + vignette, 2 = + aperture mask + curvature. */
  crt = 0;
  paletteMode: PaletteModeId = PaletteMode.Bits12;
  outlines = true;
  readonly grade: GradeSettings = {
    tint: new THREE.Color(1, 1, 1),
    lift: new THREE.Color(0, 0, 0),
    exposure: 1,
    bloom: 0.6,
    bloomThreshold: 1.1,
  };
  private readonly fs = new FullscreenPass();
  private split = false;
  private readonly compositeScene = new THREE.Scene();
  private readonly compositeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly composite: THREE.ShaderMaterial;
  private readonly observer: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, forcedScale: number | null) {
    this.canvas = canvas;
    this.forcedScale = forcedScale;
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.gl.setPixelRatio(1);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.BasicShadowMap;
    this.gl.autoClear = true;

    this.composite = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VS,
      fragmentShader: COMPOSITE_FS,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tView0: { value: null },
        tView1: { value: null },
        tUI: { value: this.ui.texture },
        uOff0: { value: new THREE.Vector2() },
        uOff1: { value: new THREE.Vector2() },
        uScale: { value: 1 },
        uSplitX: { value: 1e9 },
        uView1X: { value: 0 },
        uCrt: { value: 0 },
        uDevice: { value: new THREE.Vector2(1, 1) },
      },
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mesh = new THREE.Mesh(tri, this.composite);
    mesh.frustumCulled = false;
    this.compositeScene.add(mesh);

    this.observer = new ResizeObserver((entries) => {
      const e = entries[0];
      const box = e.devicePixelContentBoxSize?.[0];
      const w = box ? box.inlineSize : Math.round(e.contentRect.width * devicePixelRatio);
      const h = box ? box.blockSize : Math.round(e.contentRect.height * devicePixelRatio);
      this.resize(w, h);
    });
    try {
      this.observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.observer.observe(canvas);
    }
    this.resize(Math.round(canvas.clientWidth * devicePixelRatio), Math.round(canvas.clientHeight * devicePixelRatio));
  }

  setSplit(split: boolean): void {
    if (split === this.split) return;
    this.split = split;
    if (split && this.viewports.length < 2) this.viewports.push(new Viewport());
    this.layout();
  }

  get isSplit(): boolean {
    return this.split;
  }

  resize(deviceW: number, deviceH: number): void {
    deviceW = Math.max(1, deviceW);
    deviceH = Math.max(1, deviceH);
    if (deviceW === this.deviceW && deviceH === this.deviceH) return;
    this.deviceW = deviceW;
    this.deviceH = deviceH;
    this.canvas.width = deviceW;
    this.canvas.height = deviceH;
    this.gl.setSize(deviceW, deviceH, false);
    this.layout();
  }

  private layout(): void {
    const s = this.forcedScale ?? Math.max(1, Math.floor(this.deviceH / TARGET_LINES));
    this.scale = s;
    this.lowW = Math.ceil(this.deviceW / s);
    this.lowH = Math.ceil(this.deviceH / s);
    this.ui.resize(this.lowW, this.lowH);
    if (this.split) {
      const w = Math.floor((this.lowW - 2) / 2);
      this.viewports[0].resize(0, w, this.lowH);
      this.viewports[1].resize(w + 2, this.lowW - w - 2, this.lowH);
    } else {
      this.viewports[0].resize(0, this.lowW, this.lowH);
    }
  }

  /** Number of active viewports. */
  get viewCount(): number {
    return this.split ? 2 : 1;
  }

  renderView(scene: THREE.Scene, index: number): void {
    const vp = this.viewports[index];
    this.gl.setRenderTarget(vp.rt);
    this.gl.render(scene, vp.cam.camera);
    vp.grid.set(vp.cam.gridX, vp.cam.gridY);
    vp.post.run(this.gl, this.fs, vp.rt, vp.cam.camera, vp.grid, this.grade, this.paletteMode, this.outlines);
  }

  /** Upscale the viewports to the screen and overlay the UI. */
  present(): void {
    const u = this.composite.uniforms;
    const s = this.scale;
    const v0 = this.viewports[0];
    u.tView0.value = v0.post.out.texture;
    u.uOff0.value.set(Math.round(v0.cam.fracX * s), Math.round(v0.cam.fracY * s));
    if (this.split) {
      const v1 = this.viewports[1];
      u.tView1.value = v1.post.out.texture;
      u.uOff1.value.set(Math.round(v1.cam.fracX * s), Math.round(v1.cam.fracY * s));
      u.uSplitX.value = v1.x;
      u.uView1X.value = v1.x;
    } else {
      u.tView1.value = v0.post.out.texture;
      u.uSplitX.value = 1e9;
    }
    u.uScale.value = s;
    u.uCrt.value = this.crt;
    u.uDevice.value.set(this.deviceW, this.deviceH);
    this.gl.setRenderTarget(null);
    this.gl.render(this.compositeScene, this.compositeCam);
  }
}
