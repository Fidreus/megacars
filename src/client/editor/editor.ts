// The track editor: a top-down map of a player track on its own sharp
// canvas over the game. Drag corners to shape the road, a corner's knob to
// change its radius, tap the road between corners to add one; paint surface
// patches, drop ramps and landmarks, slide the start line. Every change is
// built (lite) and checked at once, and problems are marked on the map.
// Mouse, touch (pinch to zoom, drag to pan) and keyboard shortcuts.

import { Surface, type SurfaceId } from '../../shared/config/surfaces.ts';
import { sampleIndexAt } from '../../shared/track/builder.ts';
import { canonicalDef, checkTrackDef, cleanTrackName, LIMITS, PATCH_SURFACES, THEME_LANDMARKS, TRACK_THEMES, type TrackCheck } from '../../shared/track/custom.ts';
import { PIT } from '../../shared/track/pit.ts';
import type { PathPoint, RampDef, SurfacePatch, TrackDef } from '../../shared/track/types.ts';
import { headingOf, wrapAngle } from '../../shared/math/angle.ts';
import { drawText, textWidth } from '../ui/font.ts';
import { themeOf } from '../render/theme.ts';
import { SURFACE_COLORS } from '../render/trackMesh.ts';

export interface EditorHost {
  /** Drive the track (free practice); the editor opens again afterwards. */
  testDrive(def: TrackDef): void;
  /** Save to My Tracks; returns the slot it is kept in. */
  save(def: TrackDef, slot: string | null): string;
  share(def: TrackDef): void;
  publish(def: TrackDef): void;
  /** Eight computer cars on it, in a worker: resolves with a one-line verdict. */
  aiTest(def: TrackDef): Promise<string>;
  exit(): void;
  sound(kind: 'move' | 'change' | 'select' | 'deny'): void;
}

type Tool = 'shape' | 'surface' | 'ramp' | 'mark';
type Sel = { kind: 'point' | 'patch' | 'ramp' | 'mark'; i: number } | null;
type Drag =
  | { kind: 'pan'; camX: number; camZ: number }
  | { kind: 'point' | 'patch' | 'ramp' | 'mark'; i: number; dx: number; dz: number }
  | { kind: 'radius'; i: number }
  | { kind: 'size'; i: number }
  | { kind: 'start' };

interface Draft {
  name: string;
  theme: string;
  width: number;
  cornerWiden: number;
  runoff: number;
  runoffSurface?: SurfaceId;
  startAt: number;
  laps: number;
  lapScale: number;
  seed: number;
  path: PathPoint[];
  patches: SurfacePatch[];
  ramps: RampDef[];
  landmarks: { kind: string; x: number; z: number }[];
}

interface Button {
  /** Buttons are drawn anew every frame: the label and place say which one it is. */
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  act: () => void;
  on?: boolean;
  off?: boolean;
}

const SURFACE_NAMES: Record<number, string> = {
  [Surface.Gravel]: 'GRAVEL', [Surface.Ice]: 'ICE', [Surface.Oil]: 'OIL', [Surface.Wet]: 'WET',
  [Surface.Snow]: 'SNOW', [Surface.ShallowWater]: 'WATER', [Surface.Grass]: 'GRASS',
};
/** Run-off choices: the theme's own, or one of these. */
const RUNOFFS: (SurfaceId | undefined)[] = [undefined, Surface.Gravel, Surface.Snow, Surface.Grass];
const TOOL_NAMES: Record<Tool, string> = { shape: 'ROAD', surface: 'SURFACE', ramp: 'RAMP', mark: 'LANDMARK' };
const TOOL_HINT: Record<Tool, string> = {
  shape: 'DRAG CORNERS - DRAG A KNOB FOR THE RADIUS - TAP THE ROAD TO ADD A CORNER',
  surface: 'TAP TO PAINT A PATCH - DRAG IT, OR ITS EDGE KNOB TO RESIZE',
  ramp: 'TAP THE ROAD TO PUT A JUMP THERE (UP TO 4)',
  mark: 'TAP TO PLACE A LANDMARK OF THE THEME',
};

/** A fresh track: a rounded rectangle with a long start straight. */
export function blankTrack(): TrackDef {
  return {
    id: 'draft', name: 'MY TRACK', theme: 'countryside', width: 18, runoff: 5, startAt: 0.5, laps: 3,
    seed: Math.floor(Math.random() * 9999),
    path: [{ x: 250, z: 0, r: 40 }, { x: 250, z: 200, r: 40 }, { x: -250, z: 200, r: 40 }, { x: -250, z: 0, r: 40 }],
  };
}

function toDraft(def: TrackDef): Draft {
  return {
    name: def.name, theme: def.theme, width: def.width, cornerWiden: def.cornerWiden ?? 0, runoff: def.runoff,
    runoffSurface: def.runoffSurface, startAt: def.startAt, laps: def.laps ?? 3, lapScale: def.lapScale ?? 1, seed: def.seed ?? 1,
    path: def.path.map((p) => ({ ...p })),
    patches: (def.patches ?? []).map((p) => ({ ...p })),
    ramps: (def.ramps ?? []).map((r) => ({ ...r })),
    landmarks: (def.landmarks ?? []).map((l) => ({ ...l })),
  };
}

function toDef(d: Draft): TrackDef {
  return canonicalDef({
    id: 'draft', name: d.name, theme: d.theme, width: d.width, cornerWiden: d.cornerWiden, runoff: d.runoff, runoffSurface: d.runoffSurface,
    startAt: d.startAt, laps: d.laps, lapScale: d.lapScale, seed: d.seed, path: d.path, patches: d.patches, ramps: d.ramps, landmarks: d.landmarks,
  });
}

export class TrackEditor {
  active = false;
  private readonly host: EditorHost;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private draft: Draft = toDraft(blankTrack());
  private slot: string | null = null;
  private dirty = false;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private check: TrackCheck | null = null;
  /** Corners in the draft when it was last checked. */
  private checkedCorners = 0;
  private checkDue = 0;
  private tool: Tool = 'shape';
  private sel: Sel = null;
  private settingsOpen = false;
  private snap = true;
  private surface: SurfaceId = Surface.Gravel;
  private markKind = 0;
  private camX = 0;
  private camZ = 100;
  /** Device pixels per metre. */
  private zoom = 1;
  private readonly pointers = new Map<number, { x: number; y: number; sx: number; sy: number; moved: boolean }>();
  private drag: Drag | null = null;
  private dragUndo = false;
  private pinch: { d: number; zoom: number; mx: number; my: number; camX: number; camZ: number } | null = null;
  /** The button held down (its key: a click lasts several frames). */
  private pressed: string | null = null;
  private buttons: Button[] = [];
  private note = '';
  private noteTime = 0;
  private aiNote = '';
  private busy = false;
  /** Pixel font scale. */
  private k = 2;
  private W = 0;
  private H = 0;

