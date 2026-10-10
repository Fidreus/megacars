// Tyre marks as a ring buffer of quads: new segments overwrite the oldest, and
// only the changed range is uploaded to the GPU.

import * as THREE from 'three';

const MAX_SEGMENTS = 8000;
const MARK_WIDTH = 0.32;

interface Trail {
  x: number;
  z: number;
  y: number;
  active: boolean;
}

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly attr: THREE.BufferAttribute;
  private readonly trails = new Map<number, Trail>();
  private next = 0;
  private used = 0;

  constructor() {
    this.positions = new Float32Array(MAX_SEGMENTS * 4 * 3);
    const idx = new Uint32Array(MAX_SEGMENTS * 6);
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.positions, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: '#101012',
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'skidmarks';
  }

  /** Extend the trail with key `key` to (x, z), or break it when `on` is false. */
  mark(key: number, x: number, z: number, on: boolean, y = 0): void {
    let t = this.trails.get(key);
    if (!t) this.trails.set(key, (t = { x, z, y, active: false }));
    if (!on) {
      t.active = false;
      return;
    }
    if (!t.active) {
      t.active = true;
      t.x = x;
      t.z = z;
      t.y = y;
      return;
    }
    const dx = x - t.x;
    const dz = z - t.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.35) return;
    if (len > 6) {
      // Teleport or respawn: start a fresh trail.
      t.x = x;
      t.z = z;
      t.y = y;
      return;
    }
    const sx = (-dz / len) * MARK_WIDTH * 0.5;
    const sz = (dx / len) * MARK_WIDTH * 0.5;
    const o = this.next * 12;
    const p = this.positions;
    const y0 = t.y + 0.015;
    const y1 = y + 0.015;
    p[o] = t.x + sx; p[o + 1] = y0; p[o + 2] = t.z + sz;
    p[o + 3] = t.x - sx; p[o + 4] = y0; p[o + 5] = t.z - sz;
    p[o + 6] = x + sx; p[o + 7] = y1; p[o + 8] = z + sz;
    p[o + 9] = x - sx; p[o + 10] = y1; p[o + 11] = z - sz;
    this.attr.addUpdateRange(o, 12);
    this.attr.needsUpdate = true;
    this.next = (this.next + 1) % MAX_SEGMENTS;
    this.used = Math.min(MAX_SEGMENTS, this.used + 1);
    this.mesh.geometry.setDrawRange(0, this.used * 6);
    t.x = x;
    t.z = z;
  }

  clear(): void {
    this.used = 0;
    this.next = 0;
    this.trails.clear();
    this.mesh.geometry.setDrawRange(0, 0);
  }
}
