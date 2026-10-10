// HUD and menus are drawn with Canvas2D at the internal (low) resolution and
// composited on top of the 3D view, so they share its chunky pixels.

import * as THREE from 'three';

export class CanvasUI {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  w = 1;
  h = 1;

  constructor() {
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
  }

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = this.canvas.width = w;
    this.h = this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    // The GPU texture has immutable storage; drop it so it is re-created.
    this.texture.dispose();
  }

  begin(): CanvasRenderingContext2D {
    this.ctx.clearRect(0, 0, this.w, this.h);
    return this.ctx;
  }

  end(): void {
    this.texture.needsUpdate = true;
  }
}
