// Live handling tuning with lil-gui (loaded on demand), opened from the pause
// menu in free practice. Car values only drive practice sessions (races,
// online play and records always use the stock car); touch steering feel
// applies everywhere. Both persist in localStorage and can be copied as JSON
// to paste into tuning.ts / touch.ts.

import type { CarTuning } from '../../shared/config/tuning.ts';
import { DEFAULT_TUNING } from '../../shared/config/tuning.ts';
import { TOUCH_TUNING, TOUCH_TUNING_DEFAULTS } from '../input/touch.ts';
import type { PixelCamera } from '../render/pixelCamera.ts';

const STORAGE_KEY = 'megacars.tuning.v1';
const TOUCH_KEY = 'megacars.touchTuning.v1';

function loadInto(key: string, target: object, defaults: object): void {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(saved)) {
      if (k in defaults && typeof v === 'number' && Number.isFinite(v)) (target as Record<string, number>)[k] = v;
    }
  } catch {
    // Ignore unavailable or corrupt storage.
  }
}

/** Only the values that differ from the defaults are stored. */
function saveDiff(key: string, values: object, defaults: object): void {
  try {
    const diff: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      if ((defaults as Record<string, number>)[k] !== v) diff[k] = v as number;
    }
    if (Object.keys(diff).length) localStorage.setItem(key, JSON.stringify(diff));
    else localStorage.removeItem(key);
  } catch {
    // Storage may be blocked; tuning still works for this session.
  }
}

export function loadSavedTuning(t: CarTuning): void {
  loadInto(STORAGE_KEY, t, DEFAULT_TUNING);
  loadInto(TOUCH_KEY, TOUCH_TUNING, TOUCH_TUNING_DEFAULTS);
}

interface CameraSettings {
  cam: PixelCamera;
  lookAhead: { value: number };
}

export interface TuningPanel {
  show(): void;
  hide(): void;
  toggle(): void;
  readonly visible: boolean;
}

