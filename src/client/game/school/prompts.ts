// What the school says. The wording uses the player's own controls: the keys
// or pad buttons as they are bound now, or the on-screen buttons on a phone.
// Pure functions of a lesson, its phase and the labels, so they can be tested.

import { buttonName, keysLabel, type Controls } from '../../input/bindings.ts';
import { DRIFT_HOLD_S, LAP_BOOSTS, LAP_TARGET_S } from './lessons.ts';

export type Device = 'keys' | 'pad' | 'touch';

export interface TouchSetup {
  gasMode: 'thumb' | 'always' | 'button';
  steerMode: 'point' | 'slide' | 'buttons';
}

/** The controls as the player has them, as phrases that fit after HOLD / TAP / WITH. */
export interface Labels {
  device: Device;
  gas: string;
  brake: string;
  drift: string;
  /** Whole sentences about steering and the gas (they differ most between devices). */
  turnRight: string;
  turnLeft: string;
  accelerate: string;
  /** Touch: the buttons to light up ('drift', 'brake', 'gas'). */
  touch: boolean;
}

export function makeLabels(device: Device, c: Controls, t: TouchSetup = { gasMode: 'thumb', steerMode: 'point' }): Labels {
  if (device === 'touch') {
    const how = { point: 'PUSH YOUR LEFT THUMB TO THE', slide: 'DRAG YOUR LEFT THUMB', buttons: 'TAP THE ARROW' }[t.steerMode];
    const turn = (side: 'RIGHT' | 'LEFT') => `${how} ${side}`;
    const gas = { thumb: 'KEEP YOUR LEFT THUMB DOWN TO ACCELERATE', always: 'THE CAR ACCELERATES BY ITSELF', button: 'HOLD THE GAS BUTTON TO ACCELERATE' }[t.gasMode];
    return { device, gas: 'THE GAS BUTTON', brake: 'THE BRAKE BUTTON', drift: 'THE DRIFT BUTTON', turnRight: turn('RIGHT'), turnLeft: turn('LEFT'), accelerate: gas, touch: true };
  }
  if (device === 'pad') {
    const b = (a: keyof Controls['pad']) => c.pad[a].map(buttonName).join('/') || '-';
    return { device, gas: b('gas'), brake: b('brake'), drift: b('drift'), turnRight: 'PUSH THE STICK RIGHT', turnLeft: 'PUSH THE STICK LEFT', accelerate: `HOLD ${b('gas')} TO ACCELERATE`, touch: false };
  }
  const k = c.solo;
  return {
    device,
    gas: keysLabel(k, 'gas'),
    brake: keysLabel(k, 'brake'),
    drift: keysLabel(k, 'drift'),
    turnRight: `PRESS ${keysLabel(k, 'right')} TO TURN RIGHT`,
    turnLeft: `PRESS ${keysLabel(k, 'left')} TO TURN LEFT`,
    accelerate: `HOLD ${keysLabel(k, 'gas')} TO ACCELERATE`,
    touch: false,
  };
}

const secs = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));

/** The main instruction for a lesson phase: one or two lines (the second is smaller). */
export function promptFor(lesson: string, phase: string, L: Labels, stage = 0): string[] {
  switch (lesson) {
    case 'basics':
      switch (phase) {
        case 'gas': return [L.accelerate, 'THEN GET READY TO BRAKE FOR THE CORNER'];
        case 'brake': return stage === 1 ? [`BRAKE WITH ${L.brake} FOR THE HAIRPIN`, 'THEN TURN RIGHT'] : [`EASE OFF AND BRAKE WITH ${L.brake}`, 'TOO FAST AND YOU HIT THE WALL'];
        case 'corner': return [L.turnRight, 'KEEP IT ON THE ROAD'];
        case 'hairpin': return [L.turnRight, 'BACK ON THE GAS AS YOU COME OUT'];
        case 'left': return [L.turnLeft, 'BRAKE FIRST IF YOU ARE FAST'];
        default: return ['KEEP GOING', 'KEEP OFF THE WALLS'];
      }
    case 'drift':
      switch (phase) {
        case 'holding': return [`KEEP HOLDING ${L.drift}`, 'AND KEEP STEERING INTO THE CORNER'];
        case 'late': return ['LET GO AND STRAIGHTEN UP', ''];
        case 'done': return ['NICE - NOW LET GO', ''];
        default: return [`TURN IN AND HOLD ${L.drift} AT THE SAME TIME`, `HOLD IT FOR ${secs(DRIFT_HOLD_S)} SECOND`];
      }
    case 'lift':
      switch (phase) {
        case 'holding': return ['KEEP STEERING AND STAY ON THE GAS', 'THE CAR SLIDES ON ITS OWN'];
        case 'late': return ['STRAIGHTEN UP', ''];
        case 'done': return ['NICE - NOW STRAIGHTEN UP', ''];
        default:
          return L.touch
            ? [`TAP ${L.brake} AS YOU TURN IN`, 'A QUICK TAP, THEN KEEP STEERING']
            : ['LIFT OFF THE GAS AND BACK ON AS YOU TURN IN', `OR TAP ${L.brake} QUICKLY WHILE YOU STEER`];
      }
    case 'boost': {
      const want = stage === 0 ? 2 : 3;
      switch (phase) {
        case 'release': return [`LEVEL ${want}! LET GO AND STRAIGHTEN UP`, 'THE BOOST COMES WHEN THE CAR GRIPS AGAIN'];
        case 'charge': return [`KEEP HOLDING ${L.drift}`, `THE METER MUST REACH LEVEL ${want}`];
        default:
          return stage === 0
            ? [`HOLD ${L.drift} THROUGH THE CORNER`, 'WATCH THE METER: WAIT FOR LEVEL 2, THEN LET GO']
            : [`HOLD ${L.drift} ALL THE WAY ROUND THE SWEEPER`, 'LEVEL 3 TAKES ABOUT TWO SECONDS - THEN LET GO'];
      }
    }
    case 'lap':
      return [`DRIFT THE CORNERS AND LET GO FOR A BOOST (${LAP_BOOSTS}+)`, `A LAP UNDER ${Math.floor(LAP_TARGET_S / 60)}:${String(LAP_TARGET_S % 60).padStart(2, '0')}`];
    default:
      return [''];
  }
}

