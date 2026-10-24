// Look of a track's surroundings by theme: ground colour, what grows there,
// rocks, buildings and whether the pond is water or ice.

import type { LifeRecipe } from './trackLife.ts';

export interface Theme {
  ground: string;
  /** cone: conifers + round trees; cactus: saguaros; snowpine: snow-capped firs; leafy: round street trees only. */
  trees: 'cone' | 'cactus' | 'snowpine' | 'leafy';
  treeColors: string[];
  /** Tree density relative to the countryside. */
  treeDensity: number;
  bushColors: string[];
  rockColors: string[];
  rockCount: number;
  houseWalls: string[];
  houseRoofs: string[];
  pond: 'water' | 'ice' | 'none';
  shore: string;
  /** Run-off colour instead of its surface's colour (concrete aprons). */
  runoff?: string;
  /** Farmhouses in the countryside around. */
  houses?: boolean;
  /** Power plant buildings, cooling towers and pipes. */
  industry?: boolean;
  /** Surface patches drawn in another colour (spilled beer instead of oil). */
  patchColors?: Partial<Record<number, string>>;
  /** Sponsor boards: text, background, text colour. */
  sponsors?: [string, string, string][];
  /** Flower colours speckled over meadows in the ground. */
  flowers?: [string, string, string];
  /** Mowing stripes across a grass run-off. */
  mowed?: boolean;
  /** Cloud shadows drifting over the ground and the road. */
  clouds?: boolean;
  /** Trees gather into woods with open meadows between (0 = spread evenly, 1 = only in woods). */
  woods?: number;
  /** Some leafy trees in blossom. */
  blossom?: string[];
  /** Sand ripples and darker drifts in the ground. */
  sand?: boolean;
  /** Snow drifts (blue-shaded hollows) and glints in the ground. */
  snow?: boolean;
  /** Life round the track: spectators, marshals, camps, animals, vehicles, birds... (trackLife.ts). */
  life?: LifeRecipe;
}

const COUNTRYSIDE: Theme = {
  ground: '#4c8a3a',
  trees: 'cone',
  treeColors: ['#2f6b2e', '#3c7d34', '#2a5f33', '#4a8a3a', '#356f2a'],
  treeDensity: 1,
  flowers: ['#f4f0e0', '#f2d23a', '#d878c8'],
  mowed: true,
  clouds: true,
  woods: 0.93,
  blossom: ['#f2b8c8', '#f8e8ee', '#e890b0'],
  life: {
    banks: { steps: ['#5ea248', '#55963f', '#4c8a3a'] },
    camps: { count: 2, ground: '#5a9444', kind: 'tents' },
    paddocks: { animals: ['sheep', 'cow', 'sheep', 'cow'], ground: '#5e9c48', fence: '#8a6a4a' },
    bales: '#d8b860',
    vehicles: [{ kind: 'tractor', ground: '#7a5a3a', rows: '#5e4430' }],
    balloon: true,
    birds: { color: '#f4f2ec', height: 24, flocks: 3 },
  },
  bushColors: ['#2f6b2e', '#3c7d34', '#2a5f33', '#4a8a3a', '#356f2a'],
  rockColors: ['#8c8a84', '#a3a097'],
  rockCount: 120,
  houseWalls: ['#e9dfc8', '#d9c9a8', '#efe9de', '#c9b48e'],
  houseRoofs: ['#9a3a2a', '#7a2f25', '#5a5f66', '#8a4a2a'],
  pond: 'water',
  shore: '#b49a68',
};