export async function openTuningPanel(t: CarTuning, camera: CameraSettings, notify: (text: string) => void): Promise<TuningPanel> {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'Handling (practice)' });
  const el = gui.domElement;
  el.style.zIndex = '10';
  // Leave room for the touch buttons and scroll inside on small screens.
  el.style.maxHeight = '55vh';
  el.style.overflowY = 'auto';
  const onChange = () => saveDiff(STORAGE_KEY, t, DEFAULT_TUNING);
  const add = (folder: InstanceType<typeof GUI>, key: keyof CarTuning, min: number, max: number, step: number, name: string) =>
    folder.add(t, key, min, max, step).name(name).onChange(onChange);
  // Typing into a number field takes the keyboard; give it back to the car.
  gui.onFinishChange(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

  const steer = gui.addFolder('Steering');
  add(steer, 'rMin', 3, 10, 0.1, 'min turn radius m');
  add(steer, 'omegaPeak', 1, 5, 0.05, 'max turn rate rad/s');
  add(steer, 'steerGrip', 0.5, 1.3, 0.01, 'full lock grip use');
  add(steer, 'steerLo', 0.5, 1.2, 0.01, 'slippery: lock mid speed');
  add(steer, 'steerHi', 0.9, 2, 0.01, 'slippery: lock top speed');
  add(steer, 'steerV0', 5, 30, 0.5, 'mid speed m/s');
  add(steer, 'steerV1', 15, 50, 0.5, 'top speed m/s');
  add(steer, 'steerRateIn', 1, 15, 0.5, 'keys: turn in /s');
  add(steer, 'steerRateOut', 1, 20, 0.5, 'keys: centre /s');
  add(steer, 'steerRateFlip', 1, 30, 0.5, 'keys: flip side /s');
  add(steer, 'kYawGrip', 2, 25, 0.5, 'yaw response grip');

  const touch = gui.addFolder('Touch steering (phone)');
  const onTouch = () => saveDiff(TOUCH_KEY, TOUCH_TUNING, TOUCH_TUNING_DEFAULTS);
  touch.add(TOUCH_TUNING, 'range', 20, 100, 1).name('thumb travel px').onChange(onTouch);
  touch.add(TOUCH_TUNING, 'deadZone', 0, 0.4, 0.01).name('dead zone').onChange(onTouch);
  touch.add(TOUCH_TUNING, 'curve', 1, 3, 0.05).name('curve (1 = linear)').onChange(onTouch);
  touch.add(TOUCH_TUNING, 'rateOut', 2, 40, 0.5).name('follow thumb /s').onChange(onTouch);
  touch.add(TOUCH_TUNING, 'rateBack', 2, 60, 0.5).name('back to centre /s').onChange(onTouch);

  const grip = gui.addFolder('Grip');
  add(grip, 'aGrip', 5, 25, 0.25, 'grip m/s²');
  add(grip, 'frictionCircle', 0, 1, 0.01, 'grip lost gas/brake');
  add(grip, 'overloadRatio', 0.8, 1.5, 0.01, 'overload ratio');
  add(grip, 'slideEnterTicks', 1, 20, 1, 'ticks to break loose');
  add(grip, 'slipEnterDeg', 2, 20, 0.5, 'slip to slide (slippery) °');
  add(grip, 'slipEnterDegPaved', 2, 30, 0.5, 'slip to slide (paved) °');

  const slide = gui.addFolder('Drift');
  add(slide, 'aSlide', 10, 60, 0.5, 'slide grip m/s²');
  add(slide, 'slideAngleBoost', 0, 2, 0.05, 'sideways boost');
  add(slide, 'driftKick', 0, 6, 0.1, 'drift kick rad/s');
  add(slide, 'driftTapTicks', 4, 40, 1, 'brake tap ticks');
  add(slide, 'liftTapTicks', 4, 40, 1, 'lift-off ticks');
  add(slide, 'driftArmTicks', 2, 30, 1, 'steer window ticks');
  add(slide, 'driftMinSpeed', 0, 30, 0.5, 'min speed m/s');
  add(slide, 'driftMinSteer', 0, 1, 0.01, 'min steer');
  add(slide, 'kAlign', 1, 8, 0.1, 'straighten rate');
  add(slide, 'cScrub', 0, 2, 0.01, 'speed scrub');
  add(slide, 'aSteerSlide', 10, 120, 1, 'steer in slide');
  add(slide, 'kPow', 0, 2, 0.05, 'gas yaw in slide');
  add(slide, 'assistKb', 0, 2, 0.05, 'assist keys');
  add(slide, 'assistPad', 0, 2, 0.05, 'assist pad/touch');
  add(slide, 'kYawSlide', 1, 20, 0.25, 'yaw response slide');
  add(slide, 'slipExitDeg', 0.5, 10, 0.5, 'slip to grip again °');
  add(slide, 'slipExitTicks', 1, 30, 1, 'ticks to grip again');
  add(slide, 'spinDeg', 45, 120, 1, 'spin out at °');

  const eng = gui.addFolder('Engine');
  add(eng, 'accel0', 4, 25, 0.1, 'acceleration m/s²');
  add(eng, 'vTop', 20, 60, 0.5, 'top speed m/s');
  add(eng, 'brakeDecel', 5, 30, 0.5, 'brakes m/s²');
  add(eng, 'reverseAccel', 2, 25, 0.5, 'reverse accel');
  add(eng, 'reverseMax', 4, 30, 0.5, 'reverse top m/s');
  add(eng, 'coastBase', 0, 5, 0.1, 'rolling resistance');
  add(eng, 'coastLinear', 0, 0.1, 0.005, 'drag per m/s');

  const col = gui.addFolder('Collisions');
  add(col, 'wallRestitution', 0, 1, 0.01, 'wall bounce');
  add(col, 'wallFriction', 0, 1, 0.01, 'wall friction');
  add(col, 'wallSpinDamping', 0.5, 6, 0.1, 'wall spin damping');
  add(col, 'carRestitution', 0, 1, 0.01, 'car bounce');
  add(col, 'carFriction', 0, 1, 0.01, 'car friction');
  add(col, 'gravity', 5, 40, 0.5, 'gravity (jumps)');

  const camF = gui.addFolder('Camera');
  camF.add(camera.cam, 'viewHeight', 30, 90, 0.5).name('view height m');
  camF.add(camera.lookAhead, 'value', 0, 0.8, 0.01).name('look-ahead s');

  gui.add({
    copy: () => {
      const json = JSON.stringify({ car: diffOf(t, DEFAULT_TUNING), touch: diffOf(TOUCH_TUNING, TOUCH_TUNING_DEFAULTS) }, null, 2);
      console.log(json);
      void navigator.clipboard?.writeText(json).then(() => notify('TUNING COPIED'), () => notify('COPY FAILED - SEE CONSOLE'));
    },
  }, 'copy').name('Copy changes (JSON)');
  gui.add({
    reset: () => {
      Object.assign(t, DEFAULT_TUNING);
      Object.assign(TOUCH_TUNING, TOUCH_TUNING_DEFAULTS);
      onChange();
      onTouch();
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      notify('TUNING RESET');
    },
  }, 'reset').name('Reset to defaults');
  gui.add({ close: () => gui.hide() }, 'close').name('Close');
  for (const f of [grip, slide, eng, col, camF]) f.close();
  return {
    show: () => gui.show(),
    hide: () => gui.hide(),
    toggle: () => (gui._hidden ? gui.show() : gui.hide()),
    get visible() {
      return !gui._hidden;
    },
  };
}

function diffOf(values: object, defaults: object): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) if ((defaults as Record<string, number>)[k] !== v) out[k] = v as number;
  return out;
}

/** True when the car values differ from the stock car. */
export function isTuned(t: CarTuning): boolean {
  return Object.keys(diffOf(t, DEFAULT_TUNING)).length > 0;
}
