// Soft contact shadows at the foot of the buildings: a dark rounded patch,
// a little bigger than the footprint, so houses and blocks sit on the ground
// instead of floating on it. One instanced mesh for the whole town.

import * as THREE from 'three';

let fadeTex: THREE.DataTexture | null = null;

/** Alpha mask: opaque over the middle (the footprint), fading to nothing round the edge, rounded corners. */
function fadeTexture(): THREE.DataTexture {
  if (fadeTex) return fadeTex;
  const S = 32;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = Math.abs((x + 0.5) / S - 0.5) * 2;
      const v = Math.abs((y + 0.5) / S - 0.5) * 2;
      // Distance outside the inner rectangle, rounded at the corners.
      const dx = Math.max(0, u - 0.74) / 0.26;
      const dy = Math.max(0, v - 0.74) / 0.26;
      const a = Math.max(0, 1 - Math.hypot(dx, dy)) ** 1.3;
      data.set([255, Math.round(a * 255), 255, 255], (y * S + x) * 4);
    }
  }
  fadeTex = new THREE.DataTexture(data, S, S);
  fadeTex.magFilter = THREE.LinearFilter;
  fadeTex.needsUpdate = true;
  return fadeTex;
}

/**
 * Contact shadows under every mesh made of one of the `walls` materials
 * whose base is near the ground (upper storeys and roof boxes are skipped).
 */
export function contactShadows(root: THREE.Object3D, walls: ReadonlySet<THREE.Material>): THREE.InstancedMesh | null {
  root.updateMatrixWorld(true);
  const mats: THREE.Matrix4[] = [];
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const c = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || !walls.has(m.material)) return;
    const geo = m.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    m.matrixWorld.decompose(p, q, s);
    if (bb.min.y * s.y + p.y > 4) return;
    bb.getCenter(c).setY(0).applyMatrix4(m.matrixWorld);
    // Scaled so the opaque middle covers the footprint and the fade runs
    // about 3 m beyond it (more round a big block).
    const w = (bb.max.x - bb.min.x) * s.x;
    const d = (bb.max.z - bb.min.z) * s.z;
    const fade = 2.6 + Math.min(w, d) * 0.1;
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0.05, c.z), q, new THREE.Vector3((w + fade * 2) / 0.98, 1, (d + fade * 2) / 0.98)));
  });
  if (!mats.length) return null;
  const mat = new THREE.MeshBasicMaterial({
    color: '#000000', transparent: true, opacity: 0.55, alphaMap: fadeTexture(), depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, mats.length);
  mats.forEach((m, k) => mesh.setMatrixAt(k, m));
  mesh.name = 'contactShadows';
  mesh.renderOrder = 1;
  mesh.computeBoundingSphere();
  return mesh;
}