/** Which on-screen buttons to light up for a prompt (touch only). */
export function highlightFor(lesson: string, phase: string): string[] {
  switch (lesson) {
    case 'basics': return phase === 'brake' ? ['brake'] : [];
    case 'drift': return phase === 'late' || phase === 'done' ? [] : ['drift'];
    case 'lift': return phase === 'late' || phase === 'done' ? [] : ['brake'];
    case 'boost': return phase === 'release' || phase === 'late' ? [] : ['drift'];
    case 'lap': return ['drift'];
    default: return [];
  }
}

/** After a few failures in a row: what to try, by failure code. */
export function hintFor(lesson: string, code: string, L: Labels): string {
  const fallback: Record<string, string> = {
    basics: 'BRAKE EARLY, THEN STEER SMOOTHLY - SLOW IS FAST',
    drift: `PRESS ${L.drift} THE MOMENT YOU STEER INTO THE CORNER`,
    lift: L.touch ? `TAP ${L.brake} ONCE WHILE YOU STEER` : 'LIFT OFF FOR A MOMENT, THEN BACK ON WHILE STEERING',
    boost: `HOLD ${L.drift} UNTIL THE METER FILLS, THEN LET GO`,
    lap: 'BOOSTS ARE FREE SPEED: DRIFT EVERY CORNER AND LET GO ON THE EXIT',
  };
  const byCode: Record<string, string> = {
    wall: lesson === 'basics' ? 'BRAKE EARLIER AND STEER A LITTLE LESS' : 'STEER LESS AND LET THE CAR SLIDE WIDE - EASE OFF IF IT IS FAST',
    slow: 'KEEP THE GAS DOWN ON THE WAY TO THE CORNER',
    idle: L.accelerate,
    nobutton: `HOLD ${L.drift} AS YOU TURN IN`,
    nosteer: `STEER AT THE SAME MOMENT YOU PRESS ${L.drift}`,
    early: lesson === 'boost' ? 'WAIT UNTIL THE METER SAYS THE LEVEL BEFORE YOU LET GO' : 'KEEP HOLDING UNTIL THE CAR IS ROUND THE CORNER',
    died: 'STEER HARDER AND STAY ON THE GAS TO KEEP THE SLIDE GOING',
    usedButton: L.touch ? `USE ${L.brake} THIS TIME, NOT THE DRIFT BUTTON` : `NO ${L.drift} THIS TIME: LIFT OFF OR TAP ${L.brake}`,
    nodrift: L.touch ? `TAP ${L.brake} WHILE STEERING` : `LIFT OFF AND BACK ON, OR TAP ${L.brake}, WHILE STEERING HARD`,
    spin: 'LESS STEERING - OVERSTEERING SPINS THE CAR',
    boosts: 'LET GO OF THE DRIFT ON EVERY CORNER EXIT',
    time: 'USE THE BOOSTS AND BRAKE LATER',
    both: 'DRIFT EVERY CORNER, LET GO ON THE EXIT FOR BOOSTS',
  };
  return byCode[code] ?? fallback[lesson] ?? '';
}