export const THEMES: Record<string, Theme> = {
  countryside: COUNTRYSIDE,
  desert: {
    ground: '#d2a96c',
    trees: 'cactus',
    treeColors: ['#4f7d3a', '#5d8a42', '#46703a'],
    treeDensity: 0.22,
    bushColors: ['#9a8a4a', '#8a7a3e', '#a8945a'],
    rockColors: ['#b0704a', '#c48a5a', '#9a5e3e', '#d0a070'],
    rockCount: 420,
    houseWalls: ['#d8b48a', '#e2c49a', '#c9a074'],
    houseRoofs: ['#b8643a', '#a85a34', '#c8b090'],
    pond: 'none',
    shore: '#c49a60',
    sand: true,
    clouds: true,
    life: {
      banks: { steps: ['#dcb47a', '#d0a86e', '#c49c62'], fence: '#8a6a4a' },
      camps: { count: 2, ground: '#c8a46c', kind: 'rv' },
      paddocks: { animals: ['horse', 'cow'], ground: '#c8a064', fence: '#7a5a3a' },
      birds: { color: '#5a4636', height: 34, flocks: 2, size: 2 },
      extras: ['pumpjacks', 'tumbleweeds', 'windpumps'],
    },
  },
  winter: {
    ground: '#e6ecf3',
    trees: 'snowpine',
    treeColors: ['#1f4a33', '#24553a', '#1a3f2d'],
    treeDensity: 1.1,
    bushColors: ['#cfd8e2', '#dfe6ee', '#b8c4d0'],
    rockColors: ['#6e747c', '#848a92'],
    rockCount: 90,
    houseWalls: ['#8a4a2a', '#9a3a2a', '#6a5a4a', '#c9b48e'],
    houseRoofs: ['#f2f5f8', '#e6ebf0'],
    pond: 'ice',
    shore: '#cfd8e2',
    snow: true,
    clouds: true,
    woods: 0.85,
    life: {
      banks: { steps: ['#f4f8fc', '#e8eef6', '#dde6f0'], fence: '#6a4a2e' },
      camps: { count: 1, ground: '#dfe6ee', kind: 'tents' },
      paddocks: { animals: ['reindeer', 'reindeer'], ground: '#e2e8ef', fence: '#6a4a2e' },
      vehicles: [{ kind: 'snowmobile' }, { kind: 'snowmobile' }],
      shirts: ['#e8322a', '#2f6fe0', '#f2c230', '#2fae4e', '#9a45d8', '#222222', '#f07a1a'],
      extras: ['snowmen', 'skaters'],
    },
  },
  nuclear: {
    ground: '#7c8270',
    trees: 'cone',
    treeColors: ['#3c5a35', '#46663c', '#34502f'],
    treeDensity: 0.18,
    bushColors: ['#5a6a48', '#66764f'],
    rockColors: ['#9a9a94', '#7e7e78', '#b0aea6'],
    rockCount: 160,
    houseWalls: [],
    houseRoofs: [],
    pond: 'none',
    shore: '#9a9a94',
    runoff: '#a3a39c',
    houses: false,
    industry: true,
    clouds: true,
    flowers: ['#b8b070', '#9aa060', '#c8c088'],
    life: {
      banks: { steps: ['#b0b0a8', '#a4a49c', '#98988f'], fence: '#f2c230' },
      vehicles: [{ kind: 'truck', ground: '#8e8e86' }, { kind: 'forklift', ground: '#94948c' }, { kind: 'truck', ground: '#8e8e86' }],
      walkers: { count: 25, maxGap: 50 },
      birds: { color: '#f4f2ec', height: 26, flocks: 2 },
      extras: ['workers'],
    },
  },
  brewery: {
    ground: '#5c9a3c',
    trees: 'cone',
    treeColors: ['#3c7d34', '#4a8a3a', '#2f6b2e', '#5a9a3c'],
    treeDensity: 0.7,
    bushColors: ['#3c7d34', '#4a8a3a', '#5a9a3c'],
    rockColors: ['#8c8a84', '#a3a097'],
    rockCount: 60,
    houseWalls: ['#f0e6d2', '#e8d0b0', '#f8f0d8'],
    houseRoofs: ['#a83a2a', '#c8502e', '#6a4a2e'],
    pond: 'water',
    shore: '#b49a68',
    houses: false,
    flowers: ['#f4f0e0', '#f2d23a', '#d878c8'],
    mowed: true,
    clouds: true,
    woods: 0.6,
    life: {
      banks: { steps: ['#64a84a', '#5a9c42', '#52903c'] },
      camps: { count: 2, ground: '#5e9a46', kind: 'tents' },
      paddocks: { animals: ['horse', 'cow'], ground: '#64a24a', fence: '#8a6a4a' },
      bales: '#d8b860',
      vehicles: [{ kind: 'tractor', ground: '#7a5a3a', rows: '#5e4430' }],
      walkers: { count: 30, maxGap: 40 },
      balloon: true,
      birds: { color: '#f4f2ec', height: 24, flocks: 2 },
    },
    patchColors: { 7: '#c8902e' },
    sponsors: [
      ['MEGA LAGER', '#c8861a', '#ffffff'],
      ['HOPS & CO', '#2f7a3a', '#f2e6b0'],
      ['OLD BARREL', '#5a3420', '#f2c230'],
      ['FROTHY ALE', '#f2e6b0', '#8a4a10'],
      ['PILS POWER', '#1d3c8f', '#ffd84a'],
      ['STOUT RACING', '#111111', '#e8d8a0'],
    ],
  },
};

