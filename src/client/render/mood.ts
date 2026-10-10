// Lighting moods: sun/moon, sky light, colour grading and whether lamps and
// headlights are on.

import * as THREE from 'three';

export interface Mood {
  id: string;
  name: string;
  /** Direction from the ground toward the light. */
  sunDir: THREE.Vector3;
  sunColor: string;
  sunIntensity: number;
  skyColor: string;
  groundColor: string;
  hemiIntensity: number;
  background: string;
  tint: THREE.Color;
  lift: THREE.Color;
  exposure: number;
  bloom: number;
  bloomThreshold: number;
  /** Headlights, street lamps and lit windows. */
  lights: boolean;
  /** Brightness of unlit particles (smoke, dust). */
  particleLight: number;
  /** Strength of street-lamp light pools and headlight cones (0..1). */
  lampLight: number;
  headlight: number;
}

export const MOODS: Mood[] = [
  {
    id: 'day',
    name: 'DAY',
    sunDir: new THREE.Vector3(-70, 140, 60).normalize(),
    sunColor: '#fff0d4',
    sunIntensity: 2.4,
    skyColor: '#d2e6ff',
    groundColor: '#4d5a3a',
    hemiIntensity: 1.5,
    background: '#4c8a3a',
    tint: new THREE.Color(1, 1, 1),
    lift: new THREE.Color(0, 0, 0),
    exposure: 1,
    bloom: 0.75,
    bloomThreshold: 1.1,
    lights: false,
    particleLight: 1,
    lampLight: 0,
    headlight: 0,
  },
  {
    id: 'sunset',
    name: 'SUNSET',
    sunDir: new THREE.Vector3(-150, 55, -20).normalize(),
    sunColor: '#ffb070',
    sunIntensity: 2.6,
    skyColor: '#ffb48a',
    groundColor: '#3a3040',
    hemiIntensity: 1.0,
    background: '#5a5a30',
    tint: new THREE.Color(1.06, 0.93, 0.84),
    lift: new THREE.Color(0.012, 0.004, 0.012),
    exposure: 1.02,
    bloom: 0.8,
    bloomThreshold: 1.0,
    lights: true,
    particleLight: 0.8,
    lampLight: 0.22,
    headlight: 0.35,
  },
  {
    id: 'night',
    name: 'NIGHT',
    sunDir: new THREE.Vector3(50, 130, 70).normalize(),
    sunColor: '#9fb4ff',
    sunIntensity: 0.45,
    skyColor: '#2a3a66',
    groundColor: '#0b0f18',
    hemiIntensity: 0.9,
    background: '#0c1420',
    tint: new THREE.Color(0.82, 0.9, 1.12),
    lift: new THREE.Color(0.003, 0.004, 0.012),
    exposure: 1.1,
    bloom: 1.2,
    bloomThreshold: 0.85,
    lights: true,
    particleLight: 0.3,
    lampLight: 0.75,
    headlight: 0.85,
  },
];

export function moodById(id: string | null | undefined): Mood {
  return MOODS.find((m) => m.id === id) ?? MOODS[0];
}
