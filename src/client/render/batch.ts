// Static batching: hundreds of small trackside meshes (buildings, plant
// parts, fences, signs) each cost a draw call in the main pass and again in
// the shadow pass. Plain, untextured toon meshes are merged per area into a
// few big meshes, with each part's colour baked into vertex colours so they
// can share one material. Anything animated, textured, transparent or changed
// at runtime is left alone.

import * as THREE from 'three';

interface Part {
  mesh: THREE.Mesh;
  mat: THREE.MeshToonMaterial;
}

const MAPS = ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'bumpMap', 'lightMap', 'aoMap', 'displacementMap'] as const;
const DEFAULT_COMPILE = THREE.Material.prototype.onBeforeCompile;

function mergeable(m: THREE.Mesh, live: ReadonlySet<THREE.Material>): THREE.MeshToonMaterial | null {
  if ((m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return null;
  if (m.morphTargetInfluences?.length) return null;
  const mat = m.material;
  if (Array.isArray(mat) || !(mat as THREE.MeshToonMaterial).isMeshToonMaterial) return null;
  const t = mat as THREE.MeshToonMaterial;
  if (live.has(t) || t.transparent || t.opacity < 1 || t.wireframe || t.onBeforeCompile !== DEFAULT_COMPILE) return null;
  for (const k of MAPS) if (t[k]) return null;
  if (t.emissive.r + t.emissive.g + t.emissive.b > 0) return null;
  if (!m.geometry.getAttribute('position')) return null;
  return t;
}

/** Merge static meshes under `root`. Objects in `keep` (and their children) are left as they are. */
export function batchStatic(
  root: THREE.Object3D,
  live: ReadonlySet<THREE.Material>,
  keep: ReadonlySet<THREE.Object3D>,
  cell = 64,
): { before: number; after: number } {
  root.updateMatrixWorld(true);
  const parts = new Map<string, Part[]>();
  let before = 0;
  const visit = (o: THREE.Object3D): void => {
    if (keep.has(o) || !o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      before++;
      const mat = mergeable(m, live);
      if (mat) {
        m.geometry.computeBoundingBox();
        const c = m.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld);
        const key = [
          Math.floor(c.x / cell), Math.floor(c.z / cell), mat.side, mat.gradientMap?.uuid ?? '',
          m.castShadow, m.receiveShadow, m.renderOrder, m.frustumCulled, mat.depthWrite, mat.depthTest,
          mat.polygonOffset ? `${mat.polygonOffsetFactor}/${mat.polygonOffsetUnits}` : 0, mat.fog,
        ].join('|');
        let list = parts.get(key);
        if (!list) parts.set(key, (list = []));
        list.push({ mesh: m, mat });
      }
    }
    for (const child of [...o.children]) visit(child);
  };
  visit(root);

  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const normalMat = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const materials = new Map<string, THREE.MeshToonMaterial>();
  let merged = 0;
  for (const list of parts.values()) {
    if (list.length < 2) continue;
    let count = 0;
    const geos = list.map(({ mesh }) => {
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      count += g.getAttribute('position').count;
      return g;
    });
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    let o = 0;
    list.forEach(({ mesh, mat }, i) => {
      const g = geos[i];
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      const vc = mat.vertexColors ? g.getAttribute('color') : null;
      rel.multiplyMatrices(inv, mesh.matrixWorld);
      normalMat.getNormalMatrix(rel);
      // A mirrored transform turns triangles inside out: swap two corners.
      const flip = rel.determinant() < 0;
      for (let k = 0; k < p.count; k++) {
        const src = flip ? k + (k % 3 === 1 ? 1 : k % 3 === 2 ? -1 : 0) : k;
        v.fromBufferAttribute(p, src).applyMatrix4(rel);
        pos.set([v.x, v.y, v.z], (o + k) * 3);
        v.fromBufferAttribute(n, src).applyMatrix3(normalMat).normalize();
        nrm.set([v.x, v.y, v.z], (o + k) * 3);
        const r = mat.color.r * (vc ? vc.getX(src) : 1);
        const gg = mat.color.g * (vc ? vc.getY(src) : 1);
        const b = mat.color.b * (vc ? vc.getZ(src) : 1);
        col.set([r, gg, b], (o + k) * 3);
      }
      o += p.count;
      if (g !== mesh.geometry) g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const first = list[0];
    const fm = first.mat;
    const mkey = [fm.side, fm.gradientMap?.uuid, fm.depthWrite, fm.depthTest, fm.polygonOffset, fm.polygonOffsetFactor, fm.polygonOffsetUnits, fm.fog].join('|');
    let mat = materials.get(mkey);
    if (!mat) {
      mat = new THREE.MeshToonMaterial({
        vertexColors: true,
        gradientMap: fm.gradientMap,
        side: fm.side,
        depthWrite: fm.depthWrite,
        depthTest: fm.depthTest,
        polygonOffset: fm.polygonOffset,
        polygonOffsetFactor: fm.polygonOffsetFactor,
        polygonOffsetUnits: fm.polygonOffsetUnits,
        fog: fm.fog,
      });
      materials.set(mkey, mat);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'batched';
    mesh.castShadow = first.mesh.castShadow;
    mesh.receiveShadow = first.mesh.receiveShadow;
    mesh.renderOrder = first.mesh.renderOrder;
    mesh.frustumCulled = first.mesh.frustumCulled;
    root.add(mesh);
    for (const { mesh: m } of list) m.parent?.remove(m);
    merged += list.length - 1;
  }
  return { before, after: before - merged };
}

/**
 * Merge the direct mesh children of `group` that share a material (same
 * material instance, so the look is unchanged): one mesh per material.
 */
export function mergeByMaterial(group: THREE.Object3D): void {
  const byMat = new Map<string, THREE.Mesh[]>();
  for (const o of group.children) {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || m.children.length) continue;
    const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`;
    let list = byMat.get(key);
    if (!list) byMat.set(key, (list = []));
    list.push(m);
  }
  for (const list of byMat.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      m.updateMatrix();
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
      return g;
    });
    // Keep only the attributes every part has.
    const names = Object.keys(geos[0].attributes).filter((n) => geos.every((g) => g.getAttribute(n)?.itemSize === geos[0].getAttribute(n).itemSize));
    let count = 0;
    for (const g of geos) count += g.getAttribute('position').count;
    const out = new THREE.BufferGeometry();
    for (const n of names) {
      const size = geos[0].getAttribute(n).itemSize;
      const arr = new Float32Array(count * size);
      let o = 0;
      for (const g of geos) {
        const a = g.getAttribute(n);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) arr[(o + i) * size + c] = a.getComponent(i, c);
        o += a.count;
      }
      out.setAttribute(n, new THREE.BufferAttribute(arr, size));
    }
    for (const g of geos) g.dispose();
    const first = list[0];
    const merged = new THREE.Mesh(out, first.material);
    merged.castShadow = first.castShadow;
    merged.receiveShadow = first.receiveShadow;
    merged.renderOrder = first.renderOrder;
    for (const m of list) group.remove(m);
    group.add(merged);
  }
}
