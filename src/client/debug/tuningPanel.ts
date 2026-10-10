// Live handling tuning with lil-gui (loaded on demand). Values persist in
// localStorage and can be copied as JSON to paste into tuning.ts.

import type { CarTuning } from '../../shared/config/tuning.ts';
import { DEFAULT_TUNING } from '../../shared/config/tuning.ts';
import type { PixelCamera } from '../render/pixelCamera.ts';

const STORAGE_KEY = 'megacars.tuning.v1';

export function loadSavedTuning(t: CarTuning): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<CarTuning>;
    for (const [k, v] of Object.entries(saved)) {
      if (k in DEFAULT_TUNING && typeof v === 'number') (t as unknown as Record<string, number>)[k] = v;
    }
  } catch {
    // Ignore unavailable or corrupt storage.
  }
}

function save(t: CarTuning): void {
  try {
    const diff: Record<string, number> = {};
    for (const [k, v] of Object.entries(t)) {
      if ((DEFAULT_TUNING as unknown as Record<string, number>)[k] !== v) diff[k] = v as number;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
  } catch {
    // Storage may be blocked; tuning still works for this session.
  }
}

interface CameraSettings {
  cam: PixelCamera;
  lookAhead: { value: number };
}

export async function openTuningPanel(t: CarTuning, camera: CameraSettings): Promise<{ toggle(): void }> {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'Megacars tuning' });
  gui.domElement.style.zIndex = '10';
  const onChange = () => save(t);
  const add = (folder: InstanceType<typeof GUI>, key: keyof CarTuning, min: number, max: number, step: number) =>
    folder.add(t, key, min, max, step).onChange(onChange);

  const eng = gui.addFolder('Engine');
  add(eng, 'accel0', 4, 25, 0.1);
  add(eng, 'vTop', 20, 60, 0.5);
  add(eng, 'brakeDecel', 5, 30, 0.5);
  add(eng, 'coastBase', 0, 5, 0.1);

  const steer = gui.addFolder('Steering');
  add(steer, 'rMin', 3, 10, 0.1);
  add(steer, 'omegaPeak', 1, 5, 0.05);
  add(steer, 'steerLo', 0.5, 1.2, 0.01);
  add(steer, 'steerHi', 0.9, 2, 0.01);
  add(steer, 'steerV0', 5, 30, 0.5);
  add(steer, 'steerV1', 15, 50, 0.5);
  add(steer, 'steerRateIn', 1, 15, 0.5);
  add(steer, 'steerRateOut', 1, 20, 0.5);

  const grip = gui.addFolder('Grip');
  add(grip, 'aGrip', 5, 25, 0.25);
  add(grip, 'frictionCircle', 0, 1, 0.01);
  add(grip, 'overloadRatio', 0.8, 1.5, 0.01);
  add(grip, 'slideEnterTicks', 1, 20, 1);

  const slide = gui.addFolder('Slide');
  add(slide, 'aSlide', 10, 60, 0.5);
  add(slide, 'slideAngleBoost', 0, 2, 0.05);
  add(slide, 'driftKick', 0, 6, 0.1);
  add(slide, 'liftTapTicks', 4, 40, 1);
  add(slide, 'driftTapTicks', 4, 40, 1);
  add(slide, 'kAlign', 1, 8, 0.1);
  add(slide, 'cScrub', 0, 2, 0.01);
  add(slide, 'aSteerSlide', 10, 120, 1);
  add(slide, 'kPow', 0, 2, 0.05);
  add(slide, 'assistKb', 0, 2, 0.05);
  add(slide, 'kYawGrip', 2, 25, 0.5);
  add(slide, 'kYawSlide', 1, 20, 0.25);
  add(slide, 'slipExitDeg', 0.5, 10, 0.5);
  add(slide, 'spinDeg', 45, 120, 1);

  const col = gui.addFolder('Collisions');
  add(col, 'wallRestitution', 0, 1, 0.01);
  add(col, 'wallFriction', 0, 1, 0.01);
  add(col, 'carRestitution', 0, 1, 0.01);

  const camF = gui.addFolder('Camera');
  camF.add(camera.cam, 'metersPerPixel', 0.1, 0.35, 0.005).name('metres / pixel');
  camF.add({ get tiltDeg() { return (camera.cam.tilt * 180) / Math.PI; }, set tiltDeg(v: number) { camera.cam.tilt = (v * Math.PI) / 180; } }, 'tiltDeg', 35, 90, 1).name('tilt °');
  camF.add(camera.lookAhead, 'value', 0, 0.8, 0.01).name('look-ahead s');

  gui.add({
    copy: () => {
      const json = JSON.stringify(t, null, 2);
      void navigator.clipboard?.writeText(json);
      console.log(json);
    },
  }, 'copy').name('Copy tuning JSON');
  gui.add({
    reset: () => {
      Object.assign(t, DEFAULT_TUNING);
      save(t);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
  }, 'reset').name('Reset to defaults');
  for (const f of [steer, col]) f.close();
  return { toggle: () => (gui._hidden ? gui.show() : gui.hide()) };
}
