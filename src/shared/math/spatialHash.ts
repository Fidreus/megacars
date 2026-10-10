// Static uniform grid over line segments (walls), stored CSR-style so queries
// never allocate.

export class SegmentGrid {
  readonly cell: number;
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  private readonly stamp: Uint32Array;
  private queryId = 0;

  constructor(
    ax: ArrayLike<number>, az: ArrayLike<number>, bx: ArrayLike<number>, bz: ArrayLike<number>,
    count: number, cell: number,
  ) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      minX = Math.min(minX, ax[i], bx[i]);
      maxX = Math.max(maxX, ax[i], bx[i]);
      minZ = Math.min(minZ, az[i], bz[i]);
      maxZ = Math.max(maxZ, az[i], bz[i]);
    }
    if (count === 0) minX = minZ = maxX = maxZ = 0;
    this.cell = cell;
    this.minX = minX - cell;
    this.minZ = minZ - cell;
    this.cols = Math.max(1, Math.ceil((maxX - this.minX) / cell) + 2);
    this.rows = Math.max(1, Math.ceil((maxZ - this.minZ) / cell) + 2);
    const ncell = this.cols * this.rows;
    const counts = new Int32Array(ncell + 1);
    const visit = (i: number, fn: (c: number) => void) => {
      // Conservative: every cell overlapped by the segment's bounding box.
      const c0 = this.colOf(Math.min(ax[i], bx[i])), c1 = this.colOf(Math.max(ax[i], bx[i]));
      const r0 = this.rowOf(Math.min(az[i], bz[i])), r1 = this.rowOf(Math.max(az[i], bz[i]));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * this.cols + c);
    };
    for (let i = 0; i < count; i++) visit(i, (c) => counts[c + 1]++);
    for (let c = 0; c < ncell; c++) counts[c + 1] += counts[c];
    this.start = counts;
    this.items = new Int32Array(counts[ncell]);
    const fill = new Int32Array(ncell);
    for (let i = 0; i < count; i++) visit(i, (c) => (this.items[counts[c] + fill[c]++] = i));
    this.stamp = new Uint32Array(count);
  }

  private colOf(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
  }

  private rowOf(z: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.cell)));
  }

  /** Writes indices of segments whose cells overlap the circle's bounds into `out`. Returns count. */
  query(x: number, z: number, r: number, out: Int32Array): number {
    const id = ++this.queryId;
    const c0 = this.colOf(x - r), c1 = this.colOf(x + r);
    const r0 = this.rowOf(z - r), r1 = this.rowOf(z + r);
    let n = 0;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cellIdx = row * this.cols + col;
        for (let k = this.start[cellIdx], e = this.start[cellIdx + 1]; k < e; k++) {
          const seg = this.items[k];
          if (this.stamp[seg] !== id && n < out.length) {
            this.stamp[seg] = id;
            out[n++] = seg;
          }
        }
      }
    }
    return n;
  }
}
