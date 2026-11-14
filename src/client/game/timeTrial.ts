// Time trial: free practice alone with a stock car and no weapons, chasing a
// ghost. The ghost is your own best lap on the track and league, the world
// record (re-run from its verified race), or both. A ghost starts its lap
// whenever you start one, and the HUD shows how far ahead or behind you are
// at the same point on the track.

import * as THREE from 'three';
import { disposeTree } from '../render/disposeTree.ts';
import { DT } from '../../shared/config/constants.ts';
import { ghostPose, ghostReach, ghostTicksAt, type GhostLap, type LapTape } from '../../shared/game/ghost.ts';
import type { League } from '../../shared/game/leagues.ts';
import type { RecordEntry } from '../../shared/game/records.ts';
import type { World } from '../../shared/sim/world.ts';
import { CarView } from '../render/carMesh.ts';
import { drawText, textWidth } from '../ui/font.ts';
import { formatTime } from '../ui/screens/hud.ts';
import { loadMyGhost, loadWorldGhost } from './ghostStore.ts';
import { fetchBoards } from './records.ts';

export type GhostChoice = 'off' | 'mine' | 'world' | 'both';

export const GHOST_CHOICES: readonly GhostChoice[] = ['off', 'mine', 'world', 'both'];
export const GHOST_NAMES: Record<GhostChoice, string> = { off: 'OFF', mine: 'MY BEST', world: 'WORLD RECORD', both: 'MY BEST + WORLD RECORD' };

const KEY = 'megacars.timetrial.v1';

export function loadGhostChoice(): GhostChoice {
  try {
    const v = localStorage.getItem(KEY) as GhostChoice | null;
    return v && GHOST_CHOICES.includes(v) ? v : 'both';
  } catch {
    return 'both';
  }
}

export function saveGhostChoice(c: GhostChoice): void {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    // Not remembered.
  }
}

/** On a player track there is no world board: only your own ghost. */
export function ghostChoicesFor(local: boolean): readonly GhostChoice[] {
  return local ? ['off', 'mine'] : GHOST_CHOICES;
}

const MINE_COLOR = '#6fe0ff';
const WORLD_COLOR = '#ffd84a';
const AHEAD = '#5aff6a';
const BEHIND = '#ff6b5e';
const OPACITY = 0.45;

interface Ghost {
  lap: GhostLap;
  reach: Float32Array;
  view: CarView;
  mats: THREE.Material[];
  label: string;
  color: string;
}

export interface TimeTrialOptions {
  /** Board key of the track and league ("greenvalley@super"). */
  key: string;
  league: League;
  choice: GhostChoice;
  /** A player track: no world board. */
  local: boolean;
  /** Race this board entry instead of the world record... */
  entry?: RecordEntry | null;
  /** ...which is this place on the board. */
  rank?: number;
  /** Where your ghost and the entry's are kept, if not under `key` (the daily challenge's own). */
  mineKey?: string;
  worldKey?: string;
  /** The entry ghost's name on screen (instead of "#rank"). */
  entryLabel?: string;
  /** With no entry given: say this instead of racing the world record. */
  noEntry?: string;
}

export class TimeTrial {
  private readonly scene: THREE.Scene;
  private readonly group = new THREE.Group();
  private readonly opts: TimeTrialOptions;
  private mine: Ghost | null = null;
  private world: Ghost | null = null;
  private mineStatus = '';
  private worldStatus = '';
  private disposed = false;
  /** Shown gap (ticks; NaN = none), refreshed ten times a second. */
  private gap = NaN;
  private gapAge = 0;
  /** After a lap: its difference to the ghost, for a few seconds. */
  private readout: { text: string; color: string; time: number } | null = null;
  private readonly pose = { x: 0, y: 0, z: 0, heading: 0 };

  constructor(scene: THREE.Scene, opts: TimeTrialOptions) {
    this.scene = scene;
    this.opts = opts;
    scene.add(this.group);
    const c = opts.choice;
    if (c === 'mine' || c === 'both') {
      this.mineStatus = 'LOADING YOUR GHOST...';
      void loadMyGhost(opts.mineKey ?? opts.key).then((g) => {
        if (this.disposed || this.mine) return;
        if (g) this.setMine(g);
        else this.mineStatus = 'NO GHOST OF YOURS YET - SET A LAP';
      });
    }
    if ((c === 'world' || c === 'both') && !opts.local) {
      this.worldStatus = opts.entry ? 'LOADING THE GHOST...' : 'LOADING THE WORLD RECORD...';
      void this.loadWorld();
    }
  }

