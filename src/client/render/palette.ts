// Colour reduction. "12-bit" quantises to the Amiga's 4096-colour space;
// "32" maps every pixel to the nearest entry of a 32-colour palette through a
// 32³ lookup table built in OKLab (perceptual distance).

import * as THREE from 'three';

export const PaletteMode = { Off: 0, Bits12: 1, Palette32: 2 } as const;
export type PaletteModeId = (typeof PaletteMode)[keyof typeof PaletteMode];
export const PALETTE_MODE_NAMES = ['FULL COLOUR', '12-BIT AMIGA', '32 COLOURS'];

/**
 * 32-colour palette based on DawnBringer 32, with a pink and a purple swapped
 * for two mid greens so grass and trees keep their colour.
 */
export const PALETTE_32 = [
  '#000000', '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a',
  '#fbf236', '#99e550', '#6abe30', '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74',
  '#306082', '#5b6ee1', '#639bff', '#5fcde4', '#cbdbfc', '#ffffff', '#9badb7', '#847e87',
  '#696a6a', '#595652', '#3e7a2e', '#ac3232', '#d95763', '#5d9a3c', '#8f974a', '#8a6f30',
];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const lutCache = new Map<string, THREE.Data3DTexture>();

/** 32³ RGBA lookup: sRGB in, nearest palette colour (sRGB) out. */
export function paletteLut(colors: readonly string[]): THREE.Data3DTexture {
  const key = colors.join(',');
  const cached = lutCache.get(key);
  if (cached) return cached;
  const N = 32;
  const pal = colors.map((hex) => {
    const c = new THREE.Color(hex);
    // THREE.Color stores linear values; convert back to sRGB components.
    const sr = c.clone().convertLinearToSRGB();
    return { rgb: [sr.r, sr.g, sr.b], lab: toOklab(sr.r, sr.g, sr.b) };
  });
  const data = new Uint8Array(N * N * N * 4);
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        const lab = toOklab((r + 0.5) / N, (g + 0.5) / N, (b + 0.5) / N);
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < pal.length; i++) {
          const p = pal[i].lab;
          // Weight lightness a little more: keeps shading readable.
          const d = 1.4 * (p[0] - lab[0]) ** 2 + (p[1] - lab[1]) ** 2 + (p[2] - lab[2]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        const o = (r + g * N + b * N * N) * 4;
        data[o] = Math.round(pal[best].rgb[0] * 255);
        data[o + 1] = Math.round(pal[best].rgb[1] * 255);
        data[o + 2] = Math.round(pal[best].rgb[2] * 255);
        data[o + 3] = 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  lutCache.set(key, tex);
  return tex;
}
