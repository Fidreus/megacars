// Retro render pipeline: each viewport renders the 3D scene into a small
// render target (internal resolution ≈ 240 lines), then a composite pass
// upscales it with nearest-neighbour filtering by an integer factor, applies
// the sub-pixel scroll offset and overlays the Canvas2D UI.

import * as THREE from 'three';
import { CanvasUI } from '../ui/canvasUI.ts';
import { PixelCamera } from './pixelCamera.ts';

/** Target number of internal lines; the integer scale is floor(deviceHeight / this). */
const TARGET_LINES = 240;

export class Viewport {
  readonly cam = new PixelCamera();
  readonly rt: THREE.WebGLRenderTarget;
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
uniform float uScanlines;
uniform vec2 uLowSize;

vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 lp = floor(frag / uScale);
  vec3 col;
  if (lp.x < uSplitX) {
    col = texelFetch(tView0, ivec2(floor((frag + uOff0) / uScale)) + ivec2(1), 0).rgb;
  } else {
    vec2 f = frag - vec2(uView1X * uScale, 0.0);
    col = texelFetch(tView1, ivec2(floor((f + uOff1) / uScale)) + ivec2(1), 0).rgb;
  }
  col = toSRGB(clamp(col, 0.0, 1.0));
  vec4 ui = texelFetch(tUI, ivec2(lp), 0);
  col = mix(col, ui.rgb, ui.a);
  if (uScanlines > 0.0 && uScale >= 3.0) {
    // Darken the last device row of every low-res line.
    float row = mod(frag.y, uScale);
    col *= row < 1.0 ? 1.0 - 0.28 * uScanlines : 1.0;
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
  scanlines = 0;
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
        uScanlines: { value: 0 },
        uLowSize: { value: new THREE.Vector2(1, 1) },
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
  }

  /** Upscale the viewports to the screen and overlay the UI. */
  present(): void {
    const u = this.composite.uniforms;
    const s = this.scale;
    const v0 = this.viewports[0];
    u.tView0.value = v0.rt.texture;
    u.uOff0.value.set(Math.round(v0.cam.fracX * s), Math.round(v0.cam.fracY * s));
    if (this.split) {
      const v1 = this.viewports[1];
      u.tView1.value = v1.rt.texture;
      u.uOff1.value.set(Math.round(v1.cam.fracX * s), Math.round(v1.cam.fracY * s));
      u.uSplitX.value = v1.x;
      u.uView1X.value = v1.x;
    } else {
      u.tView1.value = v0.rt.texture;
      u.uSplitX.value = 1e9;
    }
    u.uScale.value = s;
    u.uScanlines.value = this.scanlines;
    u.uLowSize.value.set(this.lowW, this.lowH);
    this.gl.setRenderTarget(null);
    this.gl.render(this.compositeScene, this.compositeCam);
  }
}
