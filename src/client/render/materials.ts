// Shared materials: toon shading with three hard light bands gives the flat,
// hand-shaded look of pixel art.

import * as THREE from 'three';

/** Shared animation clock (seconds) for waving flags, cheering crowds, water. */
export const animTime = { value: 0 };

let gradient: THREE.DataTexture | null = null;

export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 170, 255]);
  gradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export function toon(color: THREE.ColorRepresentation, opts: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

export function vertexToon(opts: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), ...opts });
}

/** Car paint colours, one per grid slot. */
export const CAR_COLORS = ['#e8322a', '#2f6fe0', '#f2c230', '#2fae4e', '#f07a1a', '#9a45d8', '#28c4d0', '#e8e8e8'];

/** Linear-space colour from an sRGB hex string. */
export function linear(hex: string): THREE.Color {
  return new THREE.Color(hex);
}
