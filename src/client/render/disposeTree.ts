// Free the GPU side of everything under an object that is leaving the scene
// for good (a race's cars and effects, the podium, the showroom, ghosts).
// Something shared that is drawn again later is simply uploaded again.

import * as THREE from 'three';

export function disposeTree(root: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    const list = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of list) mats.add(mat);
  });
  for (const mat of mats) {
    for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) (v as THREE.Texture).dispose();
    const u = (mat as THREE.ShaderMaterial).uniforms;
    if (u) for (const k in u) if ((u[k]?.value as THREE.Texture | null)?.isTexture) (u[k].value as THREE.Texture).dispose();
    mat.dispose();
  }
}