  private async loadWorld(): Promise<void> {
    let entry = this.opts.entry ?? null;
    if (!entry && this.opts.noEntry) {
      this.worldStatus = this.opts.noEntry;
      return;
    }
    if (!entry) {
      const boards = await fetchBoards();
      if (this.disposed) return;
      if (!boards) {
        this.worldStatus = 'WORLD RECORD: CANNOT REACH THE SERVER';
        return;
      }
      entry = boards[this.opts.key]?.[0] ?? null;
      if (!entry) {
        this.worldStatus = 'NO WORLD RECORD YET - SET ONE!';
        return;
      }
    }
    const g = await loadWorldGhost(entry, this.opts.worldKey ?? this.opts.key);
    if (this.disposed) return;
    if (typeof g === 'string') {
      // The daily challenge's leader, or the world record.
      const what = this.opts.entryLabel ? 'LEADER' : 'WORLD RECORD';
      this.worldStatus = g === 'offline' ? `${what}: CANNOT REACH THE SERVER` : `${what} GHOST NOT AVAILABLE`;
      return;
    }
    const rank = this.opts.entry ? (this.opts.rank ?? 1) : 1;
    const what = rank > 1 ? `#${rank}` : 'WORLD RECORD';
    this.world = this.makeGhost(g, this.opts.entryLabel ?? `${what} ${entry.name}`, WORLD_COLOR);
    this.worldStatus = '';
  }

  /** Your ghost, now this lap (a new best replaces it at once). */
  setMine(g: GhostLap): void {
    if (this.mine) {
      this.mine.lap = g;
      this.mine.reach = ghostReach(g);
    } else this.mine = this.makeGhost(g, 'MY BEST', MINE_COLOR);
    this.mineStatus = '';
  }

  private get wantsMine(): boolean {
    return this.opts.choice === 'mine' || this.opts.choice === 'both';
  }

  private makeGhost(lap: GhostLap, label: string, color: string): Ghost {
    const view = new CarView(color, 0, undefined, this.opts.league);
    const mats: THREE.Material[] = [];
    view.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = false;
      const mat = (m.material as THREE.Material).clone();
      mat.transparent = true;
      mat.depthWrite = false;
      mat.opacity = OPACITY;
      m.material = mat;
      m.renderOrder = 4;
      mats.push(mat);
    });
    view.root.visible = false;
    this.group.add(view.root);
    return { lap, reach: ghostReach(lap), view, mats, label, color };
  }

  /** The ghost to beat: the faster one. */
  private get target(): Ghost | null {
    const a = this.mine;
    const b = this.world;
    if (a && b) return b.lap.ticks <= a.lap.ticks ? b : a;
    return a ?? b;
  }

  /** A lap was completed: the readout, and a new best becomes your ghost. */
  lapDone(ticks: number, lap: GhostLap | null, newBest: boolean): void {
    const t = this.target;
    if (t) {
      const d = (ticks - t.lap.ticks) * DT;
      this.readout = { text: `${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(2)} VS ${t.label}`, color: d < 0 ? AHEAD : d > 0 ? BEHIND : '#ffffff', time: 3.5 };
    }
    if (newBest && lap && lap.ticks === ticks && this.wantsMine) this.setMine(lap);
  }

  /** Place the ghosts for this frame (`alpha` as for the cars). */
  update(world: World, carId: number, tape: LapTape | null, alpha: number, dt: number): void {
    const car = world.cars[carId];
    // The car on screen is drawn between the last two ticks.
    const t = car.lap >= 1 ? world.tick - car.lapStartTick - 1 + alpha : 0;
    for (const g of [this.mine, this.world]) {
      if (!g) continue;
      const p = this.pose;
      const on = ghostPose(g.lap, Math.max(0, t), p);
      g.view.root.visible = on;
      if (!on) continue;
      const i = Math.min(g.lap.ticks - 1, Math.floor(Math.max(0, t)));
      const d = g.lap.data;
      const speed = Math.hypot(d[(i + 1) * 5] - d[i * 5], d[(i + 1) * 5 + 2] - d[i * 5 + 2]) / DT;
      g.view.update(p.x, p.y, p.z, p.heading, 0, 0, 0, false, speed, dt);
      // Fade out when it sits on top of your car.
      const near = Math.hypot(p.x - car.x, p.z - car.z);
      const k = OPACITY * Math.min(1, 0.4 + near / 10);
      for (const m of g.mats) m.opacity = k;
    }
    this.gapAge -= dt;
    if (this.readout) {
      this.readout.time -= dt;
      if (this.readout.time <= 0) this.readout = null;
    }
    if (this.gapAge > 0) return;
    this.gapAge = 0.1;
    const target = this.target;
    if (!target || car.lap < 1 || !tape) {
      this.gap = NaN;
      return;
    }
    const at = ghostTicksAt(target.reach, car.raceDist - tape.startDist);
    // Past the ghost's finish line (a short cut or the last metres): keep the last gap.
    if (at >= 0) this.gap = world.tick - car.lapStartTick - at;
  }

  /** The live gap and the lap readout (top centre of the screen). */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const cx = Math.round(W / 2);
    const t = this.target;
    if (t && Number.isFinite(this.gap)) {
      const s = this.gap * DT;
      const text = `${s < 0 ? '-' : '+'}${Math.abs(s).toFixed(2)}`;
      drawText(ctx, text, cx, 6, { scale: 3, color: s < -0.005 ? AHEAD : s > 0.005 ? BEHIND : '#ffffff', align: 'center' });
      drawText(ctx, `VS ${t.label} ${formatTime(t.lap.ticks * DT)}`, cx, 30, { color: t.color, align: 'center' });
    } else if (t) {
      drawText(ctx, `GHOST: ${t.label} ${formatTime(t.lap.ticks * DT)}`, cx, 8, { color: t.color, align: 'center' });
      drawText(ctx, 'CROSS THE LINE TO START', cx, 19, { color: '#c8d0dc', align: 'center' });
    }
    // What isn't there (yet), under the gap.
    // Narrow screens: no room between the lap box and the minimap, so at the bottom, short.
    const narrow = W < 500;
    let y = narrow ? H - 36 : t ? 41 : 8;
    for (const msg of [this.mine ? '' : this.mineStatus, this.world ? '' : this.worldStatus]) {
      if (!msg) continue;
      drawText(ctx, textWidth(msg) <= W - 300 ? msg : msg.split(' - ')[0], cx, y, { color: '#8090a8', align: 'center' });
      y += 10;
    }
    if (this.opts.choice === 'off' && !t) drawText(ctx, 'TIME TRIAL - NO GHOST', cx, 8, { color: '#8090a8', align: 'center' });
    if (this.readout) drawText(ctx, this.readout.text, cx, Math.round(H * 0.18) + 20, { scale: 2, color: this.readout.color, align: 'center' });
  }

  /** For tests: which ghosts are in, what they show and the gap. */
  debugState(): { mine: number; world: number; gap: number | null; visible: boolean[]; status: string[]; readout: string | null } {
    return {
      mine: this.mine?.lap.ticks ?? 0,
      world: this.world?.lap.ticks ?? 0,
      gap: Number.isFinite(this.gap) ? +(this.gap * DT).toFixed(3) : null,
      visible: [this.mine?.view.root.visible ?? false, this.world?.view.root.visible ?? false],
      status: [this.mineStatus, this.worldStatus],
      readout: this.readout?.text ?? null,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.scene.remove(this.group);
    for (const g of [this.mine, this.world]) for (const m of g?.mats ?? []) m.dispose();
    disposeTree(this.group);
  }
}

