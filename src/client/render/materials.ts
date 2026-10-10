// Shared materials: toon shading with four hard light bands gives the flat,
// hand-shaded look of pixel art.

import * as THREE from 'three';

/** Shared animation clock (seconds) for waving flags, cheering crowds, water. */
export const animTime = { value: 0 };

let gradient: THREE.DataTexture | null = null;

export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([78, 138, 198, 255]);
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

export { CAR_COLORS } from '../../shared/game/roster.ts';

/** Linear-space colour from an sRGB hex string. */
export function linear(hex: string): THREE.Color {
  return new THREE.Color(hex);
}