export const TIVOLI_THEME: Theme = {
  ground: '#58a040',
  trees: 'cone',
  treeColors: ['#3c7d34', '#4a8a3a', '#5a9a3c', '#2f6b2e'],
  treeDensity: 0.45,
  bushColors: ['#3c7d34', '#4a8a3a', '#5a9a3c'],
  rockColors: ['#8c8a84', '#a3a097'],
  rockCount: 30,
  houseWalls: [],
  houseRoofs: [],
  pond: 'none',
  shore: '#c8b07a',
  houses: false,
  mowed: true,
  clouds: true,
  life: {
    banks: { steps: ['#64a84a', '#5a9c42', '#52903c'] },
    walkers: { count: 120, maxGap: 70 },
    balloon: true,
    birds: { color: '#f4f2ec', height: 24, flocks: 2 },
  },
  patchColors: { 2: '#e8d048' },
  sponsors: [
    ['CANDY KING', '#f28aa0', '#ffffff'],
    ['POP CORNER', '#f2c230', '#e8322a'],
    ['LOOP-DE-LOOP', '#2f6fe0', '#ffd84a'],
    ['FUN FAIR', '#e8322a', '#ffffff'],
    ['LUCKY WHEEL', '#9a45d8', '#ffd84a'],
    ['SODA SPLASH', '#28c4d0', '#ffffff'],
  ],
};
THEMES.tivoli = TIVOLI_THEME;

/** Tobacco country: leaf-green ground, brown barns, ash grey where the gravel is. */
THEMES.cigar = {
  ground: '#6e8f3a',
  trees: 'cone',
  treeColors: ['#4a6a2a', '#5a7a30', '#3c5a28', '#66803a'],
  treeDensity: 0.35,
  bushColors: ['#5a7a30', '#6a8a38', '#4a6a2a'],
  rockColors: ['#9a8a78', '#b0a08a'],
  rockCount: 40,
  houseWalls: [],
  houseRoofs: [],
  pond: 'none',
  shore: '#b49266',
  houses: false,
  mowed: true,
  clouds: true,
  woods: 0.5,
  life: {
    banks: { steps: ['#78983e', '#6e8e38', '#648432'] },
    paddocks: { animals: ['horse', 'cow'], ground: '#76963e', fence: '#6a4a2e' },
    vehicles: [{ kind: 'tractor', ground: '#6a5a34', rows: '#4a7a2a' }],
    walkers: { count: 20, maxGap: 40 },
    shirts: ['#f4f0e6', '#f4f0e6', '#e8322a', '#2f6fe0', '#f2c230', '#2fae4e', '#5ac8c8'],
    birds: { color: '#f4f2ec', height: 22, flocks: 3 },
    extras: ['windpumps'],
  },
  // Ash instead of gravel, tar instead of oil.
  patchColors: { 3: '#8d8a86', 7: '#3a2616' },
  sponsors: [
    ['HAVANA GOLD', '#141010', '#f2c230'],
    ['EL MEGA', '#8a1e1e', '#f2e6b0'],
    ['DON CARLOS', '#2a1a10', '#e8c060'],
    ['ROBUSTO', '#c8322a', '#ffffff'],
    ['CORONA', '#2f5a3a', '#f2e6b0'],
    ['MADURO RACING', '#5a3420', '#f2c230'],
  ],
};

/** Midtown: asphalt and concrete, a few street trees, towers all around. */
THEMES.city = {
  ground: '#5a5e64',
  trees: 'leafy',
  treeColors: ['#3c7d34', '#4a8a3a', '#2f6b2e', '#5a9a3c'],
  treeDensity: 0.12,
  bushColors: ['#3f6b3a', '#4a7a42', '#35603a'],
  rockColors: ['#8a8d90'],
  rockCount: 0,
  houseWalls: [],
  houseRoofs: [],
  pond: 'none',
  shore: '#9a978f',
  // Concrete sidewalks between the asphalt and the barriers.
  runoff: '#9a978f',
  houses: false,
  clouds: true,
  life: {
    banks: { steps: ['#8a8d92', '#7e8186', '#74777c'], fence: '#c8ccd0' },
    walkers: { count: 160, maxGap: 60 },
    birds: { color: '#8a8d96', height: 10, flocks: 4, size: 0.9 },
  },
  patchColors: { 2: '#24384a' },
  sponsors: [
    ['BIG APPLE', '#c8261f', '#ffd84a'],
    ['MEGA COLA', '#1d3c8f', '#ffffff'],
    ['MIDTOWN 24H', '#111111', '#f2c230'],
    ['BROADWAY', '#f4f0e6', '#c8261f'],
    ['PIXEL PIZZA', '#2f8a4a', '#ffffff'],
    ['SUBWAY RACING', '#1d3c8f', '#ffffff'],
  ],
};

export function themeOf(id: string): Theme {
  return THEMES[id] ?? COUNTRYSIDE;
}