  constructor(host: EditorHost) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100dvh;display:none;z-index:5;touch-action:none;cursor:crosshair;background:#10141c';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.up(e, true));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = this.px(e);
      this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e));
  }

  /** Open a track (or a fresh one) to edit; `slot` is where it is saved in My Tracks. */
  open(def: TrackDef | null, slot: string | null): void {
    this.draft = toDraft(def ?? blankTrack());
    this.slot = slot;
    this.dirty = !def;
    this.undoStack = [];
    this.redoStack = [];
    this.sel = null;
    this.tool = 'shape';
    this.settingsOpen = false;
    this.aiNote = '';
    this.active = true;
    this.canvas.style.display = 'block';
    this.resize();
    this.recheck();
    this.fit();
  }

  /** Back from a test drive: the same draft, view and selection. */
  resume(): void {
    this.active = true;
    this.canvas.style.display = 'block';
  }

  hide(): void {
    this.active = false;
    this.canvas.style.display = 'none';
    this.pointers.clear();
    this.drag = null;
    this.pinch = null;
  }

  /** The draft as a track definition (canonical). */
  get def(): TrackDef {
    return toDef(this.draft);
  }

  /** The draft builds and drives (it may still lack a pit or arrows). */
  get ok(): boolean {
    return !!this.check && !this.check.errors.length;
  }

  /** For tests: corners on screen (CSS pixels), the problems and the draft. */
  debugState(): { corners: [number, number][]; errors: string[]; missing: string[]; points: number; tool: string; note: string; ai: string } {
    const f = this.canvas.clientWidth / (this.W || 1);
    return {
      corners: this.draft.path.map((p) => this.toScreen(p.x, p.z).map((v) => Math.round(v * f)) as [number, number]),
      errors: this.check?.errors ?? [],
      missing: this.check?.missing ?? [],
      points: this.draft.path.length,
      tool: this.tool,
      note: this.noteTime > 0 ? this.note : '',
      ai: this.aiNote,
    };
  }

  /** The editor's slot in My Tracks (set once saved). */
  get savedSlot(): string | null {
    return this.slot;
  }

  // ------------------------------------------------------------- editing

  private snapshot(): void {
    this.undoStack.push(JSON.stringify(this.draft));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private changed(): void {
    this.dirty = true;
    this.checkDue = 0.12;
    // A corner more or less: the problems are marked by corner number, so check now.
    if (this.draft.path.length !== this.checkedCorners) this.recheck();
  }

  private undo(redo = false): void {
    const from = redo ? this.redoStack : this.undoStack;
    const to = redo ? this.undoStack : this.redoStack;
    const s = from.pop();
    if (!s) return this.host.sound('deny');
    to.push(JSON.stringify(this.draft));
    this.draft = JSON.parse(s) as Draft;
    this.sel = null;
    this.changed();
    this.host.sound('change');
  }

  private recheck(): void {
    this.checkedCorners = this.draft.path.length;
    try {
      this.check = checkTrackDef(this.def);
    } catch {
      this.check = null;
    }
  }

  /** A short message over the map. */
  flash(text: string): void {
    this.note = text;
    this.noteTime = 3;
  }

  private snapV(v: number): number {
    return this.snap ? Math.round(v / 5) * 5 : Math.round(v * 2) / 2;
  }

  private deleteSel(): void {
    const s = this.sel;
    if (!s) return;
    this.snapshot();
    const d = this.draft;
    if (s.kind === 'point') {
      if (d.path.length <= 3) {
        this.flash('A TRACK NEEDS AT LEAST 3 CORNERS');
        this.undoStack.pop();
        return this.host.sound('deny');
      }
      d.path.splice(s.i, 1);
    } else if (s.kind === 'patch') d.patches.splice(s.i, 1);
    else if (s.kind === 'ramp') d.ramps.splice(s.i, 1);
    else d.landmarks.splice(s.i, 1);
    this.sel = null;
    this.changed();
    this.host.sound('change');
  }

  // ---------------------------------------------------------- geometry

  /** Corner i's turn (signed radians) and the bisector pointing into the bend. */
  private corner(i: number): { turn: number; bx: number; bz: number; tl: number } {
    const P = this.draft.path;
    const n = P.length;
    const prev = P[(i - 1 + n) % n];
    const cur = P[i];
    const next = P[(i + 1) % n];
    const hin = headingOf(cur.x - prev.x, cur.z - prev.z);
    const hout = headingOf(next.x - cur.x, next.z - cur.z);
    const turn = wrapAngle(hout - hin);
    // Unit vectors back to the previous corner and on to the next: the bend's inside is between them.
    const ax = prev.x - cur.x, az = prev.z - cur.z;
    const cx = next.x - cur.x, cz = next.z - cur.z;
    const la = Math.hypot(ax, az) || 1, lc = Math.hypot(cx, cz) || 1;
    let bx = ax / la + cx / lc, bz = az / la + cz / lc;
    const lb = Math.hypot(bx, bz) || 1;
    bx /= lb;
    bz /= lb;
    return { turn, bx, bz, tl: cur.r * Math.tan(Math.abs(turn) / 2) };
  }

  /** Where corner i's radius knob sits: the middle of its arc. */
  private knob(i: number): [number, number] {
    const p = this.draft.path[i];
    const c = this.corner(i);
    const half = Math.abs(c.turn) / 2;
    const d = half > 1e-3 ? p.r / Math.cos(half) - p.r : 0;
    return [p.x + c.bx * d, p.z + c.bz * d];
  }

  /** The start line on the last straight (from the end of the last bend to the first). */
  private startLine(): { x: number; z: number; ax: number; az: number; bx: number; bz: number } {
    const P = this.draft.path;
    const n = P.length;
    const last = P[n - 1];
    const first = P[0];
    const dx = first.x - last.x, dz = first.z - last.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const a = this.corner(n - 1).tl;
    const b = this.corner(0).tl;
    const ax = last.x + ux * a, az = last.z + uz * a;
    const bx = first.x - ux * b, bz = first.z - uz * b;
    const t = this.draft.startAt;
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, ax, az, bx, bz };
  }

  // ------------------------------------------------------------ input

  private px(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (this.W / r.width), (e.clientY - r.top) * (this.H / r.height)];
  }

  private toWorld(x: number, y: number): [number, number] {
    return [this.camX + (x - this.W / 2) / this.zoom, this.camZ + (y - this.H / 2) / this.zoom];
  }

  private toScreen(x: number, z: number): [number, number] {
    return [this.W / 2 + (x - this.camX) * this.zoom, this.H / 2 + (z - this.camZ) * this.zoom];
  }

  private zoomAt(x: number, y: number, f: number): void {
    const [wx, wz] = this.toWorld(x, y);
    this.zoom = Math.max(0.12, Math.min(8, this.zoom * f));
    this.camX = wx - (x - this.W / 2) / this.zoom;
    this.camZ = wz - (y - this.H / 2) / this.zoom;
  }

  private fit(): void {
    const t = this.check?.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (t) ({ minX, maxX, minZ, maxZ } = t.bounds);
    else for (const p of this.draft.path) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this.camX = (minX + maxX) / 2;
    this.camZ = (minZ + maxZ) / 2;
    const bar = 16 * this.k;
    this.zoom = Math.min((this.W - 2 * 90 * this.k / 2) / (maxX - minX + 40), (this.H - 3 * bar) / (maxZ - minZ + 40));
    this.zoom = Math.max(0.12, Math.min(8, this.zoom));
  }

  private buttonAt(x: number, y: number): Button | null {
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
    }
    return null;
  }

  /** The handle under (x, y) for the current tool. */
  private handleAt(x: number, y: number): Drag | null {
    const r = 9 * this.k;
    const near = (wx: number, wz: number) => {
      const [sx, sy] = this.toScreen(wx, wz);
      return Math.hypot(sx - x, sy - y) < r;
    };
    const d = this.draft;
    const [wx, wz] = this.toWorld(x, y);
    const s = this.sel;
    if (this.tool === 'shape') {
      if (s?.kind === 'point') {
        // A corner with hardly any turn has its knob on top of it: then the corner wins.
        const [kx, kz] = this.knob(s.i);
        const [cx, cy] = this.toScreen(d.path[s.i].x, d.path[s.i].z);
        const [ox, oy] = this.toScreen(kx, kz);
        if (near(kx, kz) && Math.hypot(ox - cx, oy - cy) > r) return { kind: 'radius', i: s.i };
      }
      for (let i = d.path.length - 1; i >= 0; i--) if (near(d.path[i].x, d.path[i].z)) return { kind: 'point', i, dx: d.path[i].x - wx, dz: d.path[i].z - wz };
      const st = this.startLine();
      if (near(st.x, st.z)) return { kind: 'start' };
    } else if (this.tool === 'surface') {
      if (s?.kind === 'patch') {
        const p = d.patches[s.i];
        if (near(p.x + (p.hx ?? p.r), p.z)) return { kind: 'size', i: s.i };
      }
      for (let i = d.patches.length - 1; i >= 0; i--) {
        const p = d.patches[i];
        if (near(p.x, p.z) || Math.hypot(p.x - wx, p.z - wz) < Math.min(p.r || 1e9, p.hx ?? 1e9) * 0.7) return { kind: 'patch', i, dx: p.x - wx, dz: p.z - wz };
      }
    } else if (this.tool === 'ramp') {
      for (let i = d.ramps.length - 1; i >= 0; i--) if (near(d.ramps[i].x, d.ramps[i].z)) return { kind: 'ramp', i, dx: d.ramps[i].x - wx, dz: d.ramps[i].z - wz };
    } else {
      for (let i = d.landmarks.length - 1; i >= 0; i--) if (near(d.landmarks[i].x, d.landmarks[i].z)) return { kind: 'mark', i, dx: d.landmarks[i].x - wx, dz: d.landmarks[i].z - wz };
    }
    return null;
  }

  private down(e: PointerEvent): void {
    if (!this.active) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.px(e);
    this.pointers.set(e.pointerId, { x, y, sx: x, sy: y, moved: false });
    if (this.pointers.size === 2) {
      // Two fingers: pinch to zoom and move the map.
      const [a, b] = [...this.pointers.values()];
      this.drag = null;
      this.pressed = null;
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, camX: this.camX, camZ: this.camZ };
      return;
    }
    if (this.pointers.size > 2) return;
    const btn = this.buttonAt(x, y);
    if (btn) {
      this.pressed = btn.key;
      return;
    }
    if (e.button === 2 || e.button === 1) {
      this.drag = { kind: 'pan', camX: this.camX, camZ: this.camZ };
      return;
    }
    const h = this.handleAt(x, y);
    this.dragUndo = false;
    if (h) {
      if (h.kind === 'point' || h.kind === 'patch' || h.kind === 'ramp' || h.kind === 'mark') {
        if (this.sel?.kind !== h.kind || this.sel.i !== h.i) this.host.sound('move');
        this.sel = { kind: h.kind, i: h.i };
      }
      this.drag = h;
    } else {
      this.drag = { kind: 'pan', camX: this.camX, camZ: this.camZ };
    }
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.active) return;
    const [x, y] = this.px(e);
    p.x = x;
    p.y = y;
    if (Math.hypot(x - p.sx, y - p.sy) > 6) p.moved = true;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const pc = this.pinch;
      this.zoom = Math.max(0.12, Math.min(8, pc.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pc.d))));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.camX = pc.camX - (mx - pc.mx) / this.zoom;
      this.camZ = pc.camZ - (my - pc.my) / this.zoom;
      return;
    }
    const dr = this.drag;
    if (!dr || !p.moved) return;
    if (dr.kind === 'pan') {
      this.camX = dr.camX - (x - p.sx) / this.zoom;
      this.camZ = dr.camZ - (y - p.sy) / this.zoom;
      return;
    }
    if (!this.dragUndo) {
      this.snapshot();
      this.dragUndo = true;
    }
    const [wx, wz] = this.toWorld(x, y);
    const d = this.draft;
    if (dr.kind === 'point') {
      d.path[dr.i].x = this.snapV(wx + dr.dx);
      d.path[dr.i].z = this.snapV(wz + dr.dz);
    } else if (dr.kind === 'patch') {
      d.patches[dr.i].x = this.snapV(wx + dr.dx);
      d.patches[dr.i].z = this.snapV(wz + dr.dz);
    } else if (dr.kind === 'ramp') {
      d.ramps[dr.i].x = this.snapV(wx + dr.dx);
      d.ramps[dr.i].z = this.snapV(wz + dr.dz);
    } else if (dr.kind === 'mark') {
      d.landmarks[dr.i].x = this.snapV(wx + dr.dx);
      d.landmarks[dr.i].z = this.snapV(wz + dr.dz);
    } else if (dr.kind === 'radius') {
      // Along the bisector: the knob sits r(1/cos(half) - 1) from the corner.
      const pt = d.path[dr.i];
      const c = this.corner(dr.i);
      const along = (wx - pt.x) * c.bx + (wz - pt.z) * c.bz;
      const half = Math.abs(c.turn) / 2;
      const f = 1 / Math.cos(half) - 1;
      if (f > 1e-3) pt.r = Math.round(Math.max(LIMITS.radius[0], Math.min(LIMITS.radius[1], along / f)));
    } else if (dr.kind === 'size') {
      const pa = d.patches[dr.i];
      const r = Math.max(2, Math.min(60, Math.round(Math.hypot(wx - pa.x, wz - pa.z))));
      if (pa.hx !== undefined) {
        pa.hz = Math.max(1, (pa.hz ?? r) * (r / pa.hx));
        pa.hx = r;
      } else pa.r = r;
    } else if (dr.kind === 'start') {
      const st = this.startLine();
      const vx = st.bx - st.ax, vz = st.bz - st.az;
      const t = ((wx - st.ax) * vx + (wz - st.az) * vz) / Math.max(1, vx * vx + vz * vz);
      d.startAt = Math.max(0.05, Math.min(0.95, Math.round(t * 100) / 100));
    }
    this.changed();
  }

  private up(e: PointerEvent, cancel = false): void {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p || !this.active) return;
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.drag = null;
      return;
    }
    const held = this.pressed;
    this.pressed = null;
    if (held) {
      const btn = this.buttonAt(p.x, p.y);
      if (!cancel && btn?.key === held && !btn.off) btn.act();
      return;
    }
    const dr = this.drag;
    this.drag = null;
    if (cancel) return;
    if (!p.moved && (dr === null || dr.kind === 'pan')) this.tap(p.x, p.y);
    if (this.dragUndo) this.host.sound('change');
  }

  /** A tap on the map (not a drag): add or select, depending on the tool. */
  private tap(x: number, y: number): void {
    const [wx, wz] = this.toWorld(x, y);
    const d = this.draft;
    if (this.tool === 'shape') {
      // On (or near) the line between two corners: a new corner there.
      let best = -1;
      let bestD = 18 * this.k;
      for (let i = 0; i < d.path.length; i++) {
        const a = d.path[i], b = d.path[(i + 1) % d.path.length];
        const [ax, ay] = this.toScreen(a.x, a.z);
        const [bx, by] = this.toScreen(b.x, b.z);
        const vx = bx - ax, vy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / Math.max(1, vx * vx + vy * vy)));
        const dd = Math.hypot(ax + vx * t - x, ay + vy * t - y);
        if (dd < bestD && t > 0.08 && t < 0.92) {
          bestD = dd;
          best = i;
        }
      }
      if (best >= 0 && d.path.length < LIMITS.points[1]) {
        this.snapshot();
        d.path.splice(best + 1, 0, { x: this.snapV(wx), z: this.snapV(wz), r: 30 });
        this.sel = { kind: 'point', i: best + 1 };
        this.changed();
        this.host.sound('select');
      } else {
        this.sel = null;
      }
    } else if (this.tool === 'surface') {
      if (d.patches.length >= LIMITS.patches) return this.denied(`AT MOST ${LIMITS.patches} PATCHES`);
      this.snapshot();
      d.patches.push({ surface: this.surface, x: this.snapV(wx), z: this.snapV(wz), r: 12 });
      this.sel = { kind: 'patch', i: d.patches.length - 1 };
      this.changed();
      this.host.sound('select');
    } else if (this.tool === 'ramp') {
      const t = this.check?.track;
      if (!t) return;
      if (d.ramps.length >= LIMITS.ramps) return this.denied(`AT MOST ${LIMITS.ramps} JUMPS`);
      let best = 0, bestD = Infinity;
      for (let i = 0; i < t.n; i++) {
        const dd = (t.px[i] - wx) ** 2 + (t.pz[i] - wz) ** 2;
        if (dd < bestD) { bestD = dd; best = i; }
      }
      if (Math.sqrt(bestD) > t.hw[best] + 6) return this.denied('TAP ON THE ROAD');
      this.snapshot();
      d.ramps.push({ x: Math.round(t.px[best] * 2) / 2, z: Math.round(t.pz[best] * 2) / 2, length: 10, height: 1.4 });
      this.sel = { kind: 'ramp', i: d.ramps.length - 1 };
      this.changed();
      this.host.sound('select');
    } else {
      const kinds = THEME_LANDMARKS[d.theme];
      if (!kinds) return this.denied('THIS THEME HAS NO LANDMARKS - TRY BREWERY, TIVOLI, CIGAR OR CITY');
      if (d.landmarks.length >= LIMITS.landmarks) return this.denied(`AT MOST ${LIMITS.landmarks} LANDMARKS`);
      this.snapshot();
      d.landmarks.push({ kind: kinds[this.markKind % kinds.length], x: this.snapV(wx), z: this.snapV(wz) });
      this.sel = { kind: 'mark', i: d.landmarks.length - 1 };
      this.changed();
      this.host.sound('select');
    }
  }

  private denied(text: string): void {
    this.flash(text);
    this.host.sound('deny');
  }

  private key(e: KeyboardEvent): void {
    if (!this.active) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const pan = 60 / this.zoom;
    let used = true;
    if (ctrl && e.code === 'KeyZ') this.undo(e.shiftKey);
    else if (ctrl && e.code === 'KeyY') this.undo(true);
    else if (e.code === 'Delete' || e.code === 'Backspace') this.deleteSel();
    else if (e.code === 'Escape') {
      if (this.settingsOpen) this.settingsOpen = false;
      else if (this.sel) this.sel = null;
      else this.exit();
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.camX -= pan;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.camX += pan;
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.camZ -= pan;
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.camZ += pan;
    else if (e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomAt(this.W / 2, this.H / 2, 1.25);
    else if (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomAt(this.W / 2, this.H / 2, 0.8);
    else if (e.code === 'Digit1') this.setTool('shape');
    else if (e.code === 'Digit2') this.setTool('surface');
    else if (e.code === 'Digit3') this.setTool('ramp');
    else if (e.code === 'Digit4') this.setTool('mark');
    else if (e.code === 'KeyG') this.snap = !this.snap;
    else if (e.code === 'KeyF') this.fit();
    else used = false;
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.sel = null;
    this.settingsOpen = false;
    this.host.sound('move');
  }

  // ------------------------------------------------------------ actions

  private save(): void {
    this.slot = this.host.save(this.def, this.slot);
    this.dirty = false;
    this.flash('SAVED IN MY TRACKS');
    this.host.sound('select');
  }

  private exit(): void {
    if (this.dirty) this.slot = this.host.save(this.def, this.slot);
    this.dirty = false;
    this.hide();
    this.host.exit();
  }

  private drive(): void {
    if (this.check?.errors.length) return this.denied('FIX THE MARKED PROBLEMS FIRST');
    this.slot = this.host.save(this.def, this.slot);
    this.dirty = false;
    this.hide();
    this.host.testDrive(this.def);
  }

  private aiTest(): void {
    if (this.check?.errors.length) return this.denied('FIX THE MARKED PROBLEMS FIRST');
    if (this.busy) return;
    this.busy = true;
    this.aiNote = 'AI TEST: 8 CARS DRIVING...';
    this.host.aiTest(this.def).then((v) => (this.aiNote = v), () => (this.aiNote = 'AI TEST FAILED')).finally(() => (this.busy = false));
  }

  private rename(): void {
    const name = window.prompt('Track name', this.draft.name);
    if (name === null) return;
    this.snapshot();
    this.draft.name = cleanTrackName(name);
    this.changed();
  }

  /** Change a draft value with undo (a button press). */
  private set(fn: () => void): void {
    this.snapshot();
    fn();
    this.changed();
    this.host.sound('change');
  }

  // ------------------------------------------------------------ drawing

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * dpr) || Math.round(innerWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr) || Math.round(innerHeight * dpr);
    if (w !== this.W || h !== this.H) {
      this.canvas.width = this.W = w;
      this.canvas.height = this.H = h;
    }
    // Fingers need bigger buttons (about 26 CSS pixels tall) than a mouse.
    const touch = matchMedia('(pointer: coarse)').matches ? Math.ceil(2 * dpr) : 0;
    this.k = Math.max(2, Math.min(Math.max(4, touch), Math.max(Math.round(Math.min(w, h) / 330), Math.min(touch, Math.floor(Math.min(w, h) / 150)))));
  }

  frame(dt: number): void {
    if (!this.active) return;
    this.resize();
    if (this.checkDue > 0) {
      this.checkDue -= dt;
      if (this.checkDue <= 0) this.recheck();
    }
    this.noteTime = Math.max(0, this.noteTime - dt);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    this.buttons = [];
    // A drawing slip must never take the game down: check again and draw the next frame.
    try {
      this.validSel();
      this.drawMap(ctx);
      this.drawUi(ctx);
    } catch (e) {
      console.warn('editor: drawing failed', e);
      this.sel = null;
      this.recheck();
    }
  }

  /** Drop a selection that points past its list (after an undo or a delete). */
  private validSel(): void {
    const s = this.sel;
    if (!s) return;
    const d = this.draft;
    const n = s.kind === 'point' ? d.path.length : s.kind === 'patch' ? d.patches.length : s.kind === 'ramp' ? d.ramps.length : d.landmarks.length;
    if (s.i < 0 || s.i >= n) this.sel = null;
  }

  private drawMap(ctx: CanvasRenderingContext2D): void {
    const { W, H, zoom } = this;
    const d = this.draft;
    const theme = themeOf(d.theme);
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, W, H);
    // A 50 m grid (10 m when close).
    const step = zoom > 2 ? 10 : 50;
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [x0, z0] = this.toWorld(0, 0);
    const [x1, z1] = this.toWorld(W, H);
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const [sx] = this.toScreen(x, 0);
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, H);
    }
    for (let z = Math.floor(z0 / step) * step; z <= z1; z += step) {
      const [, sy] = this.toScreen(0, z);
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(W, Math.round(sy) + 0.5);
    }
    ctx.stroke();

    const t = this.check?.track;
    if (t) {
      const ring = (off: (i: number) => number) => {
        for (const side of [1, -1]) {
          for (let i = 0; i <= t.n; i += 2) {
            const j = i % t.n;
            const [sx, sy] = this.toScreen(t.px[j] + t.nx[j] * off(j) * side, t.pz[j] + t.nz[j] * off(j) * side);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.closePath();
        }
      };
      // Pit lane under the road.
      if (t.pit) {
        const p = t.pit;
        const at = (u: number, lat: number) => this.toScreen(p.ox + p.tx * u + p.nx * lat * p.side, p.oz + p.tz * u + p.nz * lat * p.side);
        ctx.fillStyle = '#5a5c62';
        ctx.beginPath();
        const c = [at(p.a, p.barrier - 2), at(p.b, p.barrier - 2), at(p.b - p.ramp, p.pitOff + PIT.laneHalf), at(p.a + p.ramp, p.pitOff + PIT.laneHalf)];
        c.forEach(([sx, sy], k) => (k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
        ctx.closePath();
        ctx.fill();
        const [lx, ly] = at((p.a + p.b) / 2, p.pitOff);
        drawText(ctx, 'PIT', lx, ly - 3 * this.k, { scale: this.k, color: '#ffd84a', align: 'center' });
      }
      const ro = t.def.runoffSurface;
      ctx.fillStyle = theme.runoff ?? (ro !== undefined ? SURFACE_COLORS[ro] : '#5c9a48');
      ctx.beginPath();
      ring((j) => t.hw[j] + t.def.runoff);
      ctx.fill('evenodd');
      // Barriers.
      ctx.strokeStyle = '#d42a24';
      ctx.lineWidth = Math.max(1, zoom * 0.7);
      ctx.beginPath();
      ring((j) => t.hw[j] + t.def.runoff);
      ctx.stroke();
      ctx.fillStyle = '#3c3d44';
      ctx.beginPath();
      ring((j) => t.hw[j]);
      ctx.fill('evenodd');
      // Surface patches (over the road and run-off).
      for (const p of d.patches) {
        ctx.fillStyle = SURFACE_COLORS[p.surface] ?? '#888';
        ctx.globalAlpha = 0.85;
        const [sx, sy] = this.toScreen(p.x, p.z);
        ctx.beginPath();
        if (p.hx !== undefined) ctx.rect(sx - p.hx * zoom, sy - (p.hz ?? p.hx) * zoom, 2 * p.hx * zoom, 2 * (p.hz ?? p.hx) * zoom);
        else ctx.arc(sx, sy, p.r * zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // Centre line, ramps, catch-up pads, the grid and the start line.
      ctx.strokeStyle = 'rgba(230,230,224,0.7)';
      ctx.setLineDash([4 * this.k, 4 * this.k]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= t.n; i += 3) {
        const j = i % t.n;
        const [sx, sy] = this.toScreen(t.px[j], t.pz[j]);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      for (const s of t.boosts) {
        // Two chevrons pointing the way the cars go.
        const i = sampleIndexAt(t, s + 2);
        const j = (i + 1) % t.n;
        const len = Math.hypot(t.px[j] - t.px[i], t.pz[j] - t.pz[i]) || 1;
        const ux = (t.px[j] - t.px[i]) / len, uz = (t.pz[j] - t.pz[i]) / len;
        const size = Math.max(2.5, Math.min(7, t.hw[i] * 0.45)) * zoom;
        ctx.strokeStyle = '#33d6ff';
        ctx.lineWidth = Math.max(2, size * 0.35);
        ctx.beginPath();
        for (const off of [-0.5, 0.5]) {
          const [sx, sy] = this.toScreen(t.px[i] + ux * off * size * 1.4 / zoom, t.pz[i] + uz * off * size * 1.4 / zoom);
          ctx.moveTo(sx - ux * size - uz * size, sy - uz * size + ux * size);
          ctx.lineTo(sx, sy);
          ctx.lineTo(sx - ux * size + uz * size, sy - uz * size - ux * size);
        }
        ctx.stroke();
      }
      for (const r of t.ramps) {
        const i0 = sampleIndexAt(t, r.s0);
        const i1 = sampleIndexAt(t, r.s1);
        ctx.strokeStyle = '#f2c230';
        ctx.lineWidth = Math.max(3, t.hw[i1] * zoom * 0.5);
        ctx.beginPath();
        ctx.moveTo(...this.toScreen(t.px[i0], t.pz[i0]));
        ctx.lineTo(...this.toScreen(t.px[i1], t.pz[i1]));
        ctx.stroke();
      }
      ctx.fillStyle = '#e6e6e0';
      for (const g of t.grid) {
        const [sx, sy] = this.toScreen(g.x, g.z);
        ctx.fillRect(sx - 2, sy - 2, 4, 4);
      }
      const a = this.toScreen(t.px[0] + t.nx[0] * t.hw[0], t.pz[0] + t.nz[0] * t.hw[0]);
      const b = this.toScreen(t.px[0] - t.nx[0] * t.hw[0], t.pz[0] - t.nz[0] * t.hw[0]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, zoom * 2);
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.stroke();
    }

    // Landmarks.
    d.landmarks.forEach((l, i) => {
      const [sx, sy] = this.toScreen(l.x, l.z);
      const s = this.sel?.kind === 'mark' && this.sel.i === i;
      ctx.fillStyle = s ? '#ffd84a' : '#9a45d8';
      ctx.fillRect(sx - 5 * this.k, sy - 5 * this.k, 10 * this.k, 10 * this.k);
      drawText(ctx, l.kind, sx, sy + 7 * this.k, { color: '#ffffff', align: 'center', scale: Math.max(1, this.k - 1) });
    });

    // The corners: control lines, handles, the selected one's arc and knob.
    const P = d.path;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    P.forEach((p, i) => {
      const [sx, sy] = this.toScreen(p.x, p.z);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.stroke();
    const bad = this.problemMarks();
    P.forEach((p, i) => {
      const [sx, sy] = this.toScreen(p.x, p.z);
      const s = this.sel?.kind === 'point' && this.sel.i === i;
      const r = (s ? 7 : 5) * this.k;
      ctx.fillStyle = bad.corners.has(i) ? '#ff4040' : s ? '#ffd84a' : '#ffffff';
      ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
      ctx.fillStyle = '#000';
      ctx.fillRect(sx - r / 2 + this.k, sy - r / 2 + this.k, r - 2 * this.k, r - 2 * this.k);
      if (this.tool === 'shape' || s) drawText(ctx, String(i + 1), sx + r, sy - r - 4 * this.k, { color: '#ffffff', scale: Math.max(1, this.k - 1) });
    });
    for (const [i, j] of bad.segments) {
      const a = this.toScreen(P[i].x, P[i].z);
      const b = this.toScreen(P[j].x, P[j].z);
      ctx.strokeStyle = '#ff4040';
      ctx.lineWidth = 2 * this.k;
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.stroke();
    }
    for (const [x, z] of bad.spots) {
      const [sx, sy] = this.toScreen(x, z);
      ctx.strokeStyle = '#ff4040';
      ctx.lineWidth = 2 * this.k;
      ctx.beginPath();
      ctx.arc(sx, sy, 10 * this.k, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.sel?.kind === 'point') {
      const [kx, kz] = this.knob(this.sel.i);
      const [sx, sy] = this.toScreen(kx, kz);
      ctx.fillStyle = '#33d6ff';
      ctx.beginPath();
      ctx.arc(sx, sy, 4 * this.k, 0, Math.PI * 2);
      ctx.fill();
    }
    // The start line handle.
    if (this.tool === 'shape') {
      const st = this.startLine();
      const [sx, sy] = this.toScreen(st.x, st.z);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - 4 * this.k, sy - 4 * this.k, 8 * this.k, 8 * this.k);
      drawText(ctx, 'START', sx, sy + 6 * this.k, { scale: Math.max(1, this.k - 1), color: '#ffffff', align: 'center' });
    }
    // Selected patch / ramp outline and the patch's size knob.
    if (this.sel?.kind === 'patch') {
      const p = d.patches[this.sel.i];
      if (p) {
        const [sx, sy] = this.toScreen(p.x + (p.hx ?? p.r), p.z);
        ctx.fillStyle = '#33d6ff';
        ctx.beginPath();
        ctx.arc(sx, sy, 4 * this.k, 0, Math.PI * 2);
        ctx.fill();
        const [cx, cy] = this.toScreen(p.x, p.z);
        ctx.strokeStyle = '#ffd84a';
        ctx.lineWidth = this.k;
        ctx.beginPath();
        ctx.arc(cx, cy, (p.hx ?? p.r) * zoom, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.tool === 'ramp' || this.sel?.kind === 'ramp') {
      d.ramps.forEach((r, i) => {
        const [sx, sy] = this.toScreen(r.x, r.z);
        const s = this.sel?.kind === 'ramp' && this.sel.i === i;
        ctx.fillStyle = s ? '#ffd84a' : '#ffffff';
        ctx.fillRect(sx - 4 * this.k, sy - 4 * this.k, 8 * this.k, 8 * this.k);
      });
    }
    if (this.tool === 'surface') {
      d.patches.forEach((p, i) => {
        const [sx, sy] = this.toScreen(p.x, p.z);
        const s = this.sel?.kind === 'patch' && this.sel.i === i;
        ctx.fillStyle = s ? '#ffd84a' : '#ffffff';
        ctx.fillRect(sx - 3 * this.k, sy - 3 * this.k, 6 * this.k, 6 * this.k);
      });
    }
  }

  /** Where the check's problems are, to mark them on the map. */
  private problemMarks(): { corners: Set<number>; segments: [number, number][]; spots: [number, number][] } {
    const out = { corners: new Set<number>(), segments: [] as [number, number][], spots: [] as [number, number][] };
    const c = this.check;
    if (!c) return out;
    const t = c.track;
    const n = this.draft.path.length;
    for (const e of c.errors) {
      let m = /corner (\d+)/.exec(e);
      if (m && Number(m[1]) < n) out.corners.add(Number(m[1]));
      m = /straight (\d+)->(\d+)/.exec(e);
      if (m && Number(m[1]) < n && Number(m[2]) < n) out.segments.push([Number(m[1]), Number(m[2])]);
      for (const s of e.matchAll(/s=(\d+)/g)) {
        const i = sampleIndexAt(t, Number(s[1]));
        out.spots.push([t.px[i], t.pz[i]]);
      }
      if (e.includes('start grid')) out.spots.push([t.px[0], t.pz[0]]);
    }
    return out;
  }

  /** Short words for the first problem. */
  private problemText(): { text: string; color: string } {
    const c = this.check;
    if (!c) return { text: 'CAN NOT BUILD THIS SHAPE - UNDO OR MOVE THE CORNERS', color: '#ff6b5e' };
    const e = c.errors[0];
    if (e) {
      let m = /corner (\d+): radius .* below ([\d.]+)/.exec(e);
      if (m) return { text: `CORNER ${Number(m[1]) + 1}: RADIUS TOO SMALL (AT LEAST ${Math.ceil(Number(m[2]))} M)`, color: '#ff6b5e' };
      m = /corner (\d+): turn/.exec(e);
      if (m) return { text: `CORNER ${Number(m[1]) + 1} TURNS TOO FAR - ADD A CORNER`, color: '#ff6b5e' };
      m = /straight (\d+)->(\d+)/.exec(e);
      if (m) return { text: `CORNERS ${Number(m[1]) + 1} AND ${Number(m[2]) + 1} DO NOT FIT - MOVE APART OR SMALLER RADII`, color: '#ff6b5e' };
      if (e.includes('apart')) return { text: 'THE ROAD COMES TOO CLOSE TO ITSELF', color: '#ff6b5e' };
      if (e.includes('crosses itself')) return { text: 'THE ROAD CROSSES ITSELF', color: '#ff6b5e' };
      if (e.includes('start grid')) return { text: 'THE START LINE MUST BE ON A STRAIGHT', color: '#ff6b5e' };
      if (e.includes('ramp')) return { text: 'A JUMP CROSSES THE START LINE', color: '#ff6b5e' };
      return { text: e.toUpperCase(), color: '#ff6b5e' };
    }
    const t = c.track;
    const facts = `${(t.length / 1000).toFixed(2)} KM   ${t.pit ? 'PIT OK' : 'NO PIT'}   ${t.boosts.length} ARROWS`;
    if (c.missing.length) {
      const why = c.missing[0].includes('pit') ? 'TO RACE ONLINE: LONGER START STRAIGHT FOR A PIT LANE (ABOUT 110 M)' : 'TO RACE ONLINE: MORE STRAIGHTS FOR CATCH-UP ARROWS';
      return { text: `${facts}  -  ${why}`, color: '#ffd84a' };
    }
    return { text: `${facts}   READY TO RACE`, color: '#9cff9c' };
  }

  private button(x: number, y: number, label: string, act: () => void, opts: { on?: boolean; off?: boolean; w?: number } = {}): number {
    const k = this.k;
    const w = opts.w ?? textWidth(label, k) + 8 * k;
    const h = 13 * k;
    const b: Button = { key: `${label}@${Math.round(x)},${Math.round(y)}`, x, y, w, h, act, on: opts.on, off: opts.off };
    this.buttons.push(b);
    const ctx = this.ctx;
    const down = this.pressed === b.key;
    ctx.fillStyle = opts.on ? '#3a3410' : down ? '#2a3046' : 'rgba(8,10,24,0.85)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = opts.on ? '#ffd84a' : '#4a5470';
    ctx.fillRect(x, y + h - k, w, k);
    drawText(ctx, label, x + w / 2, y + 3 * k, { scale: k, color: opts.off ? '#5a6478' : opts.on ? '#ffd84a' : '#ffffff', align: 'center' });
    return w;
  }

  /** A row in the side panel: a label and its −/+ (or ◀/▶) buttons. */
  private row(x: number, y: number, w: number, label: string, dec: () => void, inc: () => void, glyphs: [string, string] = ['-', '+']): number {
    const k = this.k;
    const bw = 13 * k;
    this.button(x, y, glyphs[0], dec, { w: bw });
    this.button(x + w - bw, y, glyphs[1], inc, { w: bw });
    this.ctx.fillStyle = 'rgba(8,10,24,0.85)';
    this.ctx.fillRect(x + bw, y, w - 2 * bw, 13 * k);
    drawText(this.ctx, label, x + w / 2, y + 3 * k, { scale: Math.max(1, k - 1) + (textWidth(label, k) < w - 2 * bw - 4 * k ? 1 : 0), color: '#ffffff', align: 'center' });
    return 15 * k;
  }

  private drawUi(ctx: CanvasRenderingContext2D): void {
    const { W, H, k } = this;
    const d = this.draft;
    const bh = 13 * k;
    const gap = 2 * k;
    // Top bar: back, the name, file actions.
    ctx.fillStyle = 'rgba(6,8,18,0.8)';
    ctx.fillRect(0, 0, W, bh + 2 * gap);
    let x = gap;
    x += this.button(x, gap, '← EXIT', () => this.exit()) + gap;
    const right: [string, () => void][] = [['PUBLISH', () => this.host.publish(this.def)], ['SHARE', () => this.host.share(this.def)], ['SAVE', () => this.save()]];
    let rx = W - gap;
    for (const [label, act] of right) {
      const w = textWidth(label, k) + 8 * k;
      rx -= w;
      this.button(rx, gap, label, act);
      rx -= gap;
    }
    const title = `${d.name}${this.dirty ? ' *' : ''}`;
    const titleScale = textWidth(title, k) < rx - x - 8 * k ? k : Math.max(1, k - 1);
    drawText(ctx, title, (x + rx) / 2, gap + 3 * k, { scale: titleScale, color: '#ffd84a', align: 'center' });

    // Tools down the left side.
    let y = bh + 4 * gap;
    const tw = Math.max(...Object.values(TOOL_NAMES).map((n) => textWidth(n, k))) + 8 * k;
    (Object.keys(TOOL_NAMES) as Tool[]).forEach((t, i) => {
      this.button(gap, y, `${i + 1} ${TOOL_NAMES[t]}`, () => this.setTool(t), { on: this.tool === t && !this.settingsOpen, w: tw + 12 * k });
      y += bh + gap;
    });
    y += gap;
    this.button(gap, y, 'SETTINGS', () => { this.settingsOpen = !this.settingsOpen; this.host.sound('move'); }, { on: this.settingsOpen, w: tw + 12 * k });

    // Bottom bar: undo, view, test.
    const by = H - bh - gap;
    ctx.fillStyle = 'rgba(6,8,18,0.8)';
    ctx.fillRect(0, by - gap, W, bh + 2 * gap);
    x = gap;
    x += this.button(x, by, 'UNDO', () => this.undo(), { off: !this.undoStack.length }) + gap;
    x += this.button(x, by, 'REDO', () => this.undo(true), { off: !this.redoStack.length }) + gap;
    x += this.button(x, by, '-', () => this.zoomAt(W / 2, H / 2, 0.8), { w: bh }) + gap;
    x += this.button(x, by, '+', () => this.zoomAt(W / 2, H / 2, 1.25), { w: bh }) + gap;
    x += this.button(x, by, 'FIT', () => this.fit()) + gap;
    x += this.button(x, by, this.snap ? 'SNAP 5M' : 'SNAP OFF', () => (this.snap = !this.snap), { on: this.snap }) + gap;
    rx = W - gap;
    for (const [label, act] of [['TEST DRIVE', () => this.drive()], [this.busy ? 'AI...' : 'AI TEST', () => this.aiTest()]] as [string, () => void][]) {
      const w = textWidth(label, k) + 8 * k;
      rx -= w;
      this.button(rx, by, label, act, { off: !!this.check?.errors.length });
      rx -= gap;
    }

    // Status line above the bottom bar.
    const st = this.noteTime > 0 ? { text: this.note, color: '#ffd84a' } : this.problemText();
    const sy = by - gap - 10 * k;
    const sScale = textWidth(st.text, k) < W - 4 * gap ? k : Math.max(1, k - 1);
    ctx.fillStyle = 'rgba(6,8,18,0.7)';
    ctx.fillRect(0, sy - 2 * k, W, 11 * k);
    drawText(ctx, st.text, W / 2, sy, { scale: sScale, color: st.color, align: 'center' });
    if (this.aiNote) drawText(ctx, this.aiNote, W / 2, sy - 11 * k, { scale: Math.max(1, k - 1), color: '#9fd8ff', align: 'center' });

    // Side panel: settings, or the selected thing, or the tool's hint.
    const pw = Math.min(150 * k, Math.round(W * 0.34));
    const px = W - pw - gap;
    let py = bh + 4 * gap;
    const cyc = <T>(xs: readonly T[], v: T, dir: number): T => xs[(xs.indexOf(v) + dir + xs.length) % xs.length];
    if (this.settingsOpen) {
      ctx.fillStyle = 'rgba(6,8,18,0.6)';
      ctx.fillRect(px - gap, py - gap, pw + 2 * gap, 11 * (15 * k) + 2 * gap);
      this.button(px, py, `NAME: ${d.name}`, () => this.rename(), { w: pw });
      py += 15 * k;
      py += this.row(px, py, pw, `THEME ${d.theme.toUpperCase()}`, () => this.set(() => { d.theme = cyc(TRACK_THEMES, d.theme as typeof TRACK_THEMES[number], -1); d.landmarks = []; }), () => this.set(() => { d.theme = cyc(TRACK_THEMES, d.theme as typeof TRACK_THEMES[number], 1); d.landmarks = []; }), ['<', '>']);
      py += this.row(px, py, pw, `ROAD WIDTH ${d.width} M`, () => this.set(() => (d.width = Math.max(LIMITS.width[0], d.width - 1))), () => this.set(() => (d.width = Math.min(LIMITS.width[1], d.width + 1))));
      py += this.row(px, py, pw, `WIDER BENDS +${d.cornerWiden} M`, () => this.set(() => (d.cornerWiden = Math.max(0, d.cornerWiden - 0.5))), () => this.set(() => (d.cornerWiden = Math.min(LIMITS.cornerWiden[1], d.cornerWiden + 0.5))));
      py += this.row(px, py, pw, `RUN-OFF ${d.runoff} M`, () => this.set(() => (d.runoff = Math.max(LIMITS.runoff[0], d.runoff - 0.5))), () => this.set(() => (d.runoff = Math.min(LIMITS.runoff[1], d.runoff + 0.5))));
      const roName = d.runoffSurface === undefined ? 'GRASS (THEME)' : SURFACE_NAMES[d.runoffSurface];
      py += this.row(px, py, pw, `RUN-OFF ${roName}`, () => this.set(() => (d.runoffSurface = cyc(RUNOFFS, d.runoffSurface, -1))), () => this.set(() => (d.runoffSurface = cyc(RUNOFFS, d.runoffSurface, 1))), ['<', '>']);
      py += this.row(px, py, pw, `LAPS ${d.laps}`, () => this.set(() => (d.laps = Math.max(1, d.laps - 1))), () => this.set(() => (d.laps = Math.min(9, d.laps + 1))));
      py += this.row(px, py, pw, `SHORT TRACK X${d.lapScale}`, () => this.set(() => (d.lapScale = Math.max(1, d.lapScale - 1))), () => this.set(() => (d.lapScale = Math.min(5, d.lapScale + 1))));
      this.button(px, py, 'NEW SCENERY (SHUFFLE)', () => this.set(() => (d.seed = Math.floor(Math.random() * 9999))), { w: pw });
      py += 15 * k;
      drawText(ctx, 'SHORT TRACK: EACH LAP CHOSEN IS RACED', px, py + 2 * k, { scale: Math.max(1, k - 1), color: '#8090a8' });
      drawText(ctx, 'THIS MANY TIMES (FOR TINY TRACKS)', px, py + 11 * k, { scale: Math.max(1, k - 1), color: '#8090a8' });
      return;
    }
    const s = this.sel;
    if (s?.kind === 'point' && d.path[s.i]) {
      const p = d.path[s.i];
      drawText(ctx, `CORNER ${s.i + 1}`, px + pw / 2, py, { scale: k, color: '#ffd84a', align: 'center' });
      py += 11 * k;
      py += this.row(px, py, pw, `RADIUS ${p.r} M`, () => this.set(() => (p.r = Math.max(LIMITS.radius[0], p.r - (p.r > 60 ? 10 : 2)))), () => this.set(() => (p.r = Math.min(LIMITS.radius[1], p.r + (p.r >= 60 ? 10 : 2)))));
      this.button(px, py, 'DELETE CORNER', () => this.deleteSel(), { w: pw, off: d.path.length <= 3 });
    } else if (s?.kind === 'patch' && d.patches[s.i]) {
      const p = d.patches[s.i];
      drawText(ctx, 'SURFACE PATCH', px + pw / 2, py, { scale: k, color: '#ffd84a', align: 'center' });
      py += 11 * k;
      py += this.row(px, py, pw, SURFACE_NAMES[p.surface] ?? '?', () => this.set(() => { p.surface = cyc(PATCH_SURFACES, p.surface, -1); this.surface = p.surface; }), () => this.set(() => { p.surface = cyc(PATCH_SURFACES, p.surface, 1); this.surface = p.surface; }), ['<', '>']);
      const size = p.hx ?? p.r;
      py += this.row(px, py, pw, `SIZE ${Math.round(size)} M`, () => this.set(() => (p.hx !== undefined ? (p.hx = Math.max(1, p.hx - 2)) : (p.r = Math.max(2, p.r - 2)))), () => this.set(() => (p.hx !== undefined ? (p.hx = Math.min(60, p.hx + 2)) : (p.r = Math.min(60, p.r + 2)))));
      py += this.row(px, py, pw, p.hx !== undefined ? 'SHAPE BOX' : 'SHAPE ROUND', () => this.set(() => { if (p.hx !== undefined) { p.r = p.hx; delete p.hx; delete p.hz; } else { p.hx = p.r; p.hz = p.r / 2; } }), () => this.set(() => { if (p.hx !== undefined) { p.r = p.hx; delete p.hx; delete p.hz; } else { p.hx = p.r; p.hz = p.r / 2; } }), ['<', '>']);
      this.button(px, py, p.runoff ? 'COVERS RUN-OFF: YES' : 'COVERS RUN-OFF: NO', () => this.set(() => (p.runoff = !p.runoff || undefined)), { w: pw, on: !!p.runoff });
      py += 15 * k;
      this.button(px, py, 'DELETE PATCH', () => this.deleteSel(), { w: pw });
    } else if (s?.kind === 'ramp' && d.ramps[s.i]) {
      const r = d.ramps[s.i];
      drawText(ctx, 'JUMP', px + pw / 2, py, { scale: k, color: '#ffd84a', align: 'center' });
      py += 11 * k;
      py += this.row(px, py, pw, `HEIGHT ${r.height.toFixed(1)} M`, () => this.set(() => (r.height = Math.max(0.5, Math.round((r.height - 0.1) * 10) / 10))), () => this.set(() => (r.height = Math.min(2.5, Math.round((r.height + 0.1) * 10) / 10))));
      py += this.row(px, py, pw, `LENGTH ${r.length} M`, () => this.set(() => (r.length = Math.max(6, r.length - 1))), () => this.set(() => (r.length = Math.min(16, r.length + 1))));
      this.button(px, py, 'DELETE JUMP', () => this.deleteSel(), { w: pw });
    } else if (s?.kind === 'mark' && d.landmarks[s.i]) {
      const l = d.landmarks[s.i];
      const kinds = THEME_LANDMARKS[d.theme] ?? [];
      drawText(ctx, 'LANDMARK', px + pw / 2, py, { scale: k, color: '#ffd84a', align: 'center' });
      py += 11 * k;
      py += this.row(px, py, pw, l.kind.toUpperCase(), () => this.set(() => (l.kind = cyc(kinds, l.kind, -1))), () => this.set(() => (l.kind = cyc(kinds, l.kind, 1))), ['<', '>']);
      this.button(px, py, 'DELETE LANDMARK', () => this.deleteSel(), { w: pw });
    } else if (this.tool === 'surface') {
      drawText(ctx, 'NEW PATCHES', px + pw / 2, py, { scale: k, color: '#ffd84a', align: 'center' });
      py += 11 * k;
      this.row(px, py, pw, SURFACE_NAMES[this.surface], () => (this.surface = cyc(PATCH_SURFACES, this.surface, -1)), () => (this.surface = cyc(PATCH_SURFACES, this.surface, 1)), ['<', '>']);
    } else if (this.tool === 'mark') {
      const kinds = THEME_LANDMARKS[d.theme];
      drawText(ctx, 'NEW LANDMARKS', px + pw / 2, py, { scale: k, color: '#ffd84a', align: 'center' });
      py += 11 * k;
      if (kinds) this.row(px, py, pw, kinds[this.markKind % kinds.length].toUpperCase(), () => (this.markKind = (this.markKind + kinds.length - 1) % kinds.length), () => (this.markKind = (this.markKind + 1) % kinds.length), ['<', '>']);
      else drawText(ctx, 'NONE IN THIS THEME', px + pw / 2, py, { scale: Math.max(1, k - 1), color: '#8090a8', align: 'center' });
    }
    // The tool's hint under the top bar.
    const hint = TOOL_HINT[this.tool];
    const hScale = textWidth(hint, k - 1) < W - 2 * (tw + 16 * k) ? Math.max(1, k - 1) : 1;
    drawText(ctx, hint, W / 2, bh + 4 * gap, { scale: hScale, color: '#c8d0dc', align: 'center' });
  }
}
