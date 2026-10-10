import type { SurfaceId } from '../config/surfaces.ts';
import type { SegmentGrid } from '../math/spatialHash.ts';

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
}

export interface TrackDef {
  id: string;
  name: string;
  theme: string;
  /** Road width in metres. */
  width: number;
  /** Grass/gravel strip between road edge and barrier, metres. */
  runoff: number;
  runoffSurface?: SurfaceId;
  /** Closed polygon, driven in order. Corners are rounded with their radius. */
  path: readonly PathPoint[];
  /** Start line position as a fraction along the straight from the last point to the first. */
  startAt: number;
  patches?: readonly SurfacePatch[];
  laps?: number;
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
  line: RacingLine;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Problems found while building (empty when the track is valid). */
  errors: string[];
}
