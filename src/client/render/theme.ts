// Look of a track's surroundings by theme: ground colour, what grows there,
// rocks, buildings and whether the pond is water or ice.

export interface Theme {
  ground: string;
  /** cone: conifers + round trees; cactus: saguaros; snowpine: snow-capped firs. */
  trees: 'cone' | 'cactus' | 'snowpine';
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
}

const COUNTRYSIDE: Theme = {
  ground: '#4c8a3a',
  trees: 'cone',
  treeColors: ['#2f6b2e', '#3c7d34', '#2a5f33', '#4a8a3a', '#356f2a'],
  treeDensity: 1,
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
  },
};

export function themeOf(id: string): Theme {
  return THEMES[id] ?? COUNTRYSIDE;
}