export interface TimeTrialMenu {
  settings: { track: string; league: League };
  /** Tracks to choose from (the game's, then the player's own). */
  tracks: () => string[];
  trackName: (id: string) => string;
  leagues: readonly League[];
  leagueName: (l: League) => string;
  /** A player track (no world board). */
  local: (id: string) => boolean;
  /** Your best lap (ticks) on the chosen track and league, 0 = none. */
  best: () => number;
  /** Settings changed (save them, show the track). */
  changed: (trackChanged: boolean) => void;
  start: () => void;
}

/** Rows of the TIME TRIAL page: track, league, ghost, start. */
export function timeTrialItems(m: TimeTrialMenu): { label: () => string; change?: (d: number) => void; select?: () => void }[] {
  const s = m.settings;
  const step = <T>(list: readonly T[], v: T, d: number) => list[(((list.indexOf(v) + d) % list.length) + list.length) % list.length];
  const choices = () => ghostChoicesFor(m.local(s.track));
  const choice = () => ghostChoiceFor(m.local(s.track));
  return [
    {
      label: () => `TRACK: ${m.trackName(s.track).toUpperCase()}`,
      change: (d) => {
        const ids = m.tracks();
        s.track = ids[(((Math.max(0, ids.indexOf(s.track)) + d) % ids.length) + ids.length) % ids.length];
        m.changed(true);
      },
    },
    { label: () => `LEAGUE: ${m.leagueName(s.league)}`, change: (d) => { s.league = step(m.leagues, s.league, d); m.changed(false); } },
    { label: () => `GHOST: ${GHOST_NAMES[choice()]}`, change: (d) => saveGhostChoice(step(choices(), choice(), d)) },
    { label: () => (m.best() ? `START - YOUR BEST ${formatTime(m.best() * DT)}` : 'START'), select: () => m.start() },
  ];
}

/** The saved ghost choice, limited to what the track offers. */
export function ghostChoiceFor(local: boolean): GhostChoice {
  const c = loadGhostChoice();
  return ghostChoicesFor(local).includes(c) ? c : 'mine';
}
