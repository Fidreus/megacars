import type { SurfaceId } from '../config/surfaces.ts';
import type { SegmentGrid } from '../math/spatialHash.ts';
import type { Pit } from './pit.ts';
import type { CrateSpot } from '../sim/crates.ts';

/** A corner of the closed track polygon; `r` is the fillet radius of the centreline. */
export interface PathPoint {
  x: number;
  z: number;
  r: number;
}

/** Circular surface patch (ice, gravel, oil...) applied to the road. */
export interface SurfacePatch {
  surface: SurfaceId;
  x: number;
  z: number;
  r: number;
  /** Also cover the run-off area next to the road. */
  runoff?: boolean;
  /** Axis-aligned rectangle instead of a circle: half sizes along x and z (r is then ignored). */
  hx?: number;
  hz?: number;
}

/** A jump ramp across the road. (x, z) is the lip; the ramp rises over `length` metres before it. */
export interface RampDef {
  x: number;
  z: number;
  length: number;
  height: number;
}

/** A built ramp: rises from s0 to s1 along the centreline. */
export interface Ramp {
  s0: number;
  s1: number;
  height: number;
}

/**
 * A bridge where the track crosses itself. (x, z) is the crossing point; the
 * pass that goes over is `upper` (0 = the first time the lap goes through
 * the crossing, counted from the start line, 1 = the second).
 */
export interface BridgeDef {
  x: number;
  z: number;
  upper: 0 | 1;
  /** Deck height, metres. */
  height: number;
  /** Half length of the flat deck along the upper road (must clear the lower road). */
  span: number;
  /** Length of each approach slope. */
  ramp: number;
  /**
   * Broken bridge: no deck over the lower road. The approach rises like a
   * ski jump to the edge, and the far side starts lower and slopes down.
   * Too slow and you drop into the hole.
   */
  gap?: boolean;
}

/** A built bridge, along the upper pass's centreline distance. */
export interface Bridge {
  /** Where the upper pass crosses (s), and where the lower pass does. */
  s: number;
  sLower: number;
  height: number;
  span: number;
  ramp: number;
  gap: boolean;
}

export interface TrackDef {
  id: string;
  name: string;
  theme: string;
  /** Road width in metres. */
  width: number;
  /** Extra half-width in the corners (metres each side), eased in and out along the road. */
  cornerWiden?: number;
  /** Grass/gravel strip between road edge and barrier, metres. */
  runoff: number;
  runoffSurface?: SurfaceId;
  /** Closed polygon, driven in order. Corners are rounded with their radius. */
  path: readonly PathPoint[];
  /** Start line position as a fraction along the straight from the last point to the first. */
  startAt: number;
  patches?: readonly SurfacePatch[];
  ramps?: readonly RampDef[];
  bridges?: readonly BridgeDef[];
  /** Scenery the theme puts at fixed spots (only looks, no effect on driving). */
  landmarks?: readonly { kind: string; x: number; z: number }[];
  laps?: number;
  /** Short tracks: laps raced per lap chosen in the menus (default 1). */
  lapScale?: number;
  seed?: number;
}

export interface Walls {
  count: number;
  ax: Float64Array;
  az: Float64Array;
  bx: Float64Array;
  bz: Float64Array;
  /** Unit normal pointing toward the road. */
  nx: Float64Array;
  nz: Float64Array;
  /** Heights the wall stops cars between (bridges: a car passes over or under it). */
  lo: Float64Array;
  hi: Float64Array;
  grid: SegmentGrid;
  /** Smooth barrier polylines for rendering (closed loops), x/z interleaved. */
  outlines: Float64Array[];
}

export interface SurfaceGrid {
  minX: number;
  minZ: number;
  cell: number;
  cols: number;
  rows: number;
  data: Uint8Array;
  /** Distance from cell centre to the centreline, metres. */
  dist: Float32Array;
}

export interface GridSlot {
  x: number;
  z: number;
  heading: number;
}

export interface RacingLine {
  off: Float64Array;
  x: Float64Array;
  z: Float64Array;
  curv: Float64Array;
  /** Cumulative length along the line. */
  s: Float64Array;
  length: number;
}

export interface Track {
  def: TrackDef;
  /** Number of centreline samples (~1 m apart). */
  n: number;
  length: number;
  px: Float64Array;
  pz: Float64Array;
  /** Unit tangent (direction of travel). */
  tx: Float64Array;
  tz: Float64Array;
  /** Unit normal pointing to the right of travel. */
  nx: Float64Array;
  nz: Float64Array;
  s: Float64Array;
  curv: Float64Array;
  hw: Float64Array;
  walls: Walls;
  surface: SurfaceGrid;
  /** Checkpoint positions along s; index 0 is the start/finish line (s = 0). */
  checkpoints: Float64Array;
  grid: GridSlot[];
  ramps: Ramp[];
  bridges: Bridge[];
  /** Road height per sample (bridges; 0 elsewhere). Nominal deck height over a gap. */
  elev: Float64Array;
  /** Per sample: 0 = road on the ground, 1 = embankment, 2 = deck open underneath, 3 = gap (no road). */
  deck: Uint8Array;
  line: RacingLine;
  /** Pit lane beside the start straight (null when there's no room). */
  pit: Pit | null;
  /** Catch-up boost pads (start of each along s; see sim/catchUp.ts). */
  boosts: number[];
  /** Item crates, row by row (see sim/crates.ts). */
  crates: CrateSpot[];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Problems found while building (empty when the track is valid). */
  errors: string[];
}
