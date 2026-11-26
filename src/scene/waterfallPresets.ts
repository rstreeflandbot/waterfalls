import { Vec3Tuple, normalizeVec3 } from './cliffMath';

export type WaterfallPresetId = 'iceland' | 'forest';

export interface SkyPalette {
  readonly zenith: readonly [number, number, number];
  readonly midSky: readonly [number, number, number];
  readonly horizonCool: readonly [number, number, number];
  readonly horizonWarm: readonly [number, number, number];
  readonly cloudShadow: readonly [number, number, number];
  readonly cloudMid: readonly [number, number, number];
  readonly cloudSunRim: readonly [number, number, number];
  readonly lowerMistCool: readonly [number, number, number];
  readonly lowerMistWarm: readonly [number, number, number];
}

export interface WaterBiomeStyle {
  readonly plungeCenterZ: number;
  readonly absorption: readonly [number, number, number];
  readonly deepScatter: readonly [number, number, number];
  readonly aeratedGlow: readonly [number, number, number];
}

export interface WaterfallPresetConfig {
  readonly id: WaterfallPresetId;
  readonly title: string;
  readonly eyebrow: string;
  readonly buttonLabel: string;
  readonly sunDirection: Vec3Tuple;
  readonly sunColorHex: number;
  readonly sunIntensity: number;
  readonly hemiSkyHex: number;
  readonly hemiGroundHex: number;
  readonly hemiIntensity: number;
  readonly bounceHex: number;
  readonly bounceIntensity: number;
  readonly fogColorHex: number;
  readonly fogLinearCool: readonly [number, number, number];
  readonly fogLinearWarm: readonly [number, number, number];
  readonly godRayStrength: number;
  readonly godRayTint: readonly [number, number, number];
  readonly skyPalette: SkyPalette;
  readonly waterStyle: WaterBiomeStyle;
  readonly heroCameraPosition: Vec3Tuple;
  readonly heroCameraTarget: Vec3Tuple;
}

export const WATERFALL_PRESETS: Record<WaterfallPresetId, WaterfallPresetConfig> = {
  iceland: {
    id: 'iceland',
    title: 'Skógafoss',
    eyebrow: 'ICELAND · VOLCANIC HIGHLANDS',
    buttonLabel: 'Iceland',
    sunDirection: normalizeVec3({ x: -0.72, y: 0.24, z: -0.65 }),
    sunColorHex: 0xffbc80,
    sunIntensity: 3.35,
    hemiSkyHex: 0x8db2db,
    hemiGroundHex: 0x1b222a,
    hemiIntensity: 1.25,
    bounceHex: 0x7c9ec2,
    bounceIntensity: 0.92,
    fogColorHex: 0x28303b,
    fogLinearCool: [0.024, 0.034, 0.048],
    fogLinearWarm: [0.16, 0.095, 0.048],
    godRayStrength: 0.34,
    godRayTint: [1.25, 0.72, 0.34],
    skyPalette: {
      zenith: [0.055, 0.085, 0.14],
      midSky: [0.16, 0.21, 0.3],
      horizonCool: [0.35, 0.37, 0.43],
      horizonWarm: [0.98, 0.56, 0.27],
      cloudShadow: [0.085, 0.105, 0.145],
      cloudMid: [0.24, 0.27, 0.33],
      cloudSunRim: [1.22, 0.66, 0.32],
      lowerMistCool: [0.12, 0.15, 0.19],
      lowerMistWarm: [0.32, 0.24, 0.2],
    },
    waterStyle: {
      plungeCenterZ: -9.7,
      absorption: [0.72, 0.34, 0.25],
      deepScatter: [0.009, 0.028, 0.036],
      aeratedGlow: [0.03, 0.065, 0.075],
    },
    heroCameraPosition: { x: 21.3, y: 11.8, z: 47.7 },
    heroCameraTarget: { x: -0.3, y: 10.4, z: -12.4 },
  },
  forest: {
    id: 'forest',
    title: 'Multnomah Gorge',
    eyebrow: 'PACIFIC NORTHWEST · LUSH FOREST CANYON',
    buttonLabel: 'Forest Canyon',
    sunDirection: normalizeVec3({ x: -0.56, y: 0.35, z: -0.75 }),
    sunColorHex: 0xffd59c,
    sunIntensity: 3.85,
    hemiSkyHex: 0x98c2b8,
    hemiGroundHex: 0x162418,
    hemiIntensity: 1.42,
    bounceHex: 0x72a38a,
    bounceIntensity: 1.05,
    fogColorHex: 0x22332d,
    fogLinearCool: [0.018, 0.038, 0.032],
    fogLinearWarm: [0.18, 0.135, 0.068],
    godRayStrength: 0.68,
    godRayTint: [1.32, 0.96, 0.52],
    skyPalette: {
      zenith: [0.075, 0.155, 0.24],
      midSky: [0.2, 0.32, 0.38],
      horizonCool: [0.34, 0.46, 0.44],
      horizonWarm: [1.05, 0.78, 0.45],
      cloudShadow: [0.14, 0.19, 0.21],
      cloudMid: [0.36, 0.42, 0.43],
      cloudSunRim: [1.35, 0.96, 0.56],
      lowerMistCool: [0.11, 0.19, 0.17],
      lowerMistWarm: [0.38, 0.32, 0.21],
    },
    waterStyle: {
      plungeCenterZ: -8.6,
      absorption: [0.78, 0.22, 0.34],
      deepScatter: [0.008, 0.036, 0.028],
      aeratedGlow: [0.028, 0.085, 0.068],
    },
    heroCameraPosition: { x: 20.5, y: 12.2, z: 48.2 },
    heroCameraTarget: { x: -0.4, y: 11.4, z: -12.0 },
  },
};

export function getNextWaterfallPresetId(current: WaterfallPresetId): WaterfallPresetId {
  return current === 'iceland' ? 'forest' : 'iceland';
}
