// Tilted orthographic camera, always facing north, whose position is snapped
// to the low-res pixel grid. Static scenery then never shimmers; the leftover
// sub-pixel offset is applied when the image is upscaled, so scrolling stays
// smooth in steps of one screen pixel.

import * as THREE from 'three';

const DEG = Math.PI / 180;

export class PixelCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1500);
  /** Angle between the view direction and the ground. */
  tilt = 57 * DEG;
  /** World metres covered by one low-res pixel. */
  metersPerPixel = 0.19;
  distance = 600;
  /** Sub-pixel remainder of the ideal camera position, in low-res pixels. */
  fracX = 0;
  fracY = 0;
  /** Integer camera position on the pixel grid (for world-anchored dithering). */
  gridX = 0;
  gridY = 0;

  /** Point the camera at a world position; `w`/`h` are the viewport size in low-res pixels. */
  update(tx: number, ty: number, tz: number, w: number, h: number): void {
    const p = this.metersPerPixel;
    const ct = Math.cos(this.tilt);
    const st = Math.sin(this.tilt);
    const d = this.distance;
    // Ideal position C = T - F·d with F = (0, -sin t, -cos t).
    const cxW = tx;
    const cyW = ty + st * d;
    const czW = tz + ct * d;
    // Coordinates along screen-right R = (1,0,0) and screen-up U = (0, cos t, -sin t).
    const cx = cxW / p;
    const cy = (cyW * ct - czW * st) / p;
    const sx = Math.round(cx);
    const sy = Math.round(cy);
    this.fracX = cx - sx;
    this.fracY = cy - sy;
    this.gridX = sx;
    this.gridY = sy;
    const dy = (sy - cy) * p;
    this.camera.position.set(cxW + (sx - cx) * p, cyW + ct * dy, czW - st * dy);
    this.camera.rotation.set(-this.tilt, 0, 0);
    const halfW = ((w + 2) * p) / 2;
    const halfH = ((h + 2) * p) / 2;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.near = 1;
    this.camera.far = d * 2.5;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Ground-plane size (metres) visible in a viewport of w×h low-res pixels. */
  footprint(w: number, h: number): { width: number; depth: number } {
    return { width: w * this.metersPerPixel, depth: (h * this.metersPerPixel) / Math.sin(this.tilt) };
  }
}
